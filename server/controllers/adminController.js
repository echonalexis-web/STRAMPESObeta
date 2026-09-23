const User = require("../models/User");
const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const JobseekerProfile = require("../models/JobseekerProfile");
const EmployerProfile = require("../models/EmployerProfile");
const AuditLog = require("../models/AuditLog");
const { getApplicationCountMap, normalizeFeaturedOrdering } = require("../utils/jobDisplay");
const { logAuditEvent } = require("../services/auditService");
const { createNotificationForUser } = require("../services/notificationService");
const { forceLogout } = require("../services/sessionService");
const { escapeRegex } = require("../utils/sanitize");

const monthBuckets = () => Array.from({ length: 12 }, () => 0);

const MUNICIPALITY_LABELS = [
  "Boac (Capital)",
  "Santa Cruz",
  "Gasan",
  "Mogpog",
  "Torrijos",
  "Buenavista",
  "Other / Outside Province",
];

const escapeRegExp = (value = "") => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeMunicipality = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const lower = raw.toLowerCase();
  if (lower.includes("other") && (lower.includes("outside") || lower.includes("province") || lower.includes("marinduque"))) {
    return "Other / Outside Province";
  }
  if (lower.includes("boac") || lower.includes("capital")) return "Boac (Capital)";
  if (lower.includes("santa cruz")) return "Santa Cruz";
  if (lower.includes("gasan")) return "Gasan";
  if (lower.includes("mogpog")) return "Mogpog";
  if (lower.includes("torrijos")) return "Torrijos";
  if (lower.includes("buenavista")) return "Buenavista";
  return raw;
};

const normalizeMunicipalityLabel = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "Other / Outside Province";

  const normalized = normalizeMunicipality(raw);
  if (normalized && MUNICIPALITY_LABELS.includes(normalized)) {
    return normalized;
  }

  return "Other / Outside Province";
};

const getMunicipalityFilterPattern = (value = "") => {
  const normalizedMunicipality = normalizeMunicipalityLabel(value);

  const patternMap = {
    "Boac (Capital)": "boac|capital",
    "Santa Cruz": "santa\\s*cruz",
    "Gasan": "gasan",
    "Mogpog": "mogpog",
    "Torrijos": "torrijos",
    "Buenavista": "buenavista",
    "Other / Outside Province": "^(?!.*(?:boac|santa\\s*cruz|gasan|mogpog|torrijos|buenavista)).*$",
  };

  return patternMap[normalizedMunicipality] || escapeRegExp(normalizedMunicipality);
};

const normalizeAdminJobStatus = (value = "") => {
  const status = String(value || "").trim().toLowerCase();

  if (status === "draft" || status === "pending" || status === "review") return "pending";
  if (status === "active") return "active";
  if (status === "closed" || status === "filled" || status === "hired" || status === "completed") return "closed";
  if (status === "rejected" || status === "declined" || status === "denied") return "rejected";

  return "pending";
};

if (typeof module !== "undefined") {
  module.exports = module.exports || {};
  module.exports.escapeRegExp = escapeRegExp;
  module.exports.normalizeAdminJobStatus = normalizeAdminJobStatus;
  module.exports.normalizeMunicipalityLabel = normalizeMunicipalityLabel;
}

const normalizeApplicantMunicipality = (municipality = "", province = "") => {
  const rawMunicipality = String(municipality || "").trim();
  const rawProvince = String(province || "").trim();
  const normalizedProvince = rawProvince.toLowerCase();

  if (!rawMunicipality && !rawProvince) {
    return "Other";
  }

  if (!normalizedProvince.includes("marinduque")) {
    return "Other";
  }

  const normalizedMunicipality = normalizeMunicipality(rawMunicipality);
  return MUNICIPALITY_LABELS.includes(normalizedMunicipality) ? normalizedMunicipality : "Other";
};

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

const normalizeApplicationStatus = (status = "") => {
  const value = String(status || "").toLowerCase();
  if (value === "accepted") return "hired";
  if (["pending", "reviewed", "shortlisted", "rejected", "hired"].includes(value)) {
    return value;
  }
  return null;
};

exports.getAdminAnalytics = async (req, res) => {
  try {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const startOfNextYear = new Date(now.getFullYear() + 1, 0, 1);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      totalAccounts,
      totalEmployers,
      totalJobSeekers,
      totalVacancies,
      totalApplications,
      verifiedEmployers,
      pendingVerification,
      activeJobs,
      closedJobs,
      yearlyApplications,
      yearlyRegistrations,
      applications,
      auditEventsToday,
    ] = await Promise.all([
      User.countDocuments({ role: { $ne: "superadmin" } }),
      User.countDocuments({ role: "employer" }),
      User.countDocuments({ role: "jobseeker" }),
      JobVacancy.countDocuments(),
      JobApplication.countDocuments(),
      User.countDocuments({ role: "employer", verificationStatus: "verified" }),
      User.countDocuments({ role: "employer", verificationStatus: "pending" }),
      JobVacancy.countDocuments({ status: "active" }),
      JobVacancy.countDocuments({ status: "closed" }),
      JobApplication.find({ createdAt: { $gte: startOfYear, $lt: startOfNextYear } }).select("createdAt appliedAt"),
      User.find({ createdAt: { $gte: startOfYear, $lt: startOfNextYear } }).select("createdAt"),
      JobApplication.find().select("status"),
      AuditLog.countDocuments({ createdAt: { $gte: startOfDay } }),
    ]);

    const applicationsThisMonth = monthBuckets();
    yearlyApplications.forEach((item) => {
      const sourceDate = item.createdAt || item.appliedAt;
      if (!sourceDate) return;
      applicationsThisMonth[new Date(sourceDate).getMonth()] += 1;
    });

    const registrationsThisMonth = monthBuckets();
    yearlyRegistrations.forEach((item) => {
      if (!item.createdAt) return;
      registrationsThisMonth[new Date(item.createdAt).getMonth()] += 1;
    });

    const applicationsByStatus = {
      pending: 0,
      reviewed: 0,
      shortlisted: 0,
      rejected: 0,
      hired: 0,
    };

    applications.forEach((item) => {
      const normalized = normalizeApplicationStatus(item.status);
      if (normalized) {
        applicationsByStatus[normalized] += 1;
      }
    });

    return res.json({
      totalAccounts,
      totalEmployers,
      totalJobSeekers,
      totalVacancies,
      totalApplications,
      verifiedEmployers,
      pendingVerification,
      activeJobs,
      closedJobs,
      applicationsThisMonth,
      registrationsThisMonth,
      applicationsByStatus,
      auditEventsToday,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to fetch analytics" });
  }
};

exports.getProvincialAnalytics = async (req, res) => {
  try {
    const year = Number(req.query.year) || 2026;
    const selectedMunicipality = String(req.query.municipality || "ALL").trim();
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);
    const municipalityMatch = selectedMunicipality && selectedMunicipality !== "ALL"
      ? normalizeMunicipality(selectedMunicipality)
      : "ALL";

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const monthlyRegistrationPipeline = [
      {
        $match: {
          createdAt: { $gte: yearStart, $lt: yearEnd },
          role: { $in: ["jobseeker", "employer"] },
        },
      },
      {
        $group: {
          _id: { month: { $month: "$createdAt" } },
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
          _id: { month: { $month: "$createdAt" } },
          applied: { $sum: 1 },
          hired: { $sum: { $cond: [{ $eq: ["$status", "hired"] }, 1, 0] } },
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
            hiredApplications: { $sum: { $cond: [{ $eq: ["$status", "hired"] }, 1, 0] } },
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
        {
          $match: {
            ...vacancyFilter,
            isActive: true,
            industry: { $ne: "" },
          },
        },
        {
          $group: {
            _id: "$industry",
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

    const uniqueApplicants = await JobApplication.distinct("applicant", {
      createdAt: { $gte: yearStart, $lt: yearEnd },
    });

    const applicantProfiles = await JobseekerProfile.find({
      userId: { $in: uniqueApplicants },
    }).select("userId presentAddress permanentAddress").lean();

    const applicantMunicipalityCounts = new Map();

    applicantProfiles.forEach((profile) => {
      const applicantAddress = profile.presentAddress || profile.permanentAddress || {};
      const municipality = String(applicantAddress.municipality || "").trim();
      const province = String(applicantAddress.province || "").trim();
      const normalized = normalizeApplicantMunicipality(municipality, province);
      applicantMunicipalityCounts.set(normalized, (applicantMunicipalityCounts.get(normalized) || 0) + 1);
    });

    const totalMunicipalityValue = vacancyMunicipalityAgg.reduce((sum, item) => sum + Number(item.value || 0), 0) || 1;
    const municipalityBreakdown = MUNICIPALITY_LABELS.map((municipality) => {
      const found = vacancyMunicipalityAgg.find((item) => item._id === municipality);
      const value = Number(found?.value || 0);
      return {
        municipality,
        value,
        percent: totalMunicipalityValue > 0 ? Number(((value / totalMunicipalityValue) * 100).toFixed(1)) : 0,
      };
    }).sort((a, b) => b.value - a.value);

    const applicantMunicipalityTotal = [...applicantMunicipalityCounts.values()].reduce((sum, value) => sum + value, 0) || 1;
    const applicantMunicipalityBreakdown = [...new Set([...MUNICIPALITY_LABELS, "Other"])].map((municipality) => {
      const value = Number(applicantMunicipalityCounts.get(municipality) || 0);
      return {
        municipality,
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

    return res.json({
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
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to fetch provincial analytics" });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const role = String(req.query.role || "").trim();
    const search = String(req.query.search || "").trim();
    const verificationStatus = String(req.query.verificationStatus || "").trim();
    const isActiveRaw = String(req.query.isActive || "").trim();
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 20, 1);

    // Superadmin accounts are invisible to the admin surface — they never show
    // in listings, counts, or moderation targets.
    const filter = { role: { $ne: "superadmin" } };

    if (["employer", "jobseeker", "admin"].includes(role)) {
      filter.role = role;
    }

    if (["pending", "verified", "unverified"].includes(verificationStatus)) {
      filter.verificationStatus = verificationStatus;
    }

    if (["true", "false"].includes(isActiveRaw)) {
      filter.isActive = isActiveRaw === "true";
    }

    if (search) {
      filter.$or = [
        { name: { $regex: escapeRegex(search), $options: "i" } },
        { email: { $regex: escapeRegex(search), $options: "i" } },
      ];
    }

    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select(
          "name email role createdAt hasCompletedOnboarding verificationStatus isActive companyName businessPermitUrl registrationDocUrl verificationNote verificationSubmittedAt"
        )
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

    return res.json({
      users,
      total,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      currentPage: page,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to fetch users" });
  }
};

const AUDIT_CATEGORY_PREFIXES = {
  "auth-security": ["auth."],
  "user-account": ["user."],
  "applicant-jobs": ["job.application."],
  "employer-management": ["employer."],
  "user-management": ["admin.user.", "admin.verification_queue."],
  "job-management": ["admin.job."],
  "news-announcements": ["admin.news."],
  "audit-analytics": ["admin.audit."],
  "messaging": ["message."],
  "notifications": ["notification."],
  "social-interactions": ["social.user."],
  "job-interactions": ["social.job."],
  "search-discovery": ["search."],
  "system-maintenance": ["system."],
};

exports.getAuditLogs = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const action = String(req.query.action || "").trim();
    const severity = String(req.query.severity || "").trim();
    const search = String(req.query.search || "").trim();
    const category = String(req.query.category || "").trim();
    const fromDate = String(req.query.fromDate || "").trim();
    const toDate = String(req.query.toDate || "").trim();

    const andConditions = [];

    if (action) {
      andConditions.push({ action: { $regex: escapeRegex(action), $options: "i" } });
    }

    if (["info", "warning", "critical"].includes(severity)) {
      andConditions.push({ severity });
    }

    if (category && category !== "all" && AUDIT_CATEGORY_PREFIXES[category]) {
      andConditions.push({
        $or: AUDIT_CATEGORY_PREFIXES[category].map((prefix) => ({
          action: { $regex: `^${escapeRegex(prefix)}` },
        })),
      });
    }

    if (fromDate || toDate) {
      const createdAt = {};
      if (fromDate) {
        const start = new Date(`${fromDate}T00:00:00`);
        if (!Number.isNaN(start.getTime())) createdAt.$gte = start;
      }
      if (toDate) {
        const end = new Date(`${toDate}T23:59:59.999`);
        if (!Number.isNaN(end.getTime())) createdAt.$lte = end;
      }
      if (Object.keys(createdAt).length > 0) {
        andConditions.push({ createdAt });
      }
    }

    const matchStage = andConditions.length > 0 ? { $and: andConditions } : {};

    const pipeline = [
      { $match: matchStage },
      {
        $lookup: {
          from: "users",
          localField: "actorId",
          foreignField: "_id",
          as: "actorInfo",
        },
      },
      { $unwind: { path: "$actorInfo", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "users",
          localField: "targetUserId",
          foreignField: "_id",
          as: "targetInfo",
        },
      },
      { $unwind: { path: "$targetInfo", preserveNullAndEmptyArrays: true } },
    ];

    if (search) {
      const searchRegex = { $regex: escapeRegex(search), $options: "i" };
      pipeline.push({
        $match: {
          $or: [
            { action: searchRegex },
            { "metadata.message": searchRegex },
            { "actorInfo.name": searchRegex },
            { "targetInfo.name": searchRegex },
            { actorRole: searchRegex },
            { targetType: searchRegex },
          ],
        },
      });
    }

    pipeline.push({
      $facet: {
        data: [
          { $sort: { createdAt: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
        ],
        totalCount: [{ $count: "count" }],
      },
    });

    const [result] = await AuditLog.aggregate(pipeline);
    const total = result?.totalCount?.[0]?.count || 0;
    const logs = (result?.data || []).map((log) => ({
      ...log,
      actorId: log.actorInfo
        ? {
            _id: log.actorInfo._id,
            name: log.actorInfo.name,
            email: log.actorInfo.email,
            role: log.actorInfo.role,
          }
        : log.actorId,
      targetUserId: log.targetInfo
        ? {
            _id: log.targetInfo._id,
            name: log.targetInfo.name,
            email: log.targetInfo.email,
            role: log.targetInfo.role,
          }
        : log.targetUserId,
    }));

    return res.json({
      items: logs,
      total,
      currentPage: page,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to load audit logs" });
  }
};

const buildAdminVacancyFilter = (query = {}) => {
  const search = String(query.search || "").trim();
  const municipality = String(query.municipality || "all").trim();
  const status = String(query.status || "all").trim();
  const category = String(query.category || "all").trim();

  const filter = {};

  if (search) {
    const regex = { $regex: escapeRegex(search), $options: "i" };
    filter.$or = [
      { title: regex },
      { industry: regex },
      { description: regex },
      { location: regex },
    ];
  }

  if (municipality !== "all") {
    const normalizedMunicipality = normalizeMunicipalityLabel(municipality);
    if (normalizedMunicipality === "Other / Outside Province") {
      filter.location = { $not: /boac|santa\s*cruz|gasan|mogpog|torrijos|buenavista/i };
    } else {
      filter.location = { $regex: getMunicipalityFilterPattern(normalizedMunicipality), $options: "i" };
    }
  }

  if (status !== "all") {
    const normalizedStatus = normalizeAdminJobStatus(status);
    if (normalizedStatus === "pending") {
      filter.$or = [
        ...(filter.$or || []),
        { status: "draft" },
        { status: "active" },
      ];
    } else {
      filter.status = normalizedStatus;
    }
  }

  if (category !== "all") {
    filter.industry = { $regex: escapeRegex(category), $options: "i" };
  }

  return filter;
};

exports.getAdminVacancies = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
    const skip = (page - 1) * limit;

    const filter = buildAdminVacancyFilter(req.query);

    const [total, jobs] = await Promise.all([
      JobVacancy.countDocuments(filter),
      JobVacancy.find(filter)
        .populate("employer", "name email companyName verificationStatus")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
    ]);

    const jobIds = jobs.map((job) => job._id);
    const applicationCountMap = await getApplicationCountMap(jobIds);

    const normalizedJobs = jobs.map((job) => {
      const employer = job.employer || {};
      const normalizedStatus = normalizeAdminJobStatus(job.status);
      const municipalityLabel = normalizeMunicipalityLabel(job.location || "");
      const severity = Number(job.slots || 0) >= 8 ? "High Demand" : Number(job.slots || 0) >= 4 ? "Priority" : "Standard";

      return {
        _id: job._id,
        title: job.title,
        description: job.description,
        location: job.location,
        municipality: municipalityLabel,
        industry: job.industry || "General",
        jobType: job.jobType,
        salary: job.salary || (job.salaryMin && job.salaryMax ? `₱${job.salaryMin} - ₱${job.salaryMax}` : "Not specified"),
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        slots: Number(job.slots || 0),
        status: normalizedStatus,
        isActive: Boolean(job.isActive),
        createdAt: job.createdAt,
        employer: {
          _id: employer._id,
          name: employer.name,
          companyName: employer.companyName,
          email: employer.email,
          verificationStatus: employer.verificationStatus || "unverified",
        },
        applicantCount: Number(applicationCountMap[String(job._id)] || 0),
        qualifications: job.qualifications || [],
        severity,
      };
    });

    return res.json({
      jobs: normalizedJobs,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to fetch admin job monitoring list" });
  }
};

exports.getAdminVacancyStats = async (req, res) => {
  try {
    const filter = buildAdminVacancyFilter(req.query);

    const jobs = await JobVacancy.find(filter).select("location slots status").lean();
    const jobIds = jobs.map((job) => job._id);
    const applicationCountMap = await getApplicationCountMap(jobIds);

    const municipalityMap = new Map(
      MUNICIPALITY_LABELS.map((label) => [label, { label, jobs: 0, slots: 0 }])
    );

    const statusCounts = { active: 0, pending: 0, closed: 0, rejected: 0 };
    let totalSlots = 0;

    jobs.forEach((job) => {
      const label = normalizeMunicipalityLabel(job.location || "");
      const bucket = municipalityMap.get(label) || municipalityMap.get("Other / Outside Province");
      const slots = Number(job.slots || 0);

      bucket.jobs += 1;
      bucket.slots += slots;
      totalSlots += slots;

      const normalizedStatus = normalizeAdminJobStatus(job.status);
      if (statusCounts[normalizedStatus] !== undefined) {
        statusCounts[normalizedStatus] += 1;
      }
    });

    const applications = Object.values(applicationCountMap).reduce(
      (sum, count) => sum + Number(count || 0),
      0
    );

    return res.json({
      totals: {
        totalPostings: jobs.length,
        active: statusCounts.active,
        pending: statusCounts.pending,
        closed: statusCounts.closed,
        rejected: statusCounts.rejected,
        totalSlots,
        applications,
      },
      municipalityBreakdown: Array.from(municipalityMap.values()),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to fetch job monitoring stats" });
  }
};

exports.getHomepageJobManagement = async (req, res) => {
  try {
    const jobs = await JobVacancy.find({ isActive: true, status: { $ne: "closed" } })
      .populate("employer", "name email companyName verificationStatus")
      .sort({ createdAt: -1 });

    const countMap = await getApplicationCountMap(jobs.map((job) => job._id));
    const jobsWithCounts = jobs.map((job) => ({
      ...job.toObject(),
      applicationCount: Number(countMap[String(job._id)] || 0),
    }));

    const rankedJobs = [...jobsWithCounts].sort((left, right) => {
      if (right.applicationCount !== left.applicationCount) {
        return right.applicationCount - left.applicationCount;
      }

      return new Date(right.createdAt || 0) - new Date(left.createdAt || 0);
    });

    return res.json({
      jobs: jobsWithCounts,
      rankedJobs,
      featuredCount: jobsWithCounts.filter((job) => job.isFeatured).length,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to fetch homepage job management data" });
  }
};

exports.toggleHomepageFeature = async (req, res) => {
  try {
    const { id } = req.params;
    const desiredFeatured = Boolean(req.body.isFeatured);

    const job = await JobVacancy.findById(id);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    if (!job.isActive || job.status === "closed") {
      return res.status(400).json({ message: "Only active jobs can be featured on the homepage" });
    }

    if (desiredFeatured) {
      if (!job.isFeatured) {
        const featuredCount = await JobVacancy.countDocuments({ isFeatured: true });
        if (featuredCount >= 4) {
          return res.status(400).json({ message: "You can only feature up to 4 jobs on the homepage" });
        }

        const featuredJobs = await JobVacancy.find({ isFeatured: true }).sort({ featuredOrder: 1, createdAt: -1 });
        const nextOrder = featuredJobs.length + 1;
        job.isFeatured = true;
        job.featuredOrder = nextOrder;
      }
    } else {
      job.isFeatured = false;
      job.featuredOrder = null;
    }

    job.updatedAt = new Date();
    await job.save();

    const featuredJobs = await JobVacancy.find({ isFeatured: true }).sort({ featuredOrder: 1, createdAt: -1 });
    await normalizeFeaturedOrdering(featuredJobs);

    const updatedJob = await JobVacancy.findById(id).populate("employer", "name email companyName verificationStatus");

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "admin",
      action: desiredFeatured ? "admin.job.featured_enabled" : "admin.job.featured_disabled",
      targetType: "job",
      targetId: String(job._id),
      severity: "info",
      metadata: {
        isFeatured: desiredFeatured,
      },
    });

    if (desiredFeatured) {
      await createNotificationForUser({
        recipientId: job.employer,
        actorId: req.user.id,
        type: "admin_action",
        title: "Your job posting was featured",
        message: `"${job.title}" is now featured on the homepage.`,
        relatedEntityType: "job",
        relatedEntityId: job._id,
        actionUrl: "/employer",
        io: req.app.get("io"),
      });
    }

    return res.json({
      message: desiredFeatured ? "Job featured on homepage" : "Job removed from homepage featured list",
      job: updatedJob,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to update homepage feature" });
  }
};

exports.updateUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    // Admins can only move accounts between the two public roles. Granting or
    // revoking the "admin" role is a superadmin-only action performed from the
    // superadmin console — never from here — and "superadmin" is never assignable
    // through the app at all.
    if (!["jobseeker", "employer"].includes(role)) {
      return res.status(400).json({
        message:
          "Invalid role. Admin accounts are managed by the system superadmin in the superadmin console.",
      });
    }

    const user = await User.findById(id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role === "admin" || user.role === "superadmin") {
      return res.status(403).json({
        message: "Staff accounts can only be changed by the system superadmin.",
      });
    }

    user.role = role;
    await user.save();

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "admin",
      action: "admin.user.role_updated",
      targetUserId: user._id,
      targetType: "user",
      targetId: String(user._id),
      severity: "warning",
      metadata: {
        newRole: role,
      },
    });

    await createNotificationForUser({
      recipientId: user._id,
      actorId: req.user.id,
      type: "admin_action",
      title: "Your account role was updated",
      message: `An administrator changed your account role to ${role}.`,
      relatedEntityType: "user",
      relatedEntityId: user._id,
      actionUrl: "/profile",
      metadata: { newRole: role },
      io: req.app.get("io"),
    });

    return res.json({
      message: "User role updated",
      user,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to update role" });
  }
};

exports.deactivateUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (String(req.user.id) === String(id)) {
      return res.status(400).json({ message: "Admin cannot deactivate their own account" });
    }

    const user = await User.findById(id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role === "superadmin") {
      return res.status(403).json({ message: "Superadmin accounts cannot be modified here." });
    }

    const permanent = req.body.permanent === true || req.body.permanent === "true";
    const reason = String(req.body.reason || "").trim() || null;

    user.isActive = false;
    user.accountStatus = permanent ? "banned" : "suspended";
    user.suspensionReason = reason;
    user.suspendedAt = new Date();
    user.suspendedBy = req.user.id;
    await user.save();

    // End any session this account already has open right now — the
    // isActive check in verifyToken only catches their *next* request, which
    // could be minutes away (or never, if they just leave the tab idle).
    forceLogout(req.app.get("io"), user._id, {
      // Same code/shape as the 403 verifyToken/login already return for a
      // suspended account — "banned" vs "suspended" is distinguished by
      // accountStatus within that one code, not a separate code.
      code: "ACCOUNT_SUSPENDED",
      message: permanent
        ? "This account has been banned by an administrator."
        : "This account has been suspended by an administrator.",
      accountStatus: user.accountStatus,
      suspensionReason: user.suspensionReason,
      suspendedAt: user.suspendedAt,
    });

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "admin",
      action: "admin.user.deactivated",
      targetUserId: user._id,
      targetType: "user",
      targetId: String(user._id),
      severity: "critical",
      metadata: { accountStatus: user.accountStatus, reason },
    });

    await createNotificationForUser({
      recipientId: user._id,
      actorId: req.user.id,
      type: "admin_action",
      title: permanent ? "Your account was banned" : "Your account was suspended",
      message: reason
        ? `An administrator ${permanent ? "banned" : "suspended"} your account. Reason: ${reason}. You can appeal to LMD Admin from the login screen.`
        : `An administrator ${permanent ? "banned" : "suspended"} your account. You can appeal to LMD Admin from the login screen.`,
      relatedEntityType: "user",
      relatedEntityId: user._id,
      io: req.app.get("io"),
    });

    return res.json({ message: `User ${permanent ? "banned" : "suspended"}`, user });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to deactivate user" });
  }
};

exports.reactivateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.isActive = true;
    user.accountStatus = "active";
    user.suspensionReason = null;
    user.suspendedAt = null;
    user.suspendedBy = null;
    await user.save();

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "admin",
      action: "admin.user.reactivated",
      targetUserId: user._id,
      targetType: "user",
      targetId: String(user._id),
      severity: "warning",
    });

    await createNotificationForUser({
      recipientId: user._id,
      actorId: req.user.id,
      type: "admin_action",
      title: "Your account was reactivated",
      message: "An administrator reactivated your account. You can log in again.",
      relatedEntityType: "user",
      relatedEntityId: user._id,
      io: req.app.get("io"),
    });

    return res.json({ message: "User reactivated", user });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to reactivate user" });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (String(req.user.id) === String(id)) {
      return res.status(400).json({ message: "Admin cannot delete themselves" });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role === "superadmin" || user.role === "admin") {
      return res.status(403).json({
        message: "Staff accounts are managed by the system superadmin and cannot be deleted here.",
      });
    }

    const jobs = await JobVacancy.find({ employer: id }).select("_id");
    const jobIds = jobs.map((job) => job._id);

    const conversations = await Conversation.find({ participants: id }).select("_id");
    const conversationIds = conversations.map((item) => item._id);

    await Promise.all([
      JobApplication.deleteMany({
        $or: [{ applicant: id }, ...(jobIds.length ? [{ vacancy: { $in: jobIds } }] : [])],
      }),
      jobIds.length ? JobVacancy.deleteMany({ _id: { $in: jobIds } }) : Promise.resolve(),
      conversationIds.length
        ? Message.deleteMany({
            $or: [{ conversationId: { $in: conversationIds } }, { sender: id }],
          })
        : Message.deleteMany({ sender: id }),
      Conversation.deleteMany({ participants: id }),
      User.findByIdAndDelete(id),
    ]);

    forceLogout(req.app.get("io"), id, {
      code: "ACCOUNT_DELETED",
      message: "This account has been deleted by an administrator.",
    });

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "admin",
      action: "admin.user.deleted",
      targetUserId: user._id,
      targetType: "user",
      targetId: String(user._id),
      severity: "critical",
      metadata: {
        role: user.role,
      },
    });

    return res.json({ message: "User deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to delete user" });
  }
};

exports.getUserProfileDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Superadmin accounts are not part of the admin surface.
    if (user.role === "superadmin") {
      return res.status(404).json({ message: "User not found" });
    }

    let profile = null;
    let stats = {};
    let employerJobs = [];

    if (user.role === "jobseeker") {
      profile = await JobseekerProfile.findOne({ userId: user._id });
      const totalApplications = await JobApplication.countDocuments({ applicant: user._id });
      stats = { totalApplications };
    }

    if (user.role === "employer") {
      profile = await EmployerProfile.findOne({ userId: user._id });

      const jobs = await JobVacancy.find({ employer: user._id })
        .select("title location status isActive createdAt")
        .sort({ createdAt: -1 });

      const countMap = await getApplicationCountMap(jobs.map((job) => job._id));
      employerJobs = jobs.map((job) => ({
        ...job.toObject(),
        applicationCount: Number(countMap[String(job._id)] || 0),
      }));

      const [activeJobs, closedJobs] = await Promise.all([
        JobVacancy.countDocuments({ employer: user._id, status: { $ne: "closed" }, isActive: true }),
        JobVacancy.countDocuments({ employer: user._id, status: "closed" }),
      ]);

      const totalApplicants = employerJobs.reduce(
        (sum, job) => sum + Number(job.applicationCount || 0),
        0
      );

      stats = {
        activeJobs,
        closedJobs,
        totalApplicants,
      };
    }

    return res.json({
      user,
      profile,
      stats,
      employerJobs,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to fetch user profile details" });
  }
};

// Permanent job deletion moved to the superadmin (policy-violation takedown).
// PESO admins can only close/reject a vacancy via updateJobStatus below.

exports.updateJobStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["active", "closed"].includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const job = await JobVacancy.findById(id);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    job.status = status;
    job.isActive = status === "active";
    job.updatedAt = new Date();

    if (status === "closed") {
      job.isFeatured = false;
      job.featuredOrder = null;
    }

    await job.save();

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "admin",
      action: "admin.job.status_updated",
      targetType: "job",
      targetId: String(job._id),
      severity: status === "closed" ? "warning" : "info",
      metadata: {
        status,
      },
    });

    await createNotificationForUser({
      recipientId: job.employer,
      actorId: req.user.id,
      type: "admin_action",
      title: status === "closed" ? "Your job posting was closed" : "Your job posting was reopened",
      message: `An administrator ${status === "closed" ? "closed" : "reopened"} your job posting "${job.title}".`,
      relatedEntityType: "job",
      relatedEntityId: job._id,
      actionUrl: "/employer",
      io: req.app.get("io"),
    });

    return res.json({
      message: status === "closed" ? "Job closed" : "Job reopened",
      job,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to update job status" });
  }
};