// The numbers behind the two redesigned admin pages.
//
//   getDashboardOverview   "what needs a person today": live numbers, no date filter
//   getAnalyticsOverview   "how are we doing over time": one period and one municipality drive every panel
//   scopeCounts            vacancies and applications in a scope (the report generator's "not enough data" check)
//
// All of them use the helpers in definitions.js, so a status, a hire, a closed vacancy or a role means
// the same thing everywhere. Periods are Asia/Manila. Nothing here changes data.

const User = require("../../models/User");
const EmployerProfile = require("../../models/EmployerProfile");
const JobVacancy = require("../../models/JobVacancy");
const JobApplication = require("../../models/JobApplication");
const AuditLog = require("../../models/AuditLog");
const Report = require("../../models/Report");
const Appeal = require("../../models/Appeal");
const AccountRecoveryRequest = require("../../models/AccountRecoveryRequest");
const { getUnlistedEmployerIds, UNLISTED_ACCOUNT_STATUSES } = require("../../utils/jobVisibility");
const { PERFORMANCE } = require("./config");
const { invalidFilter, invalidPeriod } = require("./errors");
const { MANILA_TZ, manilaParts, periodBounds, formatManilaDate } = require("./period");
const { MUNICIPALITY_LABELS, matchMunicipalityLabel, municipalityBucketExpression, normalizeMunicipalityLabel } = require("./municipality");
const { run, applicantMunicipalityExpression } = require("./summaryStats");
const { wilsonLower, isEmployerEligible } = require("./employerPerformance");
const {
  APPLICATION_STATUS_ORDER,
  VACANCY_STATUS_ORDER,
  HIRED_VALUES,
  applicationStatusCounts,
  vacancyStatusCounts,
  vacancyBucketExpression,
  groupRoleTitles,
  percentOf,
} = require("./definitions");

const DAY_MS = 86400000;
const PRESETS = Object.freeze(["7d", "30d", "90d", "12m", "custom"]);
const DEFAULT_PRESET = "30d";
const TOP_LIMIT = 5;
// Raw vacancy buckets that are posted vacancies (everything but a draft).
const POSTED_BUCKETS = ["archived", "active", "closed", "filled", "completed", "hired"];

const lowerStatus = { $toLower: { $ifNull: ["$status", ""] } };

// ------------------------------------------------------------------ query parsing

const oneText = (value, name) => {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw invalidFilter(`${name} is not valid.`);
  return value.trim();
};

// ?period=7d|30d|90d|12m|custom (&from=&to=) &municipality=<one of the six, or Other / Outside Province>.
// Anything else is a 400, never a guess.
const parseOverviewQuery = (query = {}, now = new Date()) => {
  const preset = oneText(query.period, "period") || DEFAULT_PRESET;
  if (!PRESETS.includes(preset)) throw invalidPeriod("Unknown period.");
  const period = periodBounds({ type: preset, from: oneText(query.from, "from"), to: oneText(query.to, "to") }, now);
  const wanted = oneText(query.municipality, "municipality");
  let municipality = null;
  if (wanted && wanted.toLowerCase() !== "all") {
    municipality = matchMunicipalityLabel(wanted);
    if (!municipality) throw invalidFilter("municipality is not an allowed value.");
  }
  return { preset, period, municipality };
};

// ------------------------------------------------------------------ buckets for the trend

// Day for up to 31 days, week for up to 120, month beyond.
const granularityFor = (period) => {
  const days = Math.round((period.to - period.from) / DAY_MS);
  return days <= 31 ? "day" : days <= 120 ? "week" : "month";
};

const dateFormatFor = (granularity) => (granularity === "day" ? "%Y-%m-%d" : granularity === "week" ? "%G-W%V" : "%Y-%m");
const bucketGroup = (field, granularity) => ({ $dateToString: { format: dateFormatFor(granularity), date: field, timezone: MANILA_TZ } });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n) => String(n).padStart(2, "0");

// ISO week key ("2026-W47") of a civil date, the same label MongoDB's %G-W%V gives.
const isoWeekKey = (y, m, d) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNumber = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - dayNumber + 3); // the Thursday of this week
  const isoYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const week = 1 + Math.round(((date - firstThursday) / DAY_MS - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${isoYear}-W${pad2(week)}`;
};

// Every bucket of the period, in order, so a quiet day or week still shows as 0.
const bucketList = (period, granularity) => {
  const first = manilaParts(period.from);
  const last = manilaParts(new Date(period.to.getTime() - 1));
  const end = Date.UTC(last.year, last.month - 1, last.day);
  const buckets = [];
  const seen = new Set();
  for (let t = Date.UTC(first.year, first.month - 1, first.day); t <= end; t += DAY_MS) {
    const day = new Date(t);
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const key = granularity === "day" ? `${y}-${pad2(m)}-${pad2(d)}` : granularity === "week" ? isoWeekKey(y, m, d) : `${y}-${pad2(m)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    buckets.push({ key, label: granularity === "month" ? `${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]} ${d}` });
  }
  return buckets;
};

const series = (rows, buckets) => {
  const map = new Map((rows || []).map((row) => [row._id, Number(row.count || 0)]));
  return buckets.map(({ key, label }) => ({ key, label, value: map.get(key) || 0 }));
};

// ------------------------------------------------------------------ scopes (the one place a scope is defined)

// Applications received in the period, joined to their posting; the posting's municipality is the scope's.
const applicationStages = (period, municipality) => [
  { $match: { createdAt: { $gte: period.from, $lt: period.to } } },
  { $lookup: { from: "jobvacancies", localField: "vacancy", foreignField: "_id", as: "v" } },
  { $unwind: "$v" },
  { $project: { status: lowerStatus, createdAt: 1, employer: "$v.employer", title: "$v.title", municipalityBucket: municipalityBucketExpression("$v.location") } },
  ...(municipality ? [{ $match: { municipalityBucket: municipality } }] : []),
];

// Posted vacancies created in the period (drafts are not posted).
const vacancyStages = (period, municipality) => [
  { $match: { createdAt: { $gte: period.from, $lt: period.to } } },
  { $addFields: { bucket: vacancyBucketExpression(), municipalityBucket: municipalityBucketExpression("$location") } },
  { $match: { bucket: { $in: POSTED_BUCKETS } } },
  ...(municipality ? [{ $match: { municipalityBucket: municipality } }] : []),
];

const countOf = async (Model, stages) => {
  const rows = await run(Model, [...stages, { $count: "n" }]);
  return rows[0] ? rows[0].n : 0;
};

// Vacancies and applications in a scope. The report generator refuses a report with fewer than
// 1 vacancy or 3 applications ("not enough data") before anything is exported.
const scopeCounts = async (period, municipality) => {
  const [vacancies, applications] = await Promise.all([countOf(JobVacancy, vacancyStages(period, municipality)), countOf(JobApplication, applicationStages(period, municipality))]);
  return { vacancies, applications, enough: vacancies >= 1 && applications >= 3 };
};

// ------------------------------------------------------------------ shared counting helpers

// Applications by status, for any scope stages (all time on the Dashboard, one period on Analytics).
const countApplicationStatuses = async (stages) => {
  const rows = await run(JobApplication, [...stages, { $group: { _id: "$status", count: { $sum: 1 } } }]);
  return applicationStatusCounts(rows);
};

// Vacancies by status for any scope stages.
const countVacancyStatuses = async (stages) => {
  const rows = await run(JobVacancy, [...stages, { $group: { _id: "$bucket", count: { $sum: 1 } } }]);
  return vacancyStatusCounts(rows);
};

const allTimeApplicationStages = () => [{ $project: { status: lowerStatus } }];
const allTimeVacancyStages = () => [{ $addFields: { bucket: vacancyBucketExpression() } }, { $match: { bucket: { $in: POSTED_BUCKETS } } }];

// ------------------------------------------------------------------ Analytics & Reports

const items = (order, counts, total) => order.map((key) => ({ key, count: counts[key], percent: percentOf(counts[key], total) }));

// A column of the municipality table: the real count of every municipality (a zero stays a zero). These are
// counts of applications, hires and vacancies, not of people by age, so the small-cell rule is not applied.
const column = (values, order) => new Map(order.map((key) => [key, { value: values.get(key) || 0, suppressed: false }]));

const getAnalyticsOverview = async (query = {}, now = new Date()) => {
  const { preset, period, municipality } = parseOverviewQuery(query, now);
  const granularity = granularityFor(period);
  const buckets = bucketList(period, granularity);

  const [apps, vacs, mapApps, mapVacs, jobseekers] = await Promise.all([
    run(JobApplication, [
      ...applicationStages(period, municipality),
      {
        $facet: {
          byStatus: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
          trendApplications: [{ $group: { _id: bucketGroup("$createdAt", granularity), count: { $sum: 1 } } }],
          trendHires: [{ $match: { status: { $in: HIRED_VALUES } } }, { $group: { _id: bucketGroup("$createdAt", granularity), count: { $sum: 1 } } }],
          byEmployer: [
            { $match: { status: { $ne: "withdrawn" } } },
            { $group: { _id: "$employer", applicants: { $sum: 1 }, hires: { $sum: { $cond: [{ $in: ["$status", HIRED_VALUES] }, 1, 0] } } } },
          ],
          byTitle: [{ $group: { _id: "$title", count: { $sum: 1 } } }],
        },
      },
    ]),
    run(JobVacancy, [
      ...vacancyStages(period, municipality),
      {
        $facet: {
          byStatus: [{ $group: { _id: "$bucket", count: { $sum: 1 } } }],
          trend: [{ $group: { _id: bucketGroup("$createdAt", granularity), count: { $sum: 1 } } }],
          byEmployer: [{ $group: { _id: "$employer", postings: { $sum: 1 } } }],
        },
      },
    ]),
    // The municipality table always lists every municipality, so it ignores the municipality filter.
    run(JobApplication, [
      ...applicationStages(period, null),
      { $group: { _id: "$municipalityBucket", applications: { $sum: 1 }, hires: { $sum: { $cond: [{ $in: ["$status", HIRED_VALUES] }, 1, 0] } } } },
    ]),
    run(JobVacancy, [...vacancyStages(period, null), { $group: { _id: "$municipalityBucket", vacancies: { $sum: 1 } } }]),
    run(User, [
      { $match: { role: "jobseeker", deletedAt: null, createdAt: { $gte: period.from, $lt: period.to } } },
      ...(municipality
        ? [
            { $lookup: { from: "jobseekerprofiles", localField: "_id", foreignField: "userId", as: "profile" } },
            { $addFields: { address: { $ifNull: [{ $arrayElemAt: ["$profile.presentAddress", 0] }, { $ifNull: [{ $arrayElemAt: ["$profile.permanentAddress", 0] }, {}] }] } } },
            { $addFields: { muni: applicantMunicipalityExpression("$address.municipality", "$address.province") } },
            { $match: { muni: municipality } },
          ]
        : []),
      { $count: "n" },
    ]),
  ]);

  const appFacets = apps[0] || {};
  const vacFacets = vacs[0] || {};
  const status = applicationStatusCounts(appFacets.byStatus);
  const vacancyStatus = vacancyStatusCounts(vacFacets.byStatus);

  // Top employers: verified, in good standing, and over the minimums for this scope.
  const postingsByEmployer = new Map((vacFacets.byEmployer || []).map((row) => [String(row._id), Number(row.postings || 0)]));
  const candidates = (appFacets.byEmployer || [])
    .map((row) => ({ employerId: String(row._id), applicants: Number(row.applicants || 0), hires: Number(row.hires || 0), postings: postingsByEmployer.get(String(row._id)) || 0 }))
    .filter((row) => row.postings >= PERFORMANCE.minPostings && row.applicants >= PERFORMANCE.minApplicants && row.hires >= PERFORMANCE.minHires);
  let topEmployers = [];
  if (candidates.length) {
    const users = await User.find({ _id: { $in: candidates.map((row) => row.employerId) } })
      .select("name companyName profileImage role verificationStatus isActive accountStatus deletedAt purgedAt")
      .lean();
    const profiles = await EmployerProfile.find({ userId: { $in: candidates.map((row) => row.employerId) } }).select("userId businessAddress.municipality").lean();
    const userById = new Map(users.map((user) => [String(user._id), user]));
    const profileById = new Map(profiles.map((profile) => [String(profile.userId), profile]));
    topEmployers = candidates
      .filter((row) => isEmployerEligible(userById.get(row.employerId)))
      .map((row) => {
        const user = userById.get(row.employerId);
        const address = profileById.get(row.employerId)?.businessAddress?.municipality;
        return {
          employerId: row.employerId,
          name: user.companyName || user.name || "Employer",
          photo: user.profileImage || null,
          municipality: address ? normalizeMunicipalityLabel(address) : null,
          applicants: row.applicants,
          hires: row.hires,
          _lower: wilsonLower(row.hires, row.applicants),
        };
      })
      .sort((a, b) => b.hires - a.hires || b._lower - a._lower || a.name.localeCompare(b.name))
      .slice(0, TOP_LIMIT)
      .map(({ _lower, ...row }, index) => ({ rank: index + 1, ...row }));
  }

  const roles = groupRoleTitles((appFacets.byTitle || []).map((row) => ({ title: row._id, count: row.count }))).slice(0, TOP_LIMIT);

  const appsByMuni = new Map(mapApps.map((row) => [row._id, Number(row.applications || 0)]));
  const hiresByMuni = new Map(mapApps.map((row) => [row._id, Number(row.hires || 0)]));
  const vacsByMuni = new Map(mapVacs.map((row) => [row._id, Number(row.vacancies || 0)]));
  const columns = {
    applications: column(appsByMuni, MUNICIPALITY_LABELS),
    hires: column(hiresByMuni, MUNICIPALITY_LABELS),
    vacancies: column(vacsByMuni, MUNICIPALITY_LABELS),
  };

  const applicationTotal = status.total;
  return {
    period: {
      preset,
      label: period.label,
      from: formatManilaDate(period.from),
      to: formatManilaDate(new Date(period.to.getTime() - 1)),
      granularity,
    },
    municipality,
    enoughData: vacancyStatus.total >= 1 && applicationTotal >= 3,
    cards: {
      applications: applicationTotal,
      hires: status.hires,
      vacancies: vacancyStatus,
      jobseekers: jobseekers[0] ? jobseekers[0].n : 0,
    },
    trend: {
      granularity,
      applications: series(appFacets.trendApplications, buckets),
      hires: series(appFacets.trendHires, buckets),
      vacancies: series(vacFacets.trend, buckets),
    },
    applicationsByStatus: { total: applicationTotal, items: items(APPLICATION_STATUS_ORDER, status.counts, applicationTotal) },
    vacanciesByStatus: { total: vacancyStatus.total, items: items(VACANCY_STATUS_ORDER, vacancyStatus, vacancyStatus.total) },
    topEmployers: { rows: topEmployers, minimums: { postings: PERFORMANCE.minPostings, applicants: PERFORMANCE.minApplicants, hires: PERFORMANCE.minHires } },
    topRoles: roles,
    municipalities: MUNICIPALITY_LABELS.map((label) => ({
      municipality: label,
      applications: columns.applications.get(label),
      hires: columns.hires.get(label),
      vacancies: columns.vacancies.get(label),
    })),
  };
};

// ------------------------------------------------------------------ Dashboard

const oldestDays = (date, now) => (date ? Math.max(0, Math.floor((now.getTime() - new Date(date).getTime()) / DAY_MS)) : null);

const getDashboardOverview = async (now = new Date()) => {
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const soon = new Date(now.getTime() + 7 * DAY_MS);
  const unlistedIds = await getUnlistedEmployerIds();
  const activeSeeker = { role: "jobseeker", deletedAt: null, isActive: { $ne: false }, accountStatus: { $nin: UNLISTED_ACCOUNT_STATUSES } };
  const openNotArchived = { status: "active", archived: { $ne: true } };

  const [
    activeJobseekers,
    joinedLast30,
    employerTotal,
    employersVerified,
    employersPending,
    oldestPending,
    applicationStatus,
    vacancyStatus,
    closingSoon,
    hiddenByEmployer,
    reportsOpen,
    appealsOpen,
    recoveryOpen,
    byMunicipality,
    recent,
  ] = await Promise.all([
    User.countDocuments(activeSeeker),
    User.countDocuments({ ...activeSeeker, createdAt: { $gte: since30 } }),
    User.countDocuments({ role: "employer", deletedAt: null }),
    User.countDocuments({ role: "employer", deletedAt: null, verificationStatus: "verified" }),
    User.countDocuments({ role: "employer", deletedAt: null, verificationStatus: { $in: ["pending", "under_review"] } }),
    User.findOne({ role: "employer", deletedAt: null, verificationStatus: { $in: ["pending", "under_review"] } })
      .sort({ verificationSubmittedAt: 1, createdAt: 1 })
      .select("verificationSubmittedAt createdAt")
      .lean(),
    countApplicationStatuses(allTimeApplicationStages()),
    countVacancyStatuses(allTimeVacancyStages()),
    JobVacancy.countDocuments({ ...openNotArchived, applicationDeadline: { $gt: now, $lte: soon } }),
    unlistedIds.length ? JobVacancy.countDocuments({ ...openNotArchived, employer: { $in: unlistedIds } }) : 0,
    Report.countDocuments({ status: { $in: ["open", "under_review"] } }),
    Appeal.countDocuments({ status: { $in: ["pending", "under_review"] } }),
    AccountRecoveryRequest.countDocuments({ status: { $in: ["pending", "under_review"] }, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }),
    run(User, [
      { $match: activeSeeker },
      { $lookup: { from: "jobseekerprofiles", localField: "_id", foreignField: "userId", as: "profile" } },
      { $addFields: { address: { $ifNull: [{ $arrayElemAt: ["$profile.presentAddress", 0] }, { $ifNull: [{ $arrayElemAt: ["$profile.permanentAddress", 0] }, {}] }] } } },
      { $group: { _id: applicantMunicipalityExpression("$address.municipality", "$address.province"), count: { $sum: 1 } } },
    ]),
    // Only the kind of event and when: no person, address or message. Sign-in events are left out.
    AuditLog.find({ action: { $not: /^auth\./ } }).sort({ createdAt: -1 }).limit(5).select("action severity createdAt").lean(),
  ]);

  const counts = new Map(byMunicipality.map((row) => [row._id, Number(row.count || 0)]));
  // The Dashboard snapshot shows the real counts (they are about active accounts, not about minors).
  const municipalities = MUNICIPALITY_LABELS.map((label) => ({ municipality: label, value: counts.get(label) || 0, suppressed: false }));

  const attention = [
    { key: "employerVerification", count: employersPending, oldestDays: oldestDays(oldestPending && (oldestPending.verificationSubmittedAt || oldestPending.createdAt), now) },
    { key: "moderation", count: reportsOpen + appealsOpen, reports: reportsOpen, appeals: appealsOpen },
    { key: "accountRecovery", count: recoveryOpen },
    { key: "closingSoon", count: closingSoon },
    { key: "hiddenByEmployer", count: hiddenByEmployer },
  ];

  return {
    generatedAt: now.toISOString(),
    kpis: {
      activeJobseekers: { value: activeJobseekers, joinedLast30 },
      verifiedEmployers: { verified: employersVerified, total: employerTotal, pending: employersPending },
      openVacancies: { value: vacancyStatus.open, closingSoon },
      applicationsToReview: { value: applicationStatus.counts.pending },
    },
    attention,
    allClear: attention.every((row) => row.count === 0),
    jobseekersByMunicipality: municipalities,
    recentActivity: recent.map((row) => ({ id: String(row._id), action: row.action, severity: row.severity, at: row.createdAt })),
  };
};

module.exports = {
  PRESETS,
  parseOverviewQuery,
  granularityFor,
  bucketList,
  isoWeekKey,
  applicationStages,
  vacancyStages,
  scopeCounts,
  countApplicationStatuses,
  countVacancyStatuses,
  getAnalyticsOverview,
  getDashboardOverview,
};
