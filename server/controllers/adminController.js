const { applyJobUpdate } = require("./employerController");
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
const { runPostCommit } = require("../utils/postCommit");
const { createNotificationForUser } = require("../services/notificationService");
const { forceLogout } = require("../services/sessionService");
const { escapeRegex } = require("../utils/sanitize");
const { sendError } = require("../utils/sendError");
const { isEmployerUnlisted } = require("../utils/jobVisibility");
const { buildInsights } = require("../services/userInsightsService");
const { buildDirectoryQuery } = require("../utils/userDirectoryQuery");
const { getDirectoryCounts, getRowDetails } = require("../services/userDirectoryService");
const { toCsv } = require("../utils/csv");
const {
  MUNICIPALITY_LABELS,
  escapeRegExp,
  normalizeMunicipalityLabel,
  getMunicipalityFilterPattern,
  municipalityBucketExpression,
} = require("../services/analytics/municipality");
const { getDashboardAnalytics, getProvincialAnalytics } = require("../services/analytics/dashboardStats");
const {
  CLOSED_STATUS_VALUES,
  REJECTED_STATUS_VALUES,
  normalizeAdminJobStatus,
  statusGroupExpression,
} = require("../services/analytics/jobStatus");
const {
  softDeleteUser,
  restoreUser: restoreDeletedUser,
  getGraceDays,
  DeletionError,
} = require("../services/userDeletionService");

if (typeof module !== "undefined") {
  module.exports = module.exports || {};
  module.exports.escapeRegExp = escapeRegExp;
  module.exports.normalizeAdminJobStatus = normalizeAdminJobStatus;
  module.exports.normalizeMunicipalityLabel = normalizeMunicipalityLabel;
}

exports.getAdminAnalytics = async (req, res) => {
  try {
    return res.json(await getDashboardAnalytics());
  } catch (error) {
    return sendError(res, error, "Failed to fetch analytics");
  }
};

exports.getProvincialAnalytics = async (req, res) => {
  try {
    const year = Number(req.query.year) || 2026;
    return res.json(await getProvincialAnalytics({ year, municipality: req.query.municipality || "ALL" }));
  } catch (error) {
    return sendError(res, error, "Failed to fetch provincial analytics");
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 20, 1);

    // Filters (status, verification, no email, idle 90+, locked now, search) and
    // sort (joined, last active, name) come from one shared builder, so the CSV
    // export of a filtered list always matches what the list shows.
    const { filter, sort, caseInsensitiveSort } = buildDirectoryQuery(req.query, {
      isSuperadmin: req.user.role === "superadmin",
    });

    // details=1 (superadmin only): the User Management page also wants the
    // avatar and a few per-row figures. Other callers of this route (Reports,
    // Find account) get exactly what they got before.
    const wantsDetails = req.user.role === "superadmin" && String(req.query.details || "").toLowerCase() === "true";
    let listQuery = User.find(filter)
      .select(
        "name email username role createdAt lastActiveAt hasCompletedOnboarding verificationStatus isActive accountStatus companyName businessPermitUrl registrationDocUrl verificationNote verificationSubmittedAt deletedAt purgeAfter loginLock.lockedUntil" +
          (wantsDetails ? " profileImage" : "")
      )
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit);
    if (caseInsensitiveSort) listQuery = listQuery.collation({ locale: "en", strength: 2 });

    const [total, rawUsers] = await Promise.all([User.countDocuments(filter), listQuery]);

    let users = rawUsers;
    if (wantsDetails) {
      const details = await getRowDetails(rawUsers);
      users = rawUsers.map((user) => ({ ...user.toJSON(), details: details.get(String(user._id)) || null }));
    }

    return res.json({
      users,
      total,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      currentPage: page,
    });
  } catch (error) {
    return sendError(res, error, "Failed to fetch users");
  }
};

// GET /admin/users-counts (superadmin): tab totals and filter-chip counts for
// both directories in one call. See services/userDirectoryService.js.
exports.getUserDirectoryCounts = async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    return res.json(await getDirectoryCounts());
  } catch (error) {
    return sendError(res, error, "Failed to load directory counts");
  }
};

const EXPORT_MAX_ROWS = 10000;

// CSV of the filtered directory for PESO reports (superadmin only). Only
// non-sensitive columns: no email, username, phone, address or date of birth,
// so a minor's contact details can never be in the file. Counts come from two
// grouped queries for the whole page of results, not one query per user.
exports.exportUsersCsv = async (req, res) => {
  try {
    const { filter, sort, caseInsensitiveSort } = buildDirectoryQuery(req.query, { isSuperadmin: true });
    // The export is for the employer and jobseeker directories only.
    if (!["employer", "jobseeker"].includes(String(filter.role))) {
      filter.role = { $in: ["employer", "jobseeker"] };
    }

    let listQuery = User.find(filter)
      .select("name role createdAt lastActiveAt verificationStatus isActive accountStatus deletedAt")
      .sort(sort)
      .limit(EXPORT_MAX_ROWS + 1);
    if (caseInsensitiveSort) listQuery = listQuery.collation({ locale: "en", strength: 2 });
    const users = await listQuery.lean();
    // One more row than the limit was fetched: more accounts matched than a
    // single file may hold, so say so instead of silently handing over a partial list.
    if (users.length > EXPORT_MAX_ROWS) {
      return res.status(422).json({
        code: "EXPORT_TOO_LARGE",
        message: `More than ${EXPORT_MAX_ROWS} accounts match. Narrow the filters and export again.`,
      });
    }

    const jobseekerIds = users.filter((u) => u.role === "jobseeker").map((u) => u._id);
    const employerIds = users.filter((u) => u.role === "employer").map((u) => u._id);
    const [applicationRows, postingRows] = await Promise.all([
      jobseekerIds.length
        ? JobApplication.aggregate([{ $match: { applicant: { $in: jobseekerIds } } }, { $group: { _id: "$applicant", count: { $sum: 1 } } }])
        : [],
      employerIds.length
        ? JobVacancy.aggregate([{ $match: { employer: { $in: employerIds } } }, { $group: { _id: "$employer", count: { $sum: 1 } } }])
        : [],
    ]);
    const applications = new Map(applicationRows.map((r) => [String(r._id), r.count]));
    const postings = new Map(postingRows.map((r) => [String(r._id), r.count]));

    const stateOf = (u) => {
      if (u.deletedAt) return "deleted";
      if (u.isActive === false) return u.accountStatus === "banned" ? "banned" : u.accountStatus === "deactivated" ? "deactivated" : "suspended";
      return "active";
    };

    const csv = toCsv(
      [
        { label: "Name", key: "name" },
        { label: "Role", key: "role" },
        { label: "Status", value: stateOf },
        { label: "Joined", key: "createdAt" },
        { label: "Last active", key: "lastActiveAt" },
        { label: "Verification", value: (u) => (u.role === "employer" ? u.verificationStatus || "unverified" : "") },
        { label: "Applications", value: (u) => (u.role === "jobseeker" ? applications.get(String(u._id)) || 0 : "") },
        { label: "Postings", value: (u) => (u.role === "employer" ? postings.get(String(u._id)) || 0 : "") },
      ],
      users
    );

    await runPostCommit("user_export.audit", { req, resourceType: "user" }, () => logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "superadmin",
      action: "admin.user.exported",
      targetType: "user_directory",
      targetId: "export",
      severity: "warning",
      metadata: {
        rows: users.length,

        // the filters used, so the report can be traced to what was exported
        filters: Object.fromEntries(
          ["role", "status", "verificationStatus", "noEmail", "idle90", "lockedNow", "search", "sort", "order"]
            .filter((key) => req.query[key] !== undefined && req.query[key] !== "")
            .map((key) => [key, String(req.query[key]).slice(0, 100)])
        ),
      },
    }));

    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="users-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.set("Cache-Control", "no-store");
    return res.send(csv);
  } catch (error) {
    return sendError(res, error, "Failed to export users");
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
    return sendError(res, error, "Failed to load audit logs");
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
      // Pending is every posting that is neither active, closed nor rejected (a draft),
      // the same grouping normalizeAdminJobStatus uses for the list and the stats. It is its
      // own condition, so it combines with a search by AND.
      filter.status = { $nin: ["active", ...CLOSED_STATUS_VALUES, ...REJECTED_STATUS_VALUES] };
    } else {
      filter.status = normalizedStatus;
    }
  }

  if (category !== "all") {
    filter.industry = { $regex: escapeRegex(category), $options: "i" };
  }

  return filter;
};
exports.buildAdminVacancyFilter = buildAdminVacancyFilter;

exports.getAdminVacancies = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
    const skip = (page - 1) * limit;

    const filter = buildAdminVacancyFilter(req.query);

    const [total, jobs] = await Promise.all([
      JobVacancy.countDocuments(filter),
      JobVacancy.find(filter)
        .populate("employer", "name email companyName verificationStatus isActive accountStatus")
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
        // `job.industry` is an array; join for display (also tolerates a
        // not-yet-migrated plain string).
        industry: (Array.isArray(job.industry) ? job.industry : [job.industry]).filter(Boolean).join(", ") || "General",
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
        // True while the employer account is suspended, banned or deactivated:
        // the posting is hidden from the public but kept here for staff.
        unlisted: isEmployerUnlisted(job.employer),
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
    return sendError(res, error, "Failed to fetch admin job monitoring list");
  }
};

exports.getAdminVacancyStats = async (req, res) => {
  try {
    const filter = buildAdminVacancyFilter(req.query);

    // One pass in the database: status group, municipality bucket and slots per posting,
    // grouped three ways. Same grouping rules as the old per-document loop, so the numbers
    // are unchanged; nothing is loaded into memory.
    const [facets, applicationIds] = await Promise.all([
      JobVacancy.aggregate([
        { $match: filter },
        {
          $project: {
            slots: { $ifNull: ["$slots", 0] },
            municipality: municipalityBucketExpression("$location"),
            statusGroup: statusGroupExpression("$status"),
          },
        },
        {
          $facet: {
            totals: [{ $group: { _id: null, totalPostings: { $sum: 1 }, totalSlots: { $sum: "$slots" } } }],
            byStatus: [{ $group: { _id: "$statusGroup", count: { $sum: 1 } } }],
            byMunicipality: [{ $group: { _id: "$municipality", jobs: { $sum: 1 }, slots: { $sum: "$slots" } } }],
          },
        },
      ]),
      JobVacancy.distinct("_id", filter),
    ]);

    const facet = (facets && facets[0]) || {};
    const totalsRow = (facet.totals && facet.totals[0]) || { totalPostings: 0, totalSlots: 0 };
    const statusCounts = { active: 0, pending: 0, closed: 0, rejected: 0 };
    (facet.byStatus || []).forEach((row) => {
      if (statusCounts[row._id] !== undefined) statusCounts[row._id] = Number(row.count || 0);
    });

    const municipalityMap = new Map(MUNICIPALITY_LABELS.map((label) => [label, { label, jobs: 0, slots: 0 }]));
    (facet.byMunicipality || []).forEach((row) => {
      const bucket = municipalityMap.get(row._id) || municipalityMap.get("Other / Outside Province");
      bucket.jobs += Number(row.jobs || 0);
      bucket.slots += Number(row.slots || 0);
    });

    let applications = 0;
    if (applicationIds.length) {
      const [counted] = await JobApplication.aggregate([{ $match: { vacancy: { $in: applicationIds } } }, { $count: "total" }]);
      applications = Number((counted && counted.total) || 0);
    }

    return res.json({
      totals: {
        totalPostings: Number(totalsRow.totalPostings || 0),
        active: statusCounts.active,
        pending: statusCounts.pending,
        closed: statusCounts.closed,
        rejected: statusCounts.rejected,
        totalSlots: Number(totalsRow.totalSlots || 0),
        applications,
      },
      municipalityBreakdown: Array.from(municipalityMap.values()),
    });
  } catch (error) {
    return sendError(res, error, "Failed to fetch job monitoring stats");
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
    return sendError(res, error, "Failed to fetch homepage job management data");
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

    // The change is saved; audit and notification are best-effort.
    const postCommitCtx = { req, resourceType: "job", resourceId: job._id };
    await runPostCommit("job_feature.audit", postCommitCtx, () => logAuditEvent({
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
    }));

    if (desiredFeatured) {
      await runPostCommit("job_feature.notify_employer", postCommitCtx, () => createNotificationForUser({
        recipientId: job.employer,
        actorId: req.user.id,
        type: "admin_action",
        title: "Your job posting was featured",
        message: `"${job.title}" is now featured on the homepage.`,
        relatedEntityType: "job",
        relatedEntityId: job._id,
        actionUrl: "/employer",
        io: req.app.get("io"),
      }));
    }

    return res.json({
      message: desiredFeatured ? "Job featured on homepage" : "Job removed from homepage featured list",
      job: updatedJob,
    });
  } catch (error) {
    return sendError(res, error, "Failed to update homepage feature");
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

    const user = await User.findById(id).select("-password -backupCodes -recoveryEmailToken -governmentIdOcr.rawText");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role === "admin" || user.role === "superadmin") {
      return res.status(403).json({
        message: "Staff accounts can only be changed by the system superadmin.",
      });
    }

    user.role = role;
    // validateModifiedOnly — see authController.js's note above
    // issueEmailVerification.
    await user.save({ validateModifiedOnly: true });

    // The role change is saved; audit and notification are best-effort.
    const postCommitCtx = { req, resourceType: "user", resourceId: user._id };
    await runPostCommit("user_role.audit", postCommitCtx, () => logAuditEvent({
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
    }));

    await runPostCommit("user_role.notify_user", postCommitCtx, () => createNotificationForUser({
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
    }));

    return res.json({
      message: "User role updated",
      user,
    });
  } catch (error) {
    return sendError(res, error, "Failed to update role");
  }
};

exports.deactivateUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (String(req.user.id) === String(id)) {
      return res.status(400).json({ message: "Admin cannot deactivate their own account" });
    }

    const user = await User.findById(id).select("-password -backupCodes -recoveryEmailToken -governmentIdOcr.rawText");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role === "superadmin") {
      return res.status(403).json({ message: "Superadmin accounts cannot be modified here." });
    }
    if (user.deletedAt) {
      return res.status(409).json({ message: "This account is deleted. Restore it first.", code: "ACCOUNT_DELETED" });
    }

    const permanent = req.body.permanent === true || req.body.permanent === "true";
    const reason = String(req.body.reason || "").trim() || null;

    user.isActive = false;
    user.accountStatus = permanent ? "banned" : "suspended";
    user.suspensionReason = reason;
    user.suspendedAt = new Date();
    user.suspendedBy = req.user.id;
    // validateModifiedOnly — see authController.js's note above
    // issueEmailVerification.
    await user.save({ validateModifiedOnly: true });

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

    // The suspension is saved; audit and notification are best-effort.
    const postCommitCtx = { req, resourceType: "user", resourceId: user._id };
    await runPostCommit("user_deactivate.audit", postCommitCtx, () => logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "admin",
      action: "admin.user.deactivated",
      targetUserId: user._id,
      targetType: "user",
      targetId: String(user._id),
      severity: "critical",
      metadata: { accountStatus: user.accountStatus, reason },
    }));

    await runPostCommit("user_deactivate.notify_user", postCommitCtx, () => createNotificationForUser({
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
    }));

    return res.json({ message: `User ${permanent ? "banned" : "suspended"}`, user });
  } catch (error) {
    return sendError(res, error, "Failed to deactivate user");
  }
};

exports.reactivateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id).select("-password -backupCodes -recoveryEmailToken -governmentIdOcr.rawText");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    // A deleted account must be restored first: reactivating it would bring a
    // scheduled-for-purge account back by accident.
    if (user.deletedAt) {
      return res.status(409).json({ message: "This account is deleted. Restore it first.", code: "ACCOUNT_DELETED" });
    }

    user.isActive = true;
    user.accountStatus = "active";
    user.suspensionReason = null;
    user.suspendedAt = null;
    user.suspendedBy = null;
    // validateModifiedOnly — see authController.js's note above
    // issueEmailVerification.
    await user.save({ validateModifiedOnly: true });

    // The reactivation is saved; audit and notification are best-effort.
    const postCommitCtx = { req, resourceType: "user", resourceId: user._id };
    await runPostCommit("user_reactivate.audit", postCommitCtx, () => logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "admin",
      action: "admin.user.reactivated",
      targetUserId: user._id,
      targetType: "user",
      targetId: String(user._id),
      severity: "warning",
    }));

    await runPostCommit("user_reactivate.notify_user", postCommitCtx, () => createNotificationForUser({
      recipientId: user._id,
      actorId: req.user.id,
      type: "admin_action",
      title: "Your account was reactivated",
      message: "An administrator reactivated your account. You can log in again.",
      relatedEntityType: "user",
      relatedEntityId: user._id,
      io: req.app.get("io"),
    }));

    return res.json({ message: "User reactivated", user });
  } catch (error) {
    return sendError(res, error, "Failed to reactivate user");
  }
};

// Soft delete (replaces the old hard delete, whose logic now lives only in the
// purge job: services/userDeletionService.purgeUser). The "what will happen"
// summary comes from GET /users/:id/delete-preview (previewDeleteUser); this
// real call needs the typed confirmation and a reason, and is budgeted.
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};

    const result = await softDeleteUser({
      actorId: req.user.id,
      targetId: id,
      reason: String(body.reason || ""),
      note: body.note,
      confirm: body.confirm,
    });

    forceLogout(req.app.get("io"), id, {
      code: "ACCOUNT_DELETED",
      message: "This account has been deleted by an administrator.",
    });

    await runPostCommit("user_delete.audit", { req, resourceType: "user", resourceId: id }, () => logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "superadmin",
      action: "admin.user.soft_deleted",
      targetUserId: id,
      targetType: "user",
      targetId: String(id),
      severity: "critical",
      metadata: {
        role: result.user.role,
        reason: result.reason,
        note: result.note || undefined,
        purgeAfter: result.purgeAfter,
        graceDays: result.graceDays,
        affected: result.summary,
      },
    }));

    return res.json({
      message: "User deleted. It can be restored until the grace period ends.",
      deletedAt: result.deletedAt,
      purgeAfter: result.purgeAfter,
      graceDays: result.graceDays,
      summary: result.summary,
    });
  } catch (error) {
    if (error instanceof DeletionError) {
      return res.status(error.status).json({ message: error.message, code: error.code });
    }
    return sendError(res, error, "Failed to delete user");
  }
};

// Read-only "what will happen" summary for the confirmation step (same guards
// as the real delete, nothing is written, not counted against the delete budget).
exports.previewDeleteUser = async (req, res) => {
  try {
    const result = await softDeleteUser({ actorId: req.user.id, targetId: req.params.id, dryRun: true });
    const graceDays = await getGraceDays();
    return res.json({
      graceDays,
      summary: result.summary,
      account: { role: result.user.role, name: result.user.name, username: result.user.username || null, email: result.user.email || null },
    });
  } catch (error) {
    if (error instanceof DeletionError) {
      return res.status(error.status).json({ message: error.message, code: error.code });
    }
    return sendError(res, error, "Failed to preview delete");
  }
};

exports.restoreUser = async (req, res) => {
  try {
    const { id } = req.params;
    await restoreDeletedUser({ targetId: id });

    await runPostCommit("user_restore.audit", { req, resourceType: "user", resourceId: id }, () => logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "superadmin",
      action: "admin.user.restored",
      targetUserId: id,
      targetType: "user",
      targetId: String(id),
      severity: "warning",
      metadata: { note: "Restored to the deactivated state; reactivate separately." },
    }));

    return res.json({ message: "User restored. The account is still deactivated until you reactivate it." });
  } catch (error) {
    if (error instanceof DeletionError) {
      return res.status(error.status).json({ message: error.message, code: error.code });
    }
    return sendError(res, error, "Failed to restore user");
  }
};

// Superadmin-only, read-only "Account insights" (see services/userInsightsService).
exports.getUserInsights = async (req, res) => {
  try {
    const insights = await buildInsights(req.params.id);
    if (!insights) return res.status(404).json({ message: "User not found" });
    // Never cache: lock and status information must always be current.
    res.set("Cache-Control", "no-store");
    return res.json({ insights });
  } catch (error) {
    return sendError(res, error, "Failed to load account insights");
  }
};

// Internal admin-only note on an employer or jobseeker account. Audited by
// length only (the note text is not copied into the audit trail).
exports.updateUserAdminNotes = async (req, res) => {
  try {
    const raw = req.body && req.body.notes;
    if (typeof raw !== "string") return res.status(400).json({ message: "Notes must be text." });
    const notes = raw.trim();
    if (notes.length > 2000) return res.status(400).json({ message: "Notes can be up to 2000 characters." });

    const user = await User.findOneAndUpdate(
      { _id: req.params.id, role: { $in: ["employer", "jobseeker"] } },
      { $set: { adminNotes: notes, adminNotesUpdatedAt: new Date(), adminNotesUpdatedBy: req.user.id } },
      { new: true, projection: "_id role" }
    );
    if (!user) return res.status(404).json({ message: "User not found" });

    await runPostCommit("user_notes.audit", { req, resourceType: "user", resourceId: req.params.id }, () => logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "superadmin",
      action: "admin.user.notes_updated",
      targetUserId: req.params.id,
      targetType: "user",
      targetId: String(req.params.id),
      severity: "info",
      metadata: { length: notes.length },
    }));

    return res.json({ message: "Notes saved.", notes });
  } catch (error) {
    return sendError(res, error, "Failed to save notes");
  }
};

exports.getUserProfileDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id).select("-password -backupCodes -recoveryEmailToken -governmentIdOcr.rawText");

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
    return sendError(res, error, "Failed to fetch user profile details");
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

    // The status change is saved; audit and notification are best-effort.
    const postCommitCtx = { req, resourceType: "job", resourceId: job._id };
    await runPostCommit("job_status.audit", postCommitCtx, () => logAuditEvent({
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
    }));

    await runPostCommit("job_status.notify_employer", postCommitCtx, () => createNotificationForUser({
      recipientId: job.employer,
      actorId: req.user.id,
      type: "admin_action",
      title: status === "closed" ? "Your job posting was closed" : "Your job posting was reopened",
      message: `An administrator ${status === "closed" ? "closed" : "reopened"} your job posting "${job.title}".`,
      relatedEntityType: "job",
      relatedEntityId: job._id,
      actionUrl: "/employer",
      io: req.app.get("io"),
    }));

    return res.json({
      message: status === "closed" ? "Job closed" : "Job reopened",
      job,
    });
  } catch (error) {
    return sendError(res, error, "Failed to update job status");
  }
};
exports.getAdminJob = async (req, res) => {
  try {
    const job = await JobVacancy.findById(req.params.id).populate("employer", "name companyName");
    if (!job) return res.status(404).json({ message: "Job not found" });
    return res.json(job);
  } catch (error) {
    return sendError(res, error, "Failed to fetch job");
  }
};

exports.adminUpdateJob = async (req, res) => {
  try {
    const job = await JobVacancy.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });
    return await applyJobUpdate(req, res, job, req.user.role, "admin.job.updated");
  } catch (error) {
    return sendError(res, error, "Failed to update job");
  }
};

// ---------- Admin: change a user's locked date of birth ----------
// The only way to change a date of birth after it is locked. Needs a reason and
// a reference to the documentary proof (e.g. the verified birth certificate).
// The audit entry records the age tiers only, never the dates.
exports.changeUserDateOfBirth = async (req, res) => {
  try {
    const { validateDobInput, getAgeTier } = require("../utils/age");
    const reason = String(req.body.reason || "").trim().slice(0, 500);
    const proofRef = String(req.body.proofRef || "").trim().slice(0, 200);
    if (!reason || !proofRef) {
      return res.status(400).json({
        code: "DOB_CHANGE_PROOF_REQUIRED",
        message: "A reason and a reference to the documentary proof are required.",
      });
    }

    const dob = validateDobInput(req.body.dateOfBirth);
    if (!dob.ok) return res.status(400).json({ code: dob.code, message: "Enter a valid date of birth of 15 years or older." });

    const target = await User.findById(req.params.id).select("role dateOfBirth");
    if (!target) return res.status(404).json({ message: "User not found" });
    if (target.role === "employer") {
      return res.status(400).json({ code: "DOB_NOT_APPLICABLE", message: "Employer accounts do not store a date of birth." });
    }

    const previousTier = getAgeTier(target.dateOfBirth);
    await User.updateOne(
      { _id: target._id },
      { $set: { dateOfBirth: dob.date, dobLockedAt: new Date(), dobSource: "admin", ageReviewRequired: false } }
    );

    await logAuditEvent({
      req,
      actorId: req.user.id || req.user._id,
      actorRole: req.user.role,
      action: "user.dob.changed",
      targetUserId: target._id,
      targetType: "user",
      targetId: String(target._id),
      severity: "warning",
      metadata: { previousTier, newTier: dob.tier, reason, proofRef },
    });

    return res.json({ message: "Date of birth updated.", ageTier: dob.tier });
  } catch (error) {
    return sendError(res, error);
  }
};
