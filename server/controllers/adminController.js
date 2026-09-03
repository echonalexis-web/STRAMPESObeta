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
      User.countDocuments(),
      User.countDocuments({ role: "employer" }),
      User.countDocuments({ role: "resident" }),
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
          role: { $in: ["resident", "employer"] },
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

    const filter = {};

    if (["employer", "resident", "admin"].includes(role)) {
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
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select("name email role createdAt hasCompletedOnboarding verificationStatus isActive")
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

exports.getVerificationQueue = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 20, 1);
    const search = String(req.query.search || "").trim();

    const filter = {
      role: "employer",
      verificationStatus: "pending",
    };

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { companyName: { $regex: search, $options: "i" } },
      ];
    }

    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select("name email companyName verificationStatus businessPermitUrl registrationDocUrl createdAt")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

    return res.json({
      items: users,
      total,
      currentPage: page,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to load verification queue" });
  }
};

exports.getAuditLogs = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const action = String(req.query.action || "").trim();
    const severity = String(req.query.severity || "").trim();
    const search = String(req.query.search || "").trim();

    const filter = {};

    if (action) {
      filter.action = { $regex: action, $options: "i" };
    }

    if (["info", "warning", "critical"].includes(severity)) {
      filter.severity = severity;
    }

    if (search) {
      filter.$or = [
        { action: { $regex: search, $options: "i" } },
        { "metadata.message": { $regex: search, $options: "i" } },
      ];
    }

    const [total, logs] = await Promise.all([
      AuditLog.countDocuments(filter),
      AuditLog.find(filter)
        .populate("actorId", "name email role")
        .populate("targetUserId", "name email role")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

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
    const regex = { $regex: search, $options: "i" };
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
    filter.industry = { $regex: category, $options: "i" };
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

    if (!["resident", "employer", "admin"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role === "admin") {
      return res.status(403).json({ message: "Cannot change role of another admin" });
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

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.isActive = false;
    await user.save();

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "admin",
      action: "admin.user.deactivated",
      targetUserId: user._id,
      targetType: "user",
      targetId: String(user._id),
      severity: "critical",
    });

    return res.json({ message: "User deactivated", user });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to deactivate user" });
  }
};

exports.reactivateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.isActive = true;
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

    return res.json({ message: "User reactivated", user });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to reactivate user" });
  }
};

exports.updateEmployerVerification = async (req, res) => {
  try {
    const { id } = req.params;
    const { verificationStatus } = req.body;

    if (!["unverified", "pending", "verified"].includes(verificationStatus)) {
      return res.status(400).json({ message: "Invalid verification status" });
    }

    // Use findByIdAndUpdate with $set to only update verificationStatus,
    // bypassing validation on other fields (e.g., companySize)
    const user = await User.findByIdAndUpdate(
      id,
      { $set: { verificationStatus } },
      { new: true, runValidators: true }   // still validates the enum on verificationStatus
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role !== "employer") {
      return res.status(400).json({ message: "Only employers can be verified" });
    }

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "admin",
      action: "admin.user.verification_updated",
      targetUserId: user._id,
      targetType: "user",
      targetId: String(user._id),
      severity: verificationStatus === "verified" ? "info" : "warning",
      metadata: {
        verificationStatus,
      },
    });

    return res.json({ message: "Employer verification updated", user });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to update verification" });
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

    let profile = null;
    let stats = {};
    let employerJobs = [];

    if (user.role === "resident") {
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

exports.deleteJob = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await JobVacancy.findById(id);

    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    await Promise.all([
      JobApplication.deleteMany({ vacancy: job._id }),
      JobVacancy.findByIdAndDelete(job._id),
    ]);

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "admin",
      action: "admin.job.deleted",
      targetType: "job",
      targetId: String(job._id),
      severity: "warning",
      metadata: {
        title: job.title,
      },
    });

    return res.json({ message: "Job deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to delete job" });
  }
};

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

    return res.json({
      message: status === "closed" ? "Job closed" : "Job reopened",
      job,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to update job status" });
  }
};