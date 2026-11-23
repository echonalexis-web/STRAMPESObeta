// GET /admin/analytics/summary: every number of one dashboard section (jobs, employers or
// applicants) for one validated filter object, in one response, so cards, charts and
// tables always agree. Each section is a single $facet aggregation; the client never
// sums or derives a statistic.
//
// Privacy: age brackets and anything about minors go through the small-cell rule
// (counts under 5 are returned as { value: null, suppressed: true }).

const mongoose = require("mongoose");
const User = require("../../models/User");
const JobVacancy = require("../../models/JobVacancy");
const JobApplication = require("../../models/JobApplication");
const SpesPosting = require("../../models/SpesPosting");
const SpesApplication = require("../../models/SpesApplication");
const { withListedEmployers, getUnlistedEmployerIds } = require("../../utils/jobVisibility");
const { LIMITS, SMALL_CELL_THRESHOLD } = require("./config");
const { AnalyticsError } = require("./errors");
const { MANILA_TZ, manilaParts, startOfManilaDay, formatManilaDate } = require("./period");
const { escapeRegExp, municipalityBucketExpression } = require("./municipality");
const { ageBracketExpression, suppressSmallCells, AGE_BRACKETS, UNKNOWN_BRACKET } = require("./privacy");

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HIRED_VALUES = ["hired", "accepted"];

// Runs an aggregation with the analytics time limit; a timeout becomes 504 QUERY_TIMEOUT.
const run = async (Model, pipeline) => {
  try {
    return await Model.aggregate(pipeline).option({ maxTimeMS: LIMITS.analyticsMaxTimeMs });
  } catch (error) {
    if (error && (error.code === 50 || /time limit/i.test(String(error.message || "")))) {
      throw new AnalyticsError(504, "QUERY_TIMEOUT", "The statistics took too long. Narrow the filters and try again.");
    }
    throw error;
  }
};

// Every Manila month inside [from, to), as "YYYY-MM" keys with a short label.
const monthKeys = (period) => {
  const keys = [];
  const first = manilaParts(period.from);
  let year = first.year;
  let month = first.month;
  for (let guard = 0; guard < 80; guard += 1) {
    const start = startOfManilaDay(year, month, 1);
    if (start >= period.to) break;
    keys.push({ key: `${year}-${String(month).padStart(2, "0")}`, label: `${MONTH_SHORT[month - 1]} ${year}` });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return keys;
};

const monthGroup = (field) => ({ $dateToString: { format: "%Y-%m", date: field, timezone: MANILA_TZ } });

const toMap = (rows) => new Map((rows || []).map((row) => [row._id, Number(row.value || 0)]));

const monthSeries = (key, rows, period, { sensitive = false } = {}) => {
  const map = toMap(rows);
  const points = monthKeys(period).map(({ key: monthKey, label }) => ({ key: monthKey, label, value: map.get(monthKey) || 0 }));
  return { key, points: sensitive ? suppressPoints(points) : points };
};

const suppressPoints = (points) =>
  points.map((point) => (point.value > 0 && point.value < SMALL_CELL_THRESHOLD ? { ...point, value: null, suppressed: true } : point));

// A breakdown from $group rows ({ _id, value }); `order` fixes the key order when given.
const breakdown = (key, rows, { order = null, sensitive = false, labels = {}, limit = null } = {}) => {
  const map = toMap(rows);
  let keys = order ? [...order] : [...map.keys()];
  if (order) for (const extra of map.keys()) if (!keys.includes(extra)) keys.push(extra);
  if (!order) keys.sort((a, b) => map.get(b) - map.get(a) || String(a).localeCompare(String(b)));
  if (limit) keys = keys.slice(0, limit);
  const total = keys.reduce((sum, item) => sum + (map.get(item) || 0), 0);
  const cells = keys.map((item) => ({ key: item, value: map.get(item) || 0 }));
  if (!sensitive) {
    return { key, total, items: cells.map((cell) => ({ key: String(cell.key), label: labels[cell.key] || String(cell.key), value: cell.value })) };
  }
  const safe = suppressSmallCells(cells, { total });
  return {
    key,
    total: safe.total,
    totalHidden: safe.totalHidden,
    items: safe.cells.map((cell) => ({
      key: String(cell.key),
      label: labels[cell.key] || String(cell.key),
      value: cell.value,
      ...(cell.suppressed ? { suppressed: true } : {}),
    })),
  };
};

const card = (key, value, { sensitive = false } = {}) => {
  const number = Number(value || 0);
  if (sensitive && number > 0 && number < SMALL_CELL_THRESHOLD) return { key, value: null, suppressed: true };
  return { key, value: number };
};

const one = (rows) => (rows && rows[0]) || {};

const objectId = (text) => new mongoose.Types.ObjectId(text);

// ---------------------------------------------------------------- jobs

const jobsMatch = async (filter, period, now) => {
  const and = [{ createdAt: { $gte: period.from, $lt: period.to } }];
  if (filter.employerId) and.push({ employer: objectId(filter.employerId) });
  if (filter.industry) and.push({ industry: filter.industry });
  if (filter.jobType) and.push({ jobType: filter.jobType });
  if (filter.workNature) and.push({ workNature: filter.workNature });
  if (filter.barangay) and.push({ location: { $regex: escapeRegExp(filter.barangay), $options: "i" } });
  if (filter.jobStatus === "archived") and.push({ archived: true });
  else if (filter.jobStatus) and.push({ status: filter.jobStatus, archived: { $ne: true } });
  if (filter.scope === "public") {
    and.push(
      await withListedEmployers({
        isActive: true,
        status: "active",
        archived: { $ne: true },
        $or: [{ applicationDeadline: null }, { applicationDeadline: { $gt: now } }],
      })
    );
  }
  return { $and: and };
};

const jobStatusLabel = { active: "Active", closed: "Closed", draft: "Draft", archived: "Archived" };

const jobsSummary = async (filter, period, now) => {
  if (filter.dataset === "spes") return spesPostingsSummary(period);
  const match = await jobsMatch(filter, period, now);

  const pipeline = [
    { $match: match },
    {
      $addFields: {
        municipalityBucket: municipalityBucketExpression("$location"),
        statusBucket: { $cond: [{ $eq: ["$archived", true] }, "archived", { $ifNull: ["$status", "draft"] }] },
        industryList: {
          $filter: {
            input: { $cond: [{ $isArray: "$industry" }, "$industry", [{ $ifNull: ["$industry", null] }]] },
            as: "ind",
            cond: { $and: [{ $ne: ["$$ind", null] }, { $ne: ["$$ind", ""] }] },
          },
        },
      },
    },
  ];
  if (filter.municipality) pipeline.push({ $match: { municipalityBucket: filter.municipality } });
  pipeline.push(
    {
      $lookup: {
        from: "jobapplications",
        let: { vacancyId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$vacancy", "$$vacancyId"] } } },
          {
            $group: {
              _id: null,
              applications: { $sum: 1 },
              hires: { $sum: { $cond: [{ $in: [{ $toLower: { $ifNull: ["$status", ""] } }, HIRED_VALUES] }, 1, 0] } },
            },
          },
        ],
        as: "counts",
      },
    },
    { $addFields: { applications: { $ifNull: [{ $arrayElemAt: ["$counts.applications", 0] }, 0] }, hires: { $ifNull: [{ $arrayElemAt: ["$counts.hires", 0] }, 0] } } },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              postings: { $sum: 1 },
              slots: { $sum: { $max: [{ $ifNull: ["$slots", 1] }, 1] } },
              applications: { $sum: "$applications" },
              hires: { $sum: "$hires" },
            },
          },
        ],
        byStatus: [{ $group: { _id: "$statusBucket", value: { $sum: 1 } } }],
        byMunicipality: [{ $group: { _id: "$municipalityBucket", value: { $sum: 1 } } }],
        byIndustry: [{ $unwind: "$industryList" }, { $group: { _id: "$industryList", value: { $sum: 1 } } }, { $sort: { value: -1, _id: 1 } }, { $limit: 8 }],
        byJobType: [{ $group: { _id: { $ifNull: ["$jobType", "Unspecified"] }, value: { $sum: 1 } } }],
        byWorkNature: [{ $group: { _id: { $ifNull: ["$workNature", "unspecified"] }, value: { $sum: 1 } } }],
        byMonth: [{ $group: { _id: monthGroup("$createdAt"), value: { $sum: 1 } } }],
      },
    }
  );

  const result = one(await run(JobVacancy, pipeline));
  const totals = one(result.totals);
  return {
    cards: [card("postings", totals.postings), card("slots", totals.slots), card("applications", totals.applications), card("hires", totals.hires)],
    series: [monthSeries("postingsByMonth", result.byMonth, period)],
    breakdowns: [
      breakdown("status", result.byStatus, { order: ["active", "closed", "draft", "archived"], labels: jobStatusLabel }),
      breakdown("municipality", result.byMunicipality),
      breakdown("industry", result.byIndustry),
      breakdown("jobType", result.byJobType),
      breakdown("workNature", result.byWorkNature),
    ],
  };
};

const spesPostingsSummary = async (period) => {
  const result = one(
    await run(SpesPosting, [
      { $match: { createdAt: { $gte: period.from, $lt: period.to } } },
      {
        $lookup: {
          from: "spesapplications",
          let: { postingId: "$_id" },
          pipeline: [{ $match: { $expr: { $eq: ["$posting", "$$postingId"] } } }, { $group: { _id: null, applications: { $sum: 1 } } }],
          as: "counts",
        },
      },
      { $addFields: { applications: { $ifNull: [{ $arrayElemAt: ["$counts.applications", 0] }, 0] } } },
      {
        $facet: {
          totals: [{ $group: { _id: null, postings: { $sum: 1 }, slots: { $sum: { $ifNull: ["$slots", 0] } }, applications: { $sum: "$applications" } } }],
          byStatus: [{ $group: { _id: "$status", value: { $sum: 1 } } }],
          byMonth: [{ $group: { _id: monthGroup("$createdAt"), value: { $sum: 1 } } }],
        },
      },
    ])
  );
  const totals = one(result.totals);
  return {
    cards: [card("postings", totals.postings), card("slots", totals.slots), card("applications", totals.applications)],
    series: [monthSeries("postingsByMonth", result.byMonth, period)],
    breakdowns: [breakdown("status", result.byStatus, { order: ["draft", "published", "archived"] })],
  };
};

// ---------------------------------------------------------------- employers

const employersSummary = async (filter, period) => {
  const match = { role: "employer", deletedAt: null, createdAt: { $gte: period.from, $lt: period.to } };
  if (filter.industry) match.industry = filter.industry;
  if (filter.verification) match.verificationStatus = { $in: filter.verification };
  if (filter.accountStatus) match.accountStatus = filter.accountStatus;
  if (filter.scope === "public") match._id = { $nin: await getUnlistedEmployerIds() };

  const pipeline = [
    { $match: match },
    { $lookup: { from: "employerprofiles", localField: "_id", foreignField: "userId", as: "profile" } },
    {
      $addFields: {
        municipalityBucket: municipalityBucketExpression({ $arrayElemAt: ["$profile.businessAddress.municipality", 0] }),
        industryName: { $cond: [{ $in: [{ $ifNull: ["$industry", ""] }, ["", null]] }, "Unspecified", "$industry"] },
      },
    },
  ];
  if (filter.municipality) pipeline.push({ $match: { municipalityBucket: filter.municipality } });
  pipeline.push({
    $facet: {
      totals: [
        {
          $group: {
            _id: null,
            employers: { $sum: 1 },
            verified: { $sum: { $cond: [{ $eq: ["$verificationStatus", "verified"] }, 1, 0] } },
            pendingReview: { $sum: { $cond: [{ $in: ["$verificationStatus", ["pending", "under_review"]] }, 1, 0] } },
            goodStanding: {
              $sum: { $cond: [{ $and: [{ $ne: ["$isActive", false] }, { $in: [{ $ifNull: ["$accountStatus", "active"] }, ["active"]] }] }, 1, 0] },
            },
          },
        },
      ],
      byVerification: [{ $group: { _id: { $ifNull: ["$verificationStatus", "unverified"] }, value: { $sum: 1 } } }],
      byAccountStatus: [{ $group: { _id: { $ifNull: ["$accountStatus", "active"] }, value: { $sum: 1 } } }],
      byMunicipality: [{ $group: { _id: "$municipalityBucket", value: { $sum: 1 } } }],
      byIndustry: [{ $group: { _id: "$industryName", value: { $sum: 1 } } }, { $sort: { value: -1, _id: 1 } }, { $limit: 8 }],
      byMonth: [{ $group: { _id: monthGroup("$createdAt"), value: { $sum: 1 } } }],
    },
  });

  const result = one(await run(User, pipeline));
  const totals = one(result.totals);
  return {
    cards: [card("employers", totals.employers), card("verified", totals.verified), card("pendingReview", totals.pendingReview), card("goodStanding", totals.goodStanding)],
    series: [monthSeries("registrationsByMonth", result.byMonth, period)],
    breakdowns: [
      breakdown("verification", result.byVerification, { order: ["unverified", "pending", "under_review", "verified", "resubmission_required", "rejected"] }),
      breakdown("accountStatus", result.byAccountStatus, { order: ["active", "suspended", "banned", "deactivated"] }),
      breakdown("municipality", result.byMunicipality),
      breakdown("industry", result.byIndustry),
    ],
  };
};

// ---------------------------------------------------------------- applicants

// Applicant municipality: the profile's present address (else permanent); only a Marinduque
// address is placed in a municipality, everything else is "Other / Outside Province".
const applicantMunicipalityExpression = (municipality, province) => ({
  $cond: [
    { $regexMatch: { input: { $toLower: { $toString: { $ifNull: [province, ""] } } }, regex: "marinduque" } },
    municipalityBucketExpression(municipality),
    "Other / Outside Province",
  ],
});

const applicantsSummary = async (filter, period) => {
  if (filter.dataset === "spes") return spesApplicantsSummary(period);

  const pipeline = [];
  if (filter.dateField === "registered") {
    const match = { role: "jobseeker", deletedAt: null, createdAt: { $gte: period.from, $lt: period.to } };
    if (filter.accountStatus) match.accountStatus = filter.accountStatus;
    pipeline.push(
      { $match: match },
      { $project: { applicant: "$_id", dob: "$dateOfBirth", createdAt: 1, status: { $literal: null } } }
    );
  } else {
    const match = { createdAt: { $gte: period.from, $lt: period.to } };
    if (filter.applicationStatus) {
      match.status = filter.applicationStatus === "hired" ? { $in: ["hired", "Accepted", "accepted"] } : filter.applicationStatus;
    }
    pipeline.push(
      { $match: match },
      { $lookup: { from: "users", localField: "applicant", foreignField: "_id", as: "user" } },
      { $unwind: "$user" },
      { $match: { "user.deletedAt": null, ...(filter.accountStatus ? { "user.accountStatus": filter.accountStatus } : {}) } },
      { $project: { applicant: 1, dob: "$user.dateOfBirth", createdAt: 1, status: { $toLower: { $ifNull: ["$status", ""] } } } }
    );
  }
  pipeline.push(
    { $lookup: { from: "jobseekerprofiles", localField: "applicant", foreignField: "userId", as: "profile" } },
    { $addFields: { address: { $ifNull: [{ $arrayElemAt: ["$profile.presentAddress", 0] }, { $ifNull: [{ $arrayElemAt: ["$profile.permanentAddress", 0] }, {}] }] } } },
    {
      $addFields: {
        municipalityBucket: applicantMunicipalityExpression("$address.municipality", "$address.province"),
        ageBracket: ageBracketExpression("$dob"),
      },
    },
    { $project: { applicant: 1, createdAt: 1, status: 1, municipalityBucket: 1, ageBracket: 1 } }
  );
  if (filter.municipality) pipeline.push({ $match: { municipalityBucket: filter.municipality } });
  if (filter.ageBracket) pipeline.push({ $match: { ageBracket: filter.ageBracket } });

  const facets = {
    totals: [{ $group: { _id: "$applicant", rows: { $sum: 1 } } }, { $group: { _id: null, applicants: { $sum: 1 }, records: { $sum: "$rows" } } }],
    byAgeBracket: [{ $group: { _id: "$ageBracket", value: { $sum: 1 } } }],
    byMunicipality: [{ $group: { _id: "$municipalityBucket", value: { $sum: 1 } } }],
    byMonth: [{ $group: { _id: monthGroup("$createdAt"), value: { $sum: 1 } } }],
  };
  if (filter.dateField !== "registered") facets.byStatus = [{ $group: { _id: "$status", value: { $sum: 1 } } }];
  pipeline.push({ $facet: facets });

  const result = one(await run(filter.dateField === "registered" ? User : JobApplication, pipeline));
  const totals = one(result.totals);
  // A bracket filter is itself an age cut: every count under it follows the small-cell rule.
  const sensitive = Boolean(filter.ageBracket);

  const statusOrder = ["pending", "under_review", "shortlisted", "approved", "rejected", "hired", "withdrawn"];
  const statusRows = (result.byStatus || []).map((row) => ({ _id: row._id === "accepted" ? "hired" : row._id, value: row.value }));
  const mergedStatus = [...statusRows.reduce((acc, row) => acc.set(row._id, (acc.get(row._id) || 0) + row.value), new Map())].map(([_id, value]) => ({ _id, value }));

  const cards = [card("applicants", totals.applicants, { sensitive })];
  if (filter.dateField !== "registered") cards.push(card("applications", totals.records, { sensitive }));
  return {
    cards,
    series: [monthSeries(filter.dateField === "registered" ? "registrationsByMonth" : "applicationsByMonth", result.byMonth, period, { sensitive })],
    breakdowns: [
      // Brackets always follow the small-cell rule.
      breakdown("ageBracket", result.byAgeBracket, { order: [...AGE_BRACKETS, UNKNOWN_BRACKET], sensitive: true }),
      breakdown("municipality", result.byMunicipality, { sensitive }),
      ...(filter.dateField !== "registered" ? [breakdown("status", mergedStatus, { order: statusOrder, sensitive })] : []),
    ],
  };
};

const spesApplicantsSummary = async (period) => {
  const result = one(
    await run(SpesApplication, [
      { $match: { createdAt: { $gte: period.from, $lt: period.to } } },
      {
        $facet: {
          totals: [{ $group: { _id: null, applications: { $sum: 1 } } }],
          byStatus: [{ $group: { _id: { $ifNull: ["$status", "submitted"] }, value: { $sum: 1 } } }],
          byAgeTier: [{ $group: { _id: { $cond: [{ $in: [{ $ifNull: ["$ageTierAtApplication", ""] }, ["", null]] }, "unknown", "$ageTierAtApplication"] }, value: { $sum: 1 } } }],
          byMonth: [{ $group: { _id: monthGroup("$createdAt"), value: { $sum: 1 } } }],
        },
      },
    ])
  );
  // SPES applicants include minors: every count follows the small-cell rule.
  return {
    cards: [card("applications", one(result.totals).applications, { sensitive: true })],
    series: [monthSeries("applicationsByMonth", result.byMonth, period, { sensitive: true })],
    breakdowns: [breakdown("status", result.byStatus, { sensitive: true }), breakdown("ageTier", result.byAgeTier, { sensitive: true })],
  };
};

// ---------------------------------------------------------------- entry point

const SECTION_RUNNERS = { jobs: jobsSummary, employers: employersSummary, applicants: applicantsSummary };

// parsed = { filter, period } from parseAnalyticsFilter.
const getAnalyticsSummary = async (parsed, now = new Date()) => {
  const { filter, period } = parsed;
  const body = await SECTION_RUNNERS[filter.section](filter, period, now);
  return {
    filters: filter,
    period: {
      type: period.type,
      label: period.label,
      from: formatManilaDate(period.from),
      to: formatManilaDate(new Date(period.to.getTime() - 1)),
      isPartial: period.isPartial,
      asOf: period.asOf.toISOString(),
    },
    ...body,
  };
};

module.exports = { getAnalyticsSummary, monthKeys, breakdown, card, applicantMunicipalityExpression };
