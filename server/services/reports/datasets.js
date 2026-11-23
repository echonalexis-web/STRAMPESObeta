// Fetchers for each report dataset. Every query projects an allow-list (never the whole
// document), and every row is shaped here, so no field outside the catalog can reach a file.
//
// Row datasets return { rows, total }: `total` is counted up to cap + 1 so a request over the
// cap is refused (422) instead of silently truncated. Aggregate datasets return their rows
// directly (they are small).

const mongoose = require("mongoose");
const User = require("../../models/User");
const JobVacancy = require("../../models/JobVacancy");
const JobApplication = require("../../models/JobApplication");
const AuditLog = require("../../models/AuditLog");
const { getUnlistedEmployerIds } = require("../../utils/jobVisibility");
const { LIMITS } = require("../analytics/config");
const { AnalyticsError } = require("../analytics/errors");
const { MANILA_TZ, formatManilaDate } = require("../analytics/period");
const { municipalityBucketExpression } = require("../analytics/municipality");
const { ageBracketExpression, suppressSmallCells } = require("../analytics/privacy");
const { jobsMatch, employersBase, getAnalyticsSummary } = require("../analytics/summaryStats");
const { getEmployerRanking } = require("../analytics/employerPerformance");

const HIRED_REGEX = "^(hired|accepted)$";
const UNDER_FIVE = "under 5";
const FORMER_EMPLOYER = "Former employer";
const dayString = (value) => (value ? formatManilaDate(new Date(value)) : "");
const dateExpr = (field) => ({ $dateToString: { format: "%Y-%m-%d", date: field, timezone: MANILA_TZ } });

const runAggregate = async (Model, pipeline) => {
  try {
    return await Model.aggregate(pipeline).option({ maxTimeMS: LIMITS.exportMaxTimeMs });
  } catch (error) {
    if (error && (error.code === 50 || /time limit/i.test(String(error.message || "")))) {
      throw new AnalyticsError(504, "QUERY_TIMEOUT", "The report took too long. Narrow the filters and try again.");
    }
    throw error;
  }
};

// Count of the base set, stopping at cap + 1.
const countCapped = async (Model, base, cap) => {
  const rows = await runAggregate(Model, [...base, { $limit: cap + 1 }, { $count: "n" }]);
  return rows[0] ? rows[0].n : 0;
};

const employerName = (user) => (user && !user.deletedAt && !user.purgedAt ? user.companyName || user.name || "Employer" : FORMER_EMPLOYER);
const objectId = (text) => new mongoose.Types.ObjectId(text);

// ------------------------------------------------------------------ jobs

const jobsBase = async (filter, period, now) => {
  const match = await jobsMatch(filter, period, now);
  const stages = [{ $match: match }, { $addFields: { municipalityBucket: municipalityBucketExpression("$location"), statusBucket: { $cond: [{ $eq: ["$archived", true] }, "archived", { $ifNull: ["$status", "draft"] }] } } }];
  if (filter.municipality) stages.push({ $match: { municipalityBucket: filter.municipality } });
  return stages;
};

const jobsRows = async (filter, period, { now, limit, cap }) => {
  const base = await jobsBase(filter, period, now);
  const total = await countCapped(JobVacancy, base, cap);
  const rows = await runAggregate(JobVacancy, [
    ...base,
    { $sort: { createdAt: -1, _id: 1 } },
    { $limit: limit },
    { $lookup: { from: "users", localField: "employer", foreignField: "_id", as: "emp" } },
    {
      $lookup: {
        from: "jobapplications",
        let: { vacancyId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$vacancy", "$$vacancyId"] } } },
          {
            $group: {
              _id: null,
              applicants: { $sum: { $cond: [{ $ne: [{ $toLower: { $ifNull: ["$status", ""] } }, "withdrawn"] }, 1, 0] } },
              hires: { $sum: { $cond: [{ $in: [{ $toLower: { $ifNull: ["$status", ""] } }, ["hired", "accepted"]] }, 1, 0] } },
            },
          },
        ],
        as: "c",
      },
    },
    {
      $project: {
        title: 1,
        slots: 1,
        jobType: 1,
        workNature: 1,
        industry: 1,
        createdAt: 1,
        closedAt: 1,
        closeReason: 1,
        municipalityBucket: 1,
        statusBucket: 1,
        emp: { $arrayElemAt: [{ $map: { input: "$emp", as: "e", in: { companyName: "$$e.companyName", name: "$$e.name", deletedAt: "$$e.deletedAt", purgedAt: "$$e.purgedAt" } } }, 0] },
        counts: { $arrayElemAt: ["$c", 0] },
      },
    },
  ]);
  return {
    total,
    rows: rows.map((row) => ({
      title: row.title || "",
      employer: employerName(row.emp),
      municipality: row.municipalityBucket,
      industry: (Array.isArray(row.industry) ? row.industry : row.industry ? [row.industry] : []).filter(Boolean).join("; "),
      jobType: row.jobType || "",
      workNature: row.workNature || "",
      slots: Math.max(Number(row.slots) || 1, 1),
      status: row.statusBucket,
      postedAt: dayString(row.createdAt),
      closedAt: dayString(row.closedAt),
      closeReason: row.closeReason || "",
      applicants: row.counts ? row.counts.applicants : 0,
      hires: row.counts ? row.counts.hires : 0,
    })),
  };
};

// ------------------------------------------------------------------ employers

const employersRows = async (filter, period, { limit, cap }) => {
  const base = await employersBase(filter, period);
  const total = await countCapped(User, base, cap);
  const rows = await runAggregate(User, [
    ...base,
    { $sort: { createdAt: -1, _id: 1 } },
    { $limit: limit },
    {
      $lookup: {
        from: "jobvacancies",
        let: { employerId: "$_id" },
        pipeline: [{ $match: { $expr: { $eq: ["$employer", "$$employerId"] }, createdAt: { $gte: period.from, $lt: period.to } } }, { $count: "n" }],
        as: "pc",
      },
    },
    {
      $project: {
        companyName: 1,
        name: 1,
        verificationStatus: 1,
        accountStatus: 1,
        municipalityBucket: 1,
        industryName: 1,
        createdAt: 1,
        verificationReviewedAt: 1,
        workforce: { $arrayElemAt: ["$profile.totalWorkforceSize", 0] },
        postings: { $ifNull: [{ $arrayElemAt: ["$pc.n", 0] }, 0] },
      },
    },
  ]);
  const hiresById = await hiresByEmployer(rows.map((row) => row._id), period);
  return {
    total,
    rows: rows.map((row) => ({
      company: row.companyName || row.name || "Employer",
      verificationStatus: row.verificationStatus || "unverified",
      accountStatus: row.accountStatus || "active",
      municipality: row.municipalityBucket,
      industry: row.industryName,
      workforceSize: row.workforce || "",
      registeredAt: dayString(row.createdAt),
      verifiedAt: row.verificationStatus === "verified" ? dayString(row.verificationReviewedAt) : "",
      postings: row.postings,
      hires: hiresById.get(String(row._id)) || 0,
    })),
  };
};

// Hires made in the period by these employers (hire date is hiredAt, else the last status change).
const hiresByEmployer = async (employerIds, period) => {
  if (!employerIds.length) return new Map();
  const rows = await runAggregate(JobApplication, [
    { $match: { status: { $regex: HIRED_REGEX, $options: "i" } } },
    { $addFields: { hireDate: { $ifNull: ["$hiredAt", "$statusUpdatedAt"] } } },
    { $match: { hireDate: { $gte: period.from, $lt: period.to } } },
    { $lookup: { from: "jobvacancies", localField: "vacancy", foreignField: "_id", as: "v" } },
    { $unwind: "$v" },
    { $match: { "v.employer": { $in: employerIds } } },
    { $group: { _id: "$v.employer", hires: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.hires]));
};

// ------------------------------------------------------------------ applications and hires

// Stages that join an application to its posting and apply the job-side filters. Applicant
// identity is never projected from here.
const applicationJobStages = async (filter) => {
  const stages = [
    { $lookup: { from: "jobvacancies", localField: "vacancy", foreignField: "_id", as: "v" } },
    { $unwind: "$v" },
  ];
  const and = [];
  if (filter.employerId) and.push({ "v.employer": objectId(filter.employerId) });
  if (filter.industry) and.push({ "v.industry": filter.industry });
  if (filter.jobType) and.push({ "v.jobType": filter.jobType });
  if (filter.workNature) and.push({ "v.workNature": filter.workNature });
  if (filter.scope === "public") and.push({ "v.employer": { $nin: await getUnlistedEmployerIds() } });
  if (and.length) stages.push({ $match: { $and: and } });
  stages.push({ $addFields: { municipalityBucket: municipalityBucketExpression("$v.location") } });
  if (filter.municipality) stages.push({ $match: { municipalityBucket: filter.municipality } });
  return stages;
};

const employerNames = async (ids) => {
  if (!ids.length) return new Map();
  const users = await User.find({ _id: { $in: ids } }).select("name companyName deletedAt purgedAt").lean();
  return new Map(users.map((user) => [String(user._id), employerName(user)]));
};

const applicationsRows = async (filter, period, { limit, cap }) => {
  const base = [{ $match: { createdAt: { $gte: period.from, $lt: period.to } } }, ...(await applicationJobStages(filter))];
  const total = await countCapped(JobApplication, base, cap);
  const rows = await runAggregate(JobApplication, [
    ...base,
    { $sort: { createdAt: -1, _id: 1 } },
    { $limit: limit },
    { $project: { createdAt: 1, statusUpdatedAt: 1, status: { $toLower: { $ifNull: ["$status", ""] } }, jobTitle: "$v.title", employerId: "$v.employer", municipalityBucket: 1 } },
  ]);
  const names = await employerNames([...new Set(rows.map((row) => row.employerId).filter(Boolean))]);
  return {
    total,
    rows: rows.map((row) => ({
      // A short reference, not the database id; it identifies no person.
      ref: String(row._id).slice(-8).toUpperCase(),
      jobTitle: row.jobTitle || "",
      employer: names.get(String(row.employerId)) || FORMER_EMPLOYER,
      appliedAt: dayString(row.createdAt),
      status: row.status === "accepted" ? "hired" : row.status,
      statusAt: dayString(row.statusUpdatedAt),
      municipality: row.municipalityBucket,
    })),
  };
};

const hiresRows = async (filter, period, { now, limit, cap }) => {
  const base = [
    { $match: { status: { $regex: HIRED_REGEX, $options: "i" } } },
    { $addFields: { hireDate: { $ifNull: ["$hiredAt", "$statusUpdatedAt"] } } },
    { $match: { hireDate: { $gte: period.from, $lt: period.to } } },
    ...(await applicationJobStages(filter)),
  ];
  const total = await countCapped(JobApplication, base, cap);
  const rows = await runAggregate(JobApplication, [
    ...base,
    { $sort: { hireDate: -1, _id: 1 } },
    { $limit: limit },
    { $lookup: { from: "users", localField: "applicant", foreignField: "_id", as: "u" } },
    // The date of birth is turned into a bracket here and never leaves the pipeline.
    { $project: { hireDate: 1, jobTitle: "$v.title", employerId: "$v.employer", municipalityBucket: 1, ageBracket: ageBracketExpression({ $arrayElemAt: ["$u.dateOfBirth", 0] }, now) } },
  ]);
  const names = await employerNames([...new Set(rows.map((row) => row.employerId).filter(Boolean))]);
  return {
    total,
    rows: rows.map((row) => ({
      hiredAt: dayString(row.hireDate),
      jobTitle: row.jobTitle || "",
      employer: names.get(String(row.employerId)) || FORMER_EMPLOYER,
      municipality: row.municipalityBucket,
      // A minor is never a row of their own: the bracket is withheld (they appear in counts only).
      ageBracket: row.ageBracket === "15-17" ? "withheld (under 18)" : row.ageBracket === "unknown" ? "not known" : row.ageBracket,
      _bracket: row.ageBracket,
    })),
  };
};

// ------------------------------------------------------------------ aggregate datasets

const asCount = (item) => (item.suppressed ? UNDER_FIVE : item.value);

const jobseekersRows = async (parsed, { grouping }) => {
  const summary = await getAnalyticsSummary(parsed);
  if (grouping === "month") {
    const series = summary.series.find((entry) => entry.key.includes("ByMonth")) || { points: [] };
    return series.points.map((point) => ({ group: point.label, count: point.suppressed ? UNDER_FIVE : point.value }));
  }
  const key = grouping === "municipality" ? "municipality" : "ageBracket";
  const found = summary.breakdowns.find((item) => item.key === key);
  return (found ? found.items : []).map((item) => ({ group: item.label || item.key, count: asCount(item) }));
};

// SPES: counts only, from the postings and the applications summaries (applicant rows are never exported).
const spesRows = async (parseFor) => {
  const postings = await getAnalyticsSummary(parseFor("jobs"));
  const applications = await getAnalyticsSummary(parseFor("applicants"));
  const rows = [];
  const push = (metric, items) => items.forEach((item) => rows.push({ metric, label: item.label || item.key, count: asCount(item) }));
  const cardRows = (metric, cards) => cards.forEach((card) => rows.push({ metric, label: card.key, count: card.suppressed ? UNDER_FIVE : card.value }));
  cardRows("SPES postings", postings.cards);
  push("SPES postings by status", (postings.breakdowns.find((item) => item.key === "status") || { items: [] }).items);
  cardRows("SPES applications", applications.cards);
  push("SPES applications by status", (applications.breakdowns.find((item) => item.key === "status") || { items: [] }).items);
  push("SPES applications by age tier", (applications.breakdowns.find((item) => item.key === "ageTier") || { items: [] }).items);
  return rows;
};

const rankingRows = async (query, now) => {
  const result = await getEmployerRanking({ ...query, limit: "50" }, now);
  return result.rows.map((row) => ({
    rank: row.rank,
    employer: row.name,
    postings: row.postings,
    applicants: row.applicants,
    hires: row.hires,
    hireRate: row.hireRate,
    fillRate: row.fillRate,
    medianDaysToHire: row.medianDaysToHire,
    responseRate: row.responseRate,
  }));
};

const verificationRows = async (period) => {
  const month = (field) => ({ $dateToString: { format: "%Y-%m", date: field, timezone: MANILA_TZ } });
  const [submitted, reviewed] = await Promise.all([
    runAggregate(User, [
      { $match: { role: "employer", verificationSubmittedAt: { $gte: period.from, $lt: period.to } } },
      { $group: { _id: month("$verificationSubmittedAt"), submitted: { $sum: 1 } } },
    ]),
    runAggregate(User, [
      { $match: { role: "employer", verificationReviewedAt: { $gte: period.from, $lt: period.to } } },
      {
        $group: {
          _id: month("$verificationReviewedAt"),
          reviewed: { $sum: 1 },
          verified: { $sum: { $cond: [{ $eq: ["$verificationStatus", "verified"] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ["$verificationStatus", "rejected"] }, 1, 0] } },
          turnaroundMs: { $avg: { $cond: [{ $ne: [{ $ifNull: ["$verificationSubmittedAt", null] }, null] }, { $subtract: ["$verificationReviewedAt", "$verificationSubmittedAt"] }, null] } },
        },
      },
    ]),
  ]);
  const months = new Map();
  const slot = (key) => {
    if (!months.has(key)) months.set(key, { month: key, submitted: 0, reviewed: 0, verified: 0, rejected: 0, avgTurnaroundDays: null });
    return months.get(key);
  };
  for (const item of submitted) slot(item._id).submitted = item.submitted;
  for (const item of reviewed) {
    Object.assign(slot(item._id), {
      reviewed: item.reviewed,
      verified: item.verified,
      rejected: item.rejected,
      avgTurnaroundDays: item.turnaroundMs === null || item.turnaroundMs === undefined ? null : Number((item.turnaroundMs / 86400000).toFixed(1)),
    });
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
};

// Counts by month, category (the part of the action before the first dot) and severity.
// No actor, IP, user agent or metadata is read.
const auditRows = async (period) => {
  const rows = await runAggregate(AuditLog, [
    { $match: { createdAt: { $gte: period.from, $lt: period.to } } },
    {
      $group: {
        _id: {
          month: { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: MANILA_TZ } },
          category: { $arrayElemAt: [{ $split: ["$action", "."] }, 0] },
          severity: "$severity",
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { "_id.month": 1, "_id.category": 1, "_id.severity": 1 } },
    { $limit: 5000 },
  ]);
  return rows.map((row) => ({ month: row._id.month, category: row._id.category, severity: row._id.severity, count: row.count }));
};

module.exports = {
  UNDER_FIVE,
  jobsRows,
  employersRows,
  applicationsRows,
  hiresRows,
  jobseekersRows,
  spesRows,
  rankingRows,
  verificationRows,
  auditRows,
  suppressSmallCells,
};
