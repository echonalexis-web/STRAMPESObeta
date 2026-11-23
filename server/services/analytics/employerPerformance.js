// Best and most performative employers (feature j).
//
// An employer is measured on placement outcomes it controls, not on how many postings it makes:
//   hires            applications whose hire date (hiredAt, else statusUpdatedAt) is in the period
//   hire rate        hires / non-withdrawn applications received in the period (cohort), with the
//                    lower bound of the 95% Wilson interval used for ranking (1 of 1 never beats 8 of 20)
//   fill rate        postings made in the period with at least as many hires as slots / postings that got an applicant
//   time to hire     median days from posting to its first hire (postings with a hire)
//   response rate    share of applications at least 7 days old that the employer has moved out of pending
//                    (needs firstResponseAt, so it is thin until that field has filled up)
// Ranking, no hidden weights: hires, then Wilson hire rate, then fill rate, then faster median time to hire,
// then company name. Employers under the minimum activity are listed as "Not enough data" without a rank.
// SPES is not part of the ranking: SpesPosting has no employer.

const User = require("../../models/User");
const JobVacancy = require("../../models/JobVacancy");
const JobApplication = require("../../models/JobApplication");
const { PERFORMANCE, LIMITS } = require("./config");
const { AnalyticsError } = require("./errors");
const { parsePeriodQuery, formatManilaDate } = require("./period");
const { UNLISTED_ACCOUNT_STATUSES } = require("../../utils/jobVisibility");
const { buildFunnel, timeToFillDays } = require("../archivedJobsService");

const DAY_MS = 86400000;
const HIRED_REGEX = "^(hired|accepted)$";
const HIRED_VALUES = ["hired", "accepted"];

// ---------------------------------------------------------------- pure helpers

// Lower bound of the Wilson score interval for hits out of n (0 when n is 0).
const wilsonLower = (hits, n, z = PERFORMANCE.wilsonZ) => {
  if (!n || n <= 0) return 0;
  const p = Math.min(1, Math.max(0, hits / n));
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return Math.max(0, (centre - margin) / (1 + z2 / n));
};

const median = (values) => {
  const list = (values || []).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return null;
  const middle = Math.floor(list.length / 2);
  return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
};

const round = (value, digits = 1) => (value === null || value === undefined ? null : Number(value.toFixed(digits)));
const ratio = (part, whole) => (whole > 0 ? part / whole : null);

// The minimum activity to be ranked (constants live in config.js).
const hasEnoughData = (row) => row.postings >= PERFORMANCE.minPostings && row.applicants >= PERFORMANCE.minApplicants && row.hires >= PERFORMANCE.minHires;

const compareRows = (a, b) =>
  b.hires - a.hires ||
  b.hireRateLower - a.hireRateLower ||
  (b.fillRate ?? -1) - (a.fillRate ?? -1) ||
  (a.medianDaysToHire ?? Infinity) - (b.medianDaysToHire ?? Infinity) ||
  String(a.name).localeCompare(String(b.name));

// rows: [{ employerId, name, postings, applicants, hires, hireRateLower, fillRate, medianDaysToHire, ... }]
// Returns { ranked (with rank, ties broken in the documented order), notEnoughData }.
const rankEmployers = (rows) => {
  const eligible = rows.filter(hasEnoughData).sort(compareRows);
  const ranked = eligible.map((row, index) => ({ ...row, rank: index + 1 }));
  const notEnoughData = rows.filter((row) => !hasEnoughData(row)).sort((a, b) => b.hires - a.hires || String(a.name).localeCompare(String(b.name)));
  return { ranked, notEnoughData };
};

// Whether an employer account may be named in a ranking: it exists, is verified and in good
// standing now (the inverse of the unlisted rule), and is not deleted or purged.
const isEmployerEligible = (user) =>
  Boolean(
    user &&
      user.role === "employer" &&
      user.verificationStatus === "verified" &&
      !user.deletedAt &&
      !user.purgedAt &&
      user.isActive !== false &&
      !UNLISTED_ACCOUNT_STATUSES.includes(user.accountStatus)
  );

// ---------------------------------------------------------------- data

const run = async (Model, pipeline) => {
  try {
    return await Model.aggregate(pipeline).option({ maxTimeMS: LIMITS.analyticsMaxTimeMs });
  } catch (error) {
    if (error && (error.code === 50 || /time limit/i.test(String(error.message || "")))) {
      throw new AnalyticsError(504, "QUERY_TIMEOUT", "The ranking took too long. Try a shorter period.");
    }
    throw error;
  }
};

const lowerStatus = { $toLower: { $ifNull: ["$status", ""] } };
const firstResponse = { $ifNull: ["$firstResponseAt", null] };

// Raw metrics per employer id for events in [from, to). `employerId` (an ObjectId) narrows to one employer.
const gather = async ({ from, to }, now, { employerId = null } = {}) => {
  const cutoff = new Date(now.getTime() - PERFORMANCE.responseWindowDays * DAY_MS);
  const vacancyJoin = [
    { $lookup: { from: "jobvacancies", localField: "vacancy", foreignField: "_id", as: "v" } },
    { $unwind: "$v" },
  ];

  const cohort = run(JobApplication, [
    { $match: { createdAt: { $gte: from, $lt: to } } },
    ...vacancyJoin,
    { $project: { employer: "$v.employer", status: lowerStatus, createdAt: 1, firstResponseAt: 1 } },
    ...(employerId ? [{ $match: { employer: employerId } }] : []),
    {
      $group: {
        _id: "$employer",
        received: { $sum: 1 },
        withdrawn: { $sum: { $cond: [{ $eq: ["$status", "withdrawn"] }, 1, 0] } },
        hired: { $sum: { $cond: [{ $in: ["$status", HIRED_VALUES] }, 1, 0] } },
        responseEligible: { $sum: { $cond: [{ $and: [{ $ne: ["$status", "withdrawn"] }, { $lte: ["$createdAt", cutoff] }] }, 1, 0] } },
        responded: {
          $sum: { $cond: [{ $and: [{ $ne: ["$status", "withdrawn"] }, { $lte: ["$createdAt", cutoff] }, { $ne: [firstResponse, null] }] }, 1, 0] },
        },
        responseMs: {
          $push: { $cond: [{ $and: [{ $lte: ["$createdAt", cutoff] }, { $ne: [firstResponse, null] }] }, { $subtract: ["$firstResponseAt", "$createdAt"] }, "$$REMOVE"] },
        },
      },
    },
  ]);

  const hires = run(JobApplication, [
    { $match: { status: { $regex: HIRED_REGEX, $options: "i" } } },
    { $addFields: { hireDate: { $ifNull: ["$hiredAt", "$statusUpdatedAt"] } } },
    { $match: { hireDate: { $gte: from, $lt: to } } },
    ...vacancyJoin,
    { $project: { employer: "$v.employer" } },
    ...(employerId ? [{ $match: { employer: employerId } }] : []),
    { $group: { _id: "$employer", hires: { $sum: 1 } } },
  ]);

  const hiredCond = { $in: [lowerStatus, HIRED_VALUES] };
  const postings = run(JobVacancy, [
    { $match: { createdAt: { $gte: from, $lt: to }, ...(employerId ? { employer: employerId } : {}) } },
    {
      $lookup: {
        from: "jobapplications",
        let: { vacancyId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$vacancy", "$$vacancyId"] } } },
          {
            $group: {
              _id: null,
              applicants: { $sum: { $cond: [{ $ne: [lowerStatus, "withdrawn"] }, 1, 0] } },
              hires: { $sum: { $cond: [hiredCond, 1, 0] } },
              firstHire: { $min: { $cond: [hiredCond, { $ifNull: ["$hiredAt", "$statusUpdatedAt"] }, null] } },
            },
          },
        ],
        as: "c",
      },
    },
    { $project: { employer: 1, createdAt: 1, slots: { $max: [{ $ifNull: ["$slots", 1] }, 1] }, c: { $arrayElemAt: ["$c", 0] } } },
    {
      $group: {
        _id: "$employer",
        postings: { $sum: 1 },
        withApplicants: { $sum: { $cond: [{ $gt: [{ $ifNull: ["$c.applicants", 0] }, 0] }, 1, 0] } },
        filled: {
          $sum: { $cond: [{ $and: [{ $gt: [{ $ifNull: ["$c.applicants", 0] }, 0] }, { $gte: [{ $ifNull: ["$c.hires", 0] }, "$slots"] }] }, 1, 0] },
        },
        daysToHire: {
          $push: { $cond: [{ $ne: [{ $ifNull: ["$c.firstHire", null] }, null] }, { $divide: [{ $subtract: ["$c.firstHire", "$createdAt"] }, DAY_MS] }, "$$REMOVE"] },
        },
      },
    },
  ]);

  const [cohortRows, hireRows, postingRows] = await Promise.all([cohort, hires, postings]);
  const map = new Map();
  const slot = (id) => {
    const key = String(id);
    if (!map.has(key)) map.set(key, { employerId: key });
    return map.get(key);
  };
  for (const row of cohortRows) {
    const applicants = Number(row.received || 0) - Number(row.withdrawn || 0);
    Object.assign(slot(row._id), {
      applicants,
      cohortHires: Number(row.hired || 0),
      responseEligible: Number(row.responseEligible || 0),
      responded: Number(row.responded || 0),
      responseDays: (row.responseMs || []).map((ms) => ms / DAY_MS),
    });
  }
  for (const row of hireRows) slot(row._id).hires = Number(row.hires || 0);
  for (const row of postingRows) {
    Object.assign(slot(row._id), {
      postings: Number(row.postings || 0),
      withApplicants: Number(row.withApplicants || 0),
      filled: Number(row.filled || 0),
      daysToHire: row.daysToHire || [],
    });
  }
  return map;
};

// One employer's metrics as the response shows them.
const toMetrics = (raw) => {
  const applicants = raw.applicants || 0;
  const cohortHires = raw.cohortHires || 0;
  const hireRate = ratio(cohortHires, applicants);
  const eligibleForResponse = raw.responseEligible || 0;
  return {
    postings: raw.postings || 0,
    applicants,
    hires: raw.hires || 0,
    hireRate: round(hireRate === null ? null : hireRate * 100),
    hireRateLower: round(wilsonLower(cohortHires, applicants) * 100),
    hireRateN: applicants,
    fillRate: raw.withApplicants > 0 ? round(((raw.filled || 0) / raw.withApplicants) * 100) : null,
    medianDaysToHire: round(median(raw.daysToHire)),
    responseRate: eligibleForResponse > 0 ? round(((raw.responded || 0) / eligibleForResponse) * 100) : null,
    medianResponseDays: round(median(raw.responseDays)),
  };
};

const loadEmployers = (ids) =>
  User.find({ _id: { $in: ids } })
    .select("name companyName profileImage role verificationStatus isActive accountStatus deletedAt purgedAt")
    .lean();

const displayName = (user) => (user && (user.companyName || user.name)) || "Employer";

// Metrics, eligibility split and ranking for one range.
const computeRanking = async (range, now) => {
  const raw = await gather(range, now);
  const users = await loadEmployers([...raw.keys()]);
  const byId = new Map(users.map((user) => [String(user._id), user]));

  const rows = [];
  let notShown = 0;
  const former = { hires: 0, applicants: 0, postings: 0 };
  const totals = { hires: 0, applicants: 0, postings: 0 };
  for (const [id, data] of raw) {
    const metrics = toMetrics(data);
    totals.hires += metrics.hires;
    totals.applicants += metrics.applicants;
    totals.postings += metrics.postings;
    const user = byId.get(id);
    if (!isEmployerEligible(user)) {
      // Restricted, unverified, deleted or purged: counted in the province totals, never named.
      notShown += 1;
      former.hires += metrics.hires;
      former.applicants += metrics.applicants;
      former.postings += metrics.postings;
      continue;
    }
    rows.push({
      employerId: id,
      name: displayName(user),
      photo: user.profileImage || null,
      ...metrics,
    });
  }
  return { ...rankEmployers(rows), notShown, totals, former };
};

const periodMeta = (period) => ({
  type: period.type,
  label: period.label,
  from: formatManilaDate(period.from),
  to: formatManilaDate(new Date(period.to.getTime() - 1)),
  isPartial: period.isPartial,
  isFuture: period.isFuture,
});

// Quarter or year only; the rest of the period rules are the shared ones.
const parsePerformancePeriod = (query, now) => {
  const period = parsePeriodQuery(query, now);
  return period;
};

const parseLimit = (value) => {
  const n = Number.parseInt(Array.isArray(value) ? value[0] : value, 10);
  if (!Number.isFinite(n) || n < 1) return PERFORMANCE.defaultTopN;
  return Math.min(n, PERFORMANCE.maxTopN);
};

// A partial period is compared with the same elapsed stretch of the one before it.
const previousRange = (period) => ({ from: period.previous.from, to: period.isPartial && period.previousSameElapsedTo ? period.previousSameElapsedTo : period.previous.to });

// GET /admin/analytics/performance/employers
const getEmployerRanking = async (query = {}, now = new Date()) => {
  const period = parsePerformancePeriod(query, now);
  const limit = parseLimit(query.limit);
  const empty = { ranked: [], notEnoughData: [], notShown: 0, totals: { hires: 0, applicants: 0, postings: 0 }, former: { hires: 0, applicants: 0, postings: 0 } };
  const current = period.isFuture ? empty : await computeRanking({ from: period.from, to: period.to }, now);
  const before = period.isFuture ? empty : await computeRanking(previousRange(period), now);
  const previousById = new Map(before.ranked.map((row) => [row.employerId, row]));
  const previousNotRanked = new Map(before.notEnoughData.map((row) => [row.employerId, row]));

  const withPrevious = (row) => {
    const prior = previousById.get(row.employerId) || previousNotRanked.get(row.employerId);
    return { ...row, previous: prior ? { rank: prior.rank || null, hires: prior.hires } : null, hiresChange: prior ? row.hires - prior.hires : null };
  };
  const responseData = current.ranked.concat(current.notEnoughData).some((row) => row.responseRate !== null);

  return {
    period: periodMeta(period),
    previous: { label: period.previous.label, comparedTo: period.isPartial ? "same elapsed days" : "full period" },
    asOf: period.asOf.toISOString(),
    rules: { minPostings: PERFORMANCE.minPostings, minApplicants: PERFORMANCE.minApplicants },
    eligibility: { ranked: current.ranked.length, notEnoughData: current.notEnoughData.length, excluded: current.notShown },
    totals: { ...current.totals, formerOrRestricted: current.former },
    responseDataAvailable: responseData,
    rows: current.ranked.slice(0, limit).map(withPrevious),
    notEnoughData: current.notEnoughData.slice(0, PERFORMANCE.maxTopN).map(({ employerId, name, photo, postings, applicants, hires }) => ({ employerId, name, photo, postings, applicants, hires })),
  };
};

// GET /admin/analytics/performance/employers/:employerId
const getEmployerPerformanceDetail = async (employerId, query = {}, now = new Date()) => {
  const mongoose = require("mongoose");
  if (!mongoose.Types.ObjectId.isValid(employerId)) throw new AnalyticsError(404, "NOT_FOUND", "Employer not found.");
  const id = new mongoose.Types.ObjectId(employerId);
  const period = parsePerformancePeriod(query, now);
  const [user] = await loadEmployers([id]);
  if (!user || user.role !== "employer" || user.deletedAt || user.purgedAt) throw new AnalyticsError(404, "NOT_FOUND", "Employer not found.");

  const metricsFor = async (range) => {
    const map = await gather(range, now, { employerId: id });
    return toMetrics(map.get(String(id)) || {});
  };
  const metrics = period.isFuture ? toMetrics({}) : await metricsFor({ from: period.from, to: period.to });
  const previousMetrics = period.isFuture ? toMetrics({}) : await metricsFor(previousRange(period));

  const jobs = await JobVacancy.find({ employer: id, createdAt: { $gte: period.from, $lt: period.to } })
    .select("title slots createdAt status archived closedAt closeReason")
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  const applications = jobs.length
    ? await JobApplication.find({ vacancy: { $in: jobs.map((job) => job._id) } }).select("vacancy status statusUpdatedAt hiredAt").lean()
    : [];
  const byJob = new Map();
  for (const application of applications) {
    const key = String(application.vacancy);
    if (!byJob.has(key)) byJob.set(key, []);
    // Hire date as the ranking reads it: hiredAt, else the last status change.
    byJob.get(key).push({ status: application.status, statusUpdatedAt: application.hiredAt || application.statusUpdatedAt });
  }
  const postings = jobs.map((job) => {
    const list = byJob.get(String(job._id)) || [];
    const closedAt = job.closedAt ? new Date(job.closedAt).getTime() : null;
    return {
      id: String(job._id),
      title: job.title,
      postedAt: job.createdAt,
      status: job.archived ? "archived" : job.status,
      slots: Math.max(Number(job.slots) || 1, 1),
      // Counts only: no applicant identity ever leaves here.
      funnel: buildFunnel(list),
      timeToFillDays: round(timeToFillDays(job, list, closedAt)),
      closeReason: job.closeReason || null,
    };
  });

  return {
    period: periodMeta(period),
    previous: { label: period.previous.label },
    asOf: period.asOf.toISOString(),
    employer: { id: String(id), name: displayName(user), photo: user.profileImage || null, eligible: isEmployerEligible(user) },
    metrics,
    previousMetrics,
    postings,
  };
};

module.exports = {
  wilsonLower,
  median,
  rankEmployers,
  hasEnoughData,
  isEmployerEligible,
  toMetrics,
  getEmployerRanking,
  getEmployerPerformanceDetail,
};
