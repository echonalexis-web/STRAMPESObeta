// The numbers behind GET /admin/analytics and GET /admin/analytics/provincial.
//
// Computed in the database (the golden tests compare the numbers with the old inline code).
// Since the fix commit the rules are:
//   - soft-deleted accounts are not counted
//   - "active jobs" is what a jobseeker can see (the visibility rule); activeJobsAll keeps the old count
//   - every application status is counted (under_review, approved and withdrawn used to be dropped)
//   - year and month edges, and "today", are in Asia/Manila, not the server's time zone
//   - the provincial default year is the current Manila year, not a fixed 2026
//   - blank industries are no longer counted as a sector

const User = require("../../models/User");
const JobVacancy = require("../../models/JobVacancy");
const JobApplication = require("../../models/JobApplication");
const AuditLog = require("../../models/AuditLog");
const { withListedEmployers } = require("../../utils/jobVisibility");
const { MANILA_TZ, startOfManilaDay, manilaParts, currentManilaYear } = require("./period");
const {
  MUNICIPALITY_LABELS,
  normalizeMunicipality,
  getMunicipalityFilterPattern,
  normalizeApplicantMunicipality,
} = require("./municipality");

const TIME_ZONE = MANILA_TZ;

const monthBuckets = () => Array.from({ length: 12 }, () => 0);

const normalizeSector = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "Services";
  const lower = raw.toLowerCase();
  if (lower.includes("public")) return "Public Sector";
  if (lower.includes("agri") || lower.includes("fish")) return "Agriculture & Fisheries";
  if (lower.includes("retail") || lower.includes("wholesale") || lower.includes("commerce")) return "Wholesale & Retail";
  if (lower.includes("tour") || lower.includes("hospitality") || lower.includes("hotel")) return "Tourism & Hospitality";
  if (lower.includes("service") || lower.includes("support") || lower.includes("care")) return "Services";
  return raw;
};

// Every status an application can have today, plus the legacy "reviewed" that older rows
// may still carry. "accepted" is the legacy spelling of hired.
const APPLICATION_STATUS_KEYS = Object.freeze(["pending", "under_review", "reviewed", "shortlisted", "approved", "rejected", "hired", "withdrawn"]);

const normalizeApplicationStatus = (status = "") => {
  const value = String(status || "").toLowerCase();
  if (value === "accepted") return "hired";
  if (APPLICATION_STATUS_KEYS.includes(value)) return value;
  return null;
};

const emptyStatusCounts = () => Object.fromEntries(APPLICATION_STATUS_KEYS.map((key) => [key, 0]));

// 12 monthly counts of the documents of one collection created in [from, to) (Manila months).
const monthlyCounts = async (Model, from, to, extraMatch = {}) => {
  const rows = await Model.aggregate([
    { $match: { createdAt: { $gte: from, $lt: to }, ...extraMatch } },
    { $group: { _id: { $month: { date: "$createdAt", timezone: TIME_ZONE } }, count: { $sum: 1 } } },
  ]);
  const buckets = monthBuckets();
  for (const row of rows) {
    const index = Number(row._id) - 1;
    if (index >= 0 && index < 12) buckets[index] += Number(row.count || 0);
  }
  return buckets;
};

const getDashboardAnalytics = async (now = new Date()) => {
  const today = manilaParts(now);
  const startOfYear = startOfManilaDay(today.year, 1, 1);
  const startOfNextYear = startOfManilaDay(today.year + 1, 1, 1);
  const startOfDay = startOfManilaDay(today.year, today.month, today.day);

  // What a jobseeker can see right now: active, not archived, not past its deadline, and the
  // employer's account is in good standing (utils/jobVisibility is the one definition).
  const visibleJobFilter = await withListedEmployers({
    isActive: true,
    status: "active",
    archived: { $ne: true },
    $or: [{ applicationDeadline: null }, { applicationDeadline: { $gt: now } }],
  });
  const notDeleted = { deletedAt: null };

  const [
    totalAccounts,
    totalEmployers,
    totalJobSeekers,
    totalVacancies,
    totalApplications,
    verifiedEmployers,
    pendingVerification,
    activeJobs,
    activeJobsAll,
    closedJobs,
    applicationsThisMonth,
    registrationsThisMonth,
    statusRows,
    auditEventsToday,
  ] = await Promise.all([
    User.countDocuments({ role: { $ne: "superadmin" }, ...notDeleted }),
    User.countDocuments({ role: "employer", ...notDeleted }),
    User.countDocuments({ role: "jobseeker", ...notDeleted }),
    JobVacancy.countDocuments(),
    JobApplication.countDocuments(),
    User.countDocuments({ role: "employer", verificationStatus: "verified", ...notDeleted }),
    User.countDocuments({ role: "employer", verificationStatus: "pending", ...notDeleted }),
    JobVacancy.countDocuments(visibleJobFilter),
    JobVacancy.countDocuments({ status: "active" }),
    JobVacancy.countDocuments({ status: "closed" }),
    monthlyCounts(JobApplication, startOfYear, startOfNextYear),
    monthlyCounts(User, startOfYear, startOfNextYear, notDeleted),
    JobApplication.aggregate([{ $group: { _id: { $toLower: { $ifNull: ["$status", ""] } }, count: { $sum: 1 } } }]),
    AuditLog.countDocuments({ createdAt: { $gte: startOfDay } }),
  ]);

  const applicationsByStatus = emptyStatusCounts();
  for (const row of statusRows) {
    const normalized = normalizeApplicationStatus(row._id);
    if (normalized) applicationsByStatus[normalized] += Number(row.count || 0);
  }

  return {
    totalAccounts,
    totalEmployers,
    totalJobSeekers,
    totalVacancies,
    totalApplications,
    verifiedEmployers,
    pendingVerification,
    activeJobs,
    // The old definition (status "active", whatever the deadline, archive flag or employer
    // standing): kept so staff can see how many postings are hidden from the public.
    activeJobsAll,
    closedJobs,
    applicationsThisMonth,
    registrationsThisMonth,
    applicationsByStatus,
    auditEventsToday,
  };
};

// Applicants of the year grouped by the municipality and province on their profile, in one
// aggregation. A profile's present address is used, else its permanent one (as before);
// an applicant with no profile is not counted (as before).
const applicantMunicipalityCounts = async (yearStart, yearEnd) => {
  const rows = await JobApplication.aggregate([
    { $match: { createdAt: { $gte: yearStart, $lt: yearEnd } } },
    { $group: { _id: "$applicant" } },
    { $lookup: { from: "jobseekerprofiles", localField: "_id", foreignField: "userId", as: "profile" } },
    { $unwind: "$profile" },
    { $project: { address: { $ifNull: ["$profile.presentAddress", { $ifNull: ["$profile.permanentAddress", { $literal: {} }] }] } } },
    {
      $group: {
        _id: { municipality: { $ifNull: ["$address.municipality", ""] }, province: { $ifNull: ["$address.province", ""] } },
        count: { $sum: 1 },
      },
    },
  ]);
  const counts = new Map();
  for (const row of rows) {
    const municipality = String((row._id && row._id.municipality) || "").trim();
    const province = String((row._id && row._id.province) || "").trim();
    const normalized = normalizeApplicantMunicipality(municipality, province);
    counts.set(normalized, (counts.get(normalized) || 0) + Number(row.count || 0));
  }
  return counts;
};

const getProvincialAnalytics = async ({ year, municipality = "ALL" } = {}) => {
  const selectedMunicipality = String(municipality || "ALL").trim();
  const yearStart = startOfManilaDay(year, 1, 1);
  const yearEnd = startOfManilaDay(year + 1, 1, 1);
  const municipalityMatch = selectedMunicipality && selectedMunicipality !== "ALL"
    ? normalizeMunicipality(selectedMunicipality)
    : "ALL";

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const monthlyRegistrationPipeline = [
    {
      $match: {
        createdAt: { $gte: yearStart, $lt: yearEnd },
        role: { $in: ["jobseeker", "employer"] },
        deletedAt: null,
      },
    },
    {
      $group: {
        _id: { month: { $month: { date: "$createdAt", timezone: TIME_ZONE } } },
        registered: { $sum: 1 },
      },
    },
  ];

  const monthlyApplicationPipeline = [
    {
      $match: {
        createdAt: { $gte: yearStart, $lt: yearEnd },
      },
    },
    {
      $group: {
        _id: { month: { $month: { date: "$createdAt", timezone: TIME_ZONE } } },
        applied: { $sum: 1 },
      },
    },
  ];

  const [registrationsByMonth, applicationsByMonth] = await Promise.all([
    User.aggregate(monthlyRegistrationPipeline),
    JobApplication.aggregate(monthlyApplicationPipeline),
  ]);

  const registrationMap = Object.fromEntries(registrationsByMonth.map((item) => [item._id.month, item.registered]));
  const applicationMap = Object.fromEntries(applicationsByMonth.map((item) => [item._id.month, item.applied]));

  const months = monthNames.map((month, index) => ({
    month,
    registered: Number(registrationMap[index + 1] || 0),
    applied: Number(applicationMap[index + 1] || 0),
  }));

  const vacancyFilter = {
    createdAt: { $gte: yearStart, $lt: yearEnd },
    status: { $in: ["active", "closed"] },
  };

  if (municipalityMatch !== "ALL") {
    vacancyFilter.location = { $regex: getMunicipalityFilterPattern(municipalityMatch), $options: "i" };
  }

  const [activeVacancies, closedVacancies, placementSummary, avgFillAggregate, topSectorAgg, topRoleAgg, vacancyMunicipalityAgg] = await Promise.all([
    JobVacancy.countDocuments({ ...vacancyFilter, isActive: true, status: "active" }),
    JobVacancy.countDocuments({ ...vacancyFilter, status: "closed" }),
    JobApplication.aggregate([
      {
        $match: { createdAt: { $gte: yearStart, $lt: yearEnd } },
      },
      {
        $lookup: {
          from: "jobvacancies",
          localField: "vacancy",
          foreignField: "_id",
          as: "vacancyDetails",
        },
      },
      {
        $unwind: { path: "$vacancyDetails", preserveNullAndEmptyArrays: true },
      },
      {
        $match: municipalityMatch === "ALL" ? {} : { "vacancyDetails.location": { $regex: getMunicipalityFilterPattern(municipalityMatch), $options: "i" } },
      },
      {
        $group: {
          _id: null,
          totalApplications: { $sum: 1 },
          // "accepted" is the legacy spelling of hired, as everywhere else
          hiredApplications: { $sum: { $cond: [{ $in: [{ $toLower: { $ifNull: ["$status", ""] } }, ["hired", "accepted"]] }, 1, 0] } },
        },
      },
    ]),
    JobVacancy.aggregate([
      {
        $match: {
          ...vacancyFilter,
          closedAt: { $ne: null },
          status: "closed",
        },
      },
      {
        $project: {
          daysToFill: {
            $divide: [{ $subtract: ["$closedAt", "$createdAt"] }, 1000 * 60 * 60 * 24],
          },
        },
      },
      {
        $group: {
          _id: null,
          avgDaysToFill: { $avg: "$daysToFill" },
          count: { $sum: 1 },
        },
      },
    ]),
    JobVacancy.aggregate([
      { $match: { ...vacancyFilter, isActive: true } },
      // `industry` is an array (a job can be tagged with more than one) —
      // normalize to a clean array (wrapping a not-yet-migrated plain
      // string, and dropping null/"" entries either way) before unwinding
      // so each industry gets its own count instead of grouping by the
      // whole array value or counting a blank as a category.
      {
        $addFields: {
          industryList: {
            $filter: {
              input: { $cond: [{ $isArray: "$industry" }, "$industry", ["$industry"]] },
              as: "ind",
              cond: { $and: [{ $ne: ["$$ind", null] }, { $ne: ["$$ind", ""] }] },
            },
          },
        },
      },
      { $match: { industryList: { $ne: [] } } },
      { $unwind: "$industryList" },
      {
        $group: {
          _id: "$industryList",
          vacancies: { $sum: { $max: ["$slots", 1] } },
        },
      },
      { $sort: { vacancies: -1, _id: 1 } },
      { $limit: 5 },
    ]),
    JobVacancy.aggregate([
      {
        $match: {
          ...vacancyFilter,
          isActive: true,
          title: { $ne: "" },
        },
      },
      {
        $group: {
          _id: "$title",
          vacancies: { $sum: { $max: ["$slots", 1] } },
        },
      },
      { $sort: { vacancies: -1, _id: 1 } },
      { $limit: 5 },
    ]),
    JobVacancy.aggregate([
      {
        $match: {
          ...vacancyFilter,
          isActive: true,
        },
      },
      {
        $project: {
          municipality: {
            $switch: {
              branches: [
                { case: { $regexMatch: { input: { $toLower: "$location" }, regex: "boac|capital" } }, then: "Boac (Capital)" },
                { case: { $regexMatch: { input: { $toLower: "$location" }, regex: "santa cruz" } }, then: "Santa Cruz" },
                { case: { $regexMatch: { input: { $toLower: "$location" }, regex: "gasan" } }, then: "Gasan" },
                { case: { $regexMatch: { input: { $toLower: "$location" }, regex: "mogpog" } }, then: "Mogpog" },
                { case: { $regexMatch: { input: { $toLower: "$location" }, regex: "torrijos" } }, then: "Torrijos" },
                { case: { $regexMatch: { input: { $toLower: "$location" }, regex: "buenavista" } }, then: "Buenavista" },
              ],
              default: "Other",
            },
          },
          value: { $max: ["$slots", 1] },
        },
      },
      {
        $match: { municipality: { $in: MUNICIPALITY_LABELS } },
      },
      {
        $group: {
          _id: "$municipality",
          value: { $sum: "$value" },
        },
      },
    ]),
  ]);

  const applicantMunicipalityCountsMap = await applicantMunicipalityCounts(yearStart, yearEnd);

  const totalMunicipalityValue = vacancyMunicipalityAgg.reduce((sum, item) => sum + Number(item.value || 0), 0) || 1;
  const municipalityBreakdown = MUNICIPALITY_LABELS.map((label) => {
    const found = vacancyMunicipalityAgg.find((item) => item._id === label);
    const value = Number(found?.value || 0);
    return {
      municipality: label,
      value,
      percent: totalMunicipalityValue > 0 ? Number(((value / totalMunicipalityValue) * 100).toFixed(1)) : 0,
    };
  }).sort((a, b) => b.value - a.value);

  const applicantMunicipalityTotal = [...applicantMunicipalityCountsMap.values()].reduce((sum, value) => sum + value, 0) || 1;
  const applicantMunicipalityBreakdown = [...new Set([...MUNICIPALITY_LABELS, "Other"])].map((label) => {
    const value = Number(applicantMunicipalityCountsMap.get(label) || 0);
    return {
      municipality: label,
      value,
      percent: applicantMunicipalityTotal > 0 ? Number(((value / applicantMunicipalityTotal) * 100).toFixed(1)) : 0,
    };
  }).sort((a, b) => b.value - a.value);

  const placementData = placementSummary[0] || { totalApplications: 0, hiredApplications: 0 };
  const totalApplications = Number(placementData.totalApplications || 0);
  const hiredApplications = Number(placementData.hiredApplications || 0);
  const placementRate = totalApplications > 0 ? Number(((hiredApplications / totalApplications) * 100).toFixed(1)) : 0;

  const avgDaysToFill = avgFillAggregate[0]?.avgDaysToFill
    ? Number(avgFillAggregate[0].avgDaysToFill.toFixed(1))
    : 0;

  const topSectors = topSectorAgg.map((item) => ({
    sector: normalizeSector(item._id),
    vacancies: Number(item.vacancies || 0),
  })).reduce((acc, item) => {
    const existing = acc.find((entry) => entry.sector === item.sector);
    if (existing) {
      existing.vacancies += item.vacancies;
      return acc;
    }
    acc.push(item);
    return acc;
  }, []).sort((a, b) => b.vacancies - a.vacancies).slice(0, 5);

  const topRoles = topRoleAgg.map((item) => ({
    title: item._id,
    vacancies: Number(item.vacancies || 0),
  })).sort((a, b) => b.vacancies - a.vacancies).slice(0, 5);

  const activeVsClosedRatio = `${Number(activeVacancies || 0)}:${Number(closedVacancies || 0)}`;

  return {
    period: String(year),
    selectedMunicipality: municipalityMatch === "ALL" ? "ALL" : municipalityMatch,
    metrics: {
      placementRate,
      avgDaysToFill,
      activeVacancies: Number(activeVacancies || 0),
      closedVacancies: Number(closedVacancies || 0),
      activeVsClosedRatio,
    },
    months,
    municipalities: municipalityBreakdown,
    applicantMunicipalities: applicantMunicipalityBreakdown,
    topSectors,
    topRoles,
  };
};

module.exports = {
  TIME_ZONE,
  APPLICATION_STATUS_KEYS,
  currentManilaYear,
  monthBuckets,
  normalizeSector,
  normalizeApplicationStatus,
  getDashboardAnalytics,
  getProvincialAnalytics,
};
