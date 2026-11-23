// Per-account budgets used by the routes (see accountBudget.js). Defined once so
// routes that must share a counter use the same name. Every budget except the
// staff reset applies only while USERNAME_SIGNUP_ENABLED is on.

const { buildAccountBudget } = require("./accountBudget");

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Starting a conversation. Counts each request to start one (a request that
// returns an existing conversation counts too). NEW_CONVERSATIONS_DAILY_CAP,
// default 20 per 24 hours.
const conversationBudget = buildAccountBudget({
  name: "new-conversations",
  windowMs: DAY_MS,
  envName: "NEW_CONVERSATIONS_DAILY_CAP",
  defaultMax: 20,
  code: "CONVERSATION_DAILY_LIMIT",
  message: "You have reached the daily limit for starting conversations. Try again later.",
});

// Uploads: general documents, profile photo, profile files. SPES document
// uploads are NOT counted (an applicant must never be blocked from submitting
// SPES documents). UPLOADS_DAILY_CAP, default 30 per 24 hours. Two instances
// share one counter through the same name.
const uploadBudgetOptions = {
  name: "uploads",
  windowMs: DAY_MS,
  envName: "UPLOADS_DAILY_CAP",
  defaultMax: 30,
  code: "UPLOAD_DAILY_LIMIT",
  message: "You have reached the daily limit for uploads. Try again later.",
};
const uploadBudget = buildAccountBudget(uploadBudgetOptions);
// For routes that accept text AND files: counts only a request with a file, so
// place it after multer.
const uploadBudgetForFiles = buildAccountBudget({ ...uploadBudgetOptions, onlyWithFiles: true });

// Employer cover uploads: COVER_UPLOADS_DAILY_CAP, default 10 per 24 hours per
// account. Always on (a new feature, nothing older to protect), and shared by
// upload and replace.
const coverUploadBudget = buildAccountBudget({
  name: "cover-uploads",
  windowMs: DAY_MS,
  envName: "COVER_UPLOADS_DAILY_CAP",
  defaultMax: 10,
  code: "COVER_DAILY_LIMIT",
  message: "You have reached the daily limit for cover uploads. Try again tomorrow.",
  alwaysOn: true,
});

// Viewing profiles (hover cards and profile pages): PROFILE_VIEWS_DAILY_CAP, default
// 1500 per 24 hours per account. Always on. The client cache and open delay keep
// normal use far below it; this is the guard against scraping.
const profileViewBudget = buildAccountBudget({
  name: "profile-views",
  windowMs: DAY_MS,
  envName: "PROFILE_VIEWS_DAILY_CAP",
  defaultMax: 1500,
  code: "PROFILE_VIEW_DAILY_LIMIT",
  message: "You have viewed a lot of profiles today. Try again tomorrow.",
  alwaysOn: true,
});

// Backup-code generation: 3 per hour PER ACCOUNT (not per IP, so a job fair
// network is not blocked). With the flag off the old per-IP limiter still runs.
const backupCodesBudget = buildAccountBudget({
  name: "backup-codes",
  windowMs: HOUR_MS,
  defaultMax: 3,
  code: "RATE_LIMITED",
  message: "Too many attempts. Please try again later.",
});

// Staff office reset: a per-admin hourly cap. STAFF_RESET_HOURLY_CAP, default 20.
const staffResetBudget = buildAccountBudget({
  name: "staff-reset",
  windowMs: HOUR_MS,
  envName: "STAFF_RESET_HOURLY_CAP",
  defaultMax: 20,
  code: "RATE_LIMITED",
  message: "Too many resets in the last hour. Try again later.",
  alwaysOn: true,
});

// Superadmin soft delete / restore: per-superadmin hourly cap. USER_DELETE_HOURLY_CAP, default 30.
const userDeleteBudget = buildAccountBudget({
  name: "user-delete",
  windowMs: HOUR_MS,
  envName: "USER_DELETE_HOURLY_CAP",
  defaultMax: 30,
  code: "RATE_LIMITED",
  message: "Too many delete or restore actions in the last hour. Try again later.",
  alwaysOn: true,
});

// Superadmin directory CSV export: per-superadmin hourly cap. USER_EXPORT_HOURLY_CAP, default 20.
const userExportBudget = buildAccountBudget({
  name: "user-export",
  windowMs: HOUR_MS,
  envName: "USER_EXPORT_HOURLY_CAP",
  defaultMax: 20,
  code: "RATE_LIMITED",
  message: "Too many exports in the last hour. Try again later.",
  alwaysOn: true,
});

// Report generator: per-account hourly cap on generating (and regenerating) a report.
// REPORT_EXPORT_HOURLY_CAP, default 10. Always on (a new feature).
const reportExportBudget = buildAccountBudget({
  name: "report-export",
  windowMs: HOUR_MS,
  envName: "REPORT_EXPORT_HOURLY_CAP",
  defaultMax: 10,
  code: "RATE_LIMITED",
  message: "Too many reports generated in the last hour. Try again later.",
  alwaysOn: true,
});

module.exports = { reportExportBudget, conversationBudget, uploadBudget, uploadBudgetForFiles, coverUploadBudget, profileViewBudget, backupCodesBudget, staffResetBudget, userDeleteBudget, userExportBudget };
