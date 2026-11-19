// Read-only "Account insights" for the superadmin user detail view.
//
// Everything here is computed on the server with aggregation queries (a fixed
// number of queries per user, no per-record loops) and returned as an explicit
// allow-list: the User document itself is never put in the response, so
// passwords, tokens, documents, ID numbers and the date of birth cannot leak
// by accident. Nothing is cached, so lock and status information is live.
const User = require("../models/User");
const JobApplication = require("../models/JobApplication");
const JobVacancy = require("../models/JobVacancy");
const JobLike = require("../models/JobLike");
const JobseekerProfile = require("../models/JobseekerProfile");
const Report = require("../models/Report");
const Appeal = require("../models/Appeal");
const AuditLog = require("../models/AuditLog");
const { getAgeTier, isSpesEligibleAge, TIERS } = require("../utils/age");
const { getAccountType, hasVerifiedEmail } = require("../utils/accountType");
const { computeProfileCompleteness, listMissingSections } = require("../utils/profileCompleteness");

const DAY_MS = 24 * 60 * 60 * 1000;
const IDLE_DAYS = 90;
const TIMELINE_LIMIT = 10;
const LIST_LIMIT = 5;

// Audit actions that make up the status history (who changed the account's
// state, when and why).
const STATUS_ACTIONS = [
  "admin.user.deactivated",
  "admin.user.reactivated",
  "admin.user.soft_deleted",
  "admin.user.restored",
  "admin.user.purged",
  "user.account.self_deactivated",
];

const REJECTED_STATUSES = ["rejected", "Rejected"];
const SHORTLISTED_STATUSES = ["shortlisted"];

const countFor = (rows, statuses) =>
  rows.filter((row) => statuses.includes(row._id)).reduce((sum, row) => sum + row.count, 0);

const accountState = (user) => {
  if (user.deletedAt) return "deleted";
  if (user.isActive === false) {
    if (user.accountStatus === "banned") return "banned";
    if (user.accountStatus === "deactivated") return "deactivated";
    return "suspended";
  }
  return "active";
};

const ageBracketOf = (dateOfBirth) => {
  const tier = getAgeTier(dateOfBirth);
  return {
    bracket: tier,
    isMinor: tier === TIERS.UNDER_15 || tier === TIERS.MINOR,
    spesEligible: isSpesEligibleAge(dateOfBirth),
  };
};

const reportSummary = async (userId) => {
  const [against, by] = await Promise.all([
    Report.find({ targetOwner: userId })
      .select("category status resolution.action createdAt")
      .sort({ createdAt: -1 })
      .limit(LIST_LIMIT)
      .lean(),
    Report.find({ reporter: userId })
      .select("category status resolution.action createdAt")
      .sort({ createdAt: -1 })
      .limit(LIST_LIMIT)
      .lean(),
  ]);
  const [againstCount, byCount] = await Promise.all([
    Report.countDocuments({ targetOwner: userId }),
    Report.countDocuments({ reporter: userId }),
  ]);
  const shape = (row) => ({
    category: row.category,
    status: row.status,
    outcome: (row.resolution && row.resolution.action) || "none",
    createdAt: row.createdAt,
  });
  return {
    againstCount,
    filedCount: byCount,
    against: against.map(shape),
    filed: by.map(shape),
  };
};

const appealSummary = async (userId) => {
  const appeals = await Appeal.find({ user: userId })
    .select("status accountStatus createdAt reviewedAt")
    .sort({ createdAt: -1 })
    .limit(LIST_LIMIT)
    .lean();
  return appeals.map((a) => ({
    status: a.status,
    accountStatus: a.accountStatus,
    createdAt: a.createdAt,
    reviewedAt: a.reviewedAt || null,
  }));
};

// Timeline (last 10 events touching the account) and status history, from the
// audit trail. IP address, user agent and free-form metadata are not returned.
const auditSummary = async (userId) => {
  const [timeline, history] = await Promise.all([
    AuditLog.find({ $or: [{ actorId: userId }, { targetUserId: userId }] })
      .select("action severity actorRole createdAt")
      .sort({ createdAt: -1 })
      .limit(TIMELINE_LIMIT)
      .lean(),
    AuditLog.find({ targetUserId: userId, action: { $in: STATUS_ACTIONS } })
      .select("action actorId actorRole createdAt metadata.reason metadata.accountStatus")
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
  ]);

  const actorIds = [...new Set(history.map((h) => h.actorId && String(h.actorId)).filter(Boolean))];
  const actors = actorIds.length ? await User.find({ _id: { $in: actorIds } }).select("name").lean() : [];
  const nameById = new Map(actors.map((a) => [String(a._id), a.name]));

  return {
    timeline: timeline.map((e) => ({ action: e.action, severity: e.severity, actorRole: e.actorRole, at: e.createdAt })),
    statusHistory: history.map((h) => ({
      action: h.action,
      at: h.createdAt,
      byName: (h.actorId && nameById.get(String(h.actorId))) || null,
      byRole: h.actorRole,
      reason: (h.metadata && h.metadata.reason ? String(h.metadata.reason).slice(0, 200) : null),
      accountStatus: (h.metadata && h.metadata.accountStatus) || null,
    })),
  };
};

const jobseekerSection = async (user) => {
  const [statusRows, last, savedJobs, profile] = await Promise.all([
    JobApplication.aggregate([{ $match: { applicant: user._id } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    JobApplication.aggregate([{ $match: { applicant: user._id } }, { $group: { _id: null, at: { $max: "$appliedAt" } } }]),
    JobLike.countDocuments({ userId: user._id }),
    JobseekerProfile.findOne({ userId: user._id }).lean(),
  ]);

  const merged = { ...user };
  const completeness = computeProfileCompleteness(merged, profile || {});
  const skills = Array.isArray(user.skills) && user.skills.length ? user.skills : (profile && profile.skills) || [];
  const age = ageBracketOf(user.dateOfBirth);
  const lastApplicationAt = (last[0] && last[0].at) || null;
  const lastSeen = user.lastActiveAt || user.lastLoginAt || user.createdAt;

  return {
    applications: {
      total: statusRows.reduce((sum, row) => sum + row.count, 0),
      shortlisted: countFor(statusRows, SHORTLISTED_STATUSES),
      hired: countFor(statusRows, ["hired"]),
      rejected: countFor(statusRows, REJECTED_STATUSES),
      withdrawn: countFor(statusRows, ["withdrawn"]),
      lastApplicationAt,
    },
    savedJobs,
    skillsCount: skills.length,
    profileCompleteness: {
      percent: completeness.percent,
      missingSections: listMissingSections(merged, profile || {}),
    },
    // Only the bracket and eligibility are shown, never the date of birth.
    ageBracket: age.bracket,
    spesEligible: age.spesEligible,
    idle90Days: !lastSeen || Date.now() - new Date(lastSeen).getTime() > IDLE_DAYS * DAY_MS,
  };
};

const employerSection = async (user) => {
  const vacancies = await JobVacancy.find({ employer: user._id }).select("_id status archived isActive").lean();
  const ids = vacancies.map((v) => v._id);
  const isArchived = (v) => v.archived === true;
  const postings = {
    total: vacancies.length,
    active: vacancies.filter((v) => !isArchived(v) && v.status !== "closed" && v.isActive !== false).length,
    closed: vacancies.filter((v) => !isArchived(v) && v.status === "closed").length,
    archived: vacancies.filter(isArchived).length,
  };

  let applicantsReceived = 0;
  let hires = 0;
  let postingsWithHire = 0;
  let averageDaysToHire = null;

  if (ids.length) {
    const [totals, hired] = await Promise.all([
      JobApplication.aggregate([{ $match: { vacancy: { $in: ids } } }, { $group: { _id: null, count: { $sum: 1 } } }]),
      JobApplication.aggregate([
        { $match: { vacancy: { $in: ids }, status: "hired" } },
        {
          $group: {
            _id: "$vacancy",
            hires: { $sum: 1 },
            // appliedAt -> the moment the status became hired
            days: { $avg: { $divide: [{ $subtract: [{ $ifNull: ["$statusUpdatedAt", "$appliedAt"] }, "$appliedAt"] }, DAY_MS] } },
          },
        },
      ]),
    ]);
    applicantsReceived = (totals[0] && totals[0].count) || 0;
    hires = hired.reduce((sum, row) => sum + row.hires, 0);
    postingsWithHire = hired.length;
    if (hired.length) {
      const avg = hired.reduce((sum, row) => sum + (row.days || 0), 0) / hired.length;
      averageDaysToHire = Math.round(Math.max(0, avg) * 10) / 10;
    }
  }

  return {
    verification: {
      status: user.verificationStatus || "unverified",
      reviewedAt: user.verificationReviewedAt || null,
    },
    postings,
    applicantsReceived,
    hires,
    averageDaysToHire,
    hireShare: postings.total ? Math.round((postingsWithHire / postings.total) * 100) : 0,
  };
};

const USER_FIELDS = [
  "name role username email isEmailVerified recoveryEmail recoveryEmailVerifiedAt createdAt lastLoginAt lastActiveAt",
  "loginLock isActive accountStatus deletedAt purgeAfter adminNotes verificationStatus verificationReviewedAt",
  "dateOfBirth skills gender phone address educationalAttainment desiredJobTitle resumeFile validIdFile",
].join(" ");

// Returns null when the user does not exist or is a staff account.
const buildInsights = async (userId) => {
  const user = await User.findById(userId).select(USER_FIELDS).lean();
  if (!user || !["employer", "jobseeker"].includes(user.role)) return null;

  const age = user.role === "jobseeker" ? ageBracketOf(user.dateOfBirth) : { isMinor: false };
  const lock = user.loginLock || {};
  const lockedNow = Boolean(lock.lockedUntil && new Date(lock.lockedUntil).getTime() > Date.now());

  const [roleSection, reports, appeals, audit] = await Promise.all([
    user.role === "jobseeker" ? jobseekerSection(user) : employerSection(user),
    reportSummary(user._id),
    appealSummary(user._id),
    auditSummary(user._id),
  ]);

  return {
    account: {
      role: user.role,
      state: accountState(user),
      accountType: getAccountType(user),
      username: user.username || null,
      hasEmail: Boolean(user.email),
      emailVerified: hasVerifiedEmail(user),
      // A minor's contact details are not shown (the flag above is enough).
      email: age.isMinor ? null : user.email || null,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt || null,
      lastActiveAt: user.lastActiveAt || null,
      deletedAt: user.deletedAt || null,
      purgeAfter: user.purgeAfter || null,
    },
    security: {
      failedLoginCount: lock.failures || 0,
      lockLevel: lock.level || 0,
      lockedNow,
      lockedUntil: lockedNow ? lock.lockedUntil : null,
    },
    ...(user.role === "jobseeker" ? { jobseeker: roleSection } : { employer: roleSection }),
    reports,
    appeals,
    statusHistory: audit.statusHistory,
    timeline: audit.timeline,
    notes: user.adminNotes || "",
  };
};

module.exports = { buildInsights, IDLE_DAYS };
