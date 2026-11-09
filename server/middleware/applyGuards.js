const User = require("../models/User");
const JobApplication = require("../models/JobApplication");
const { isUsernameSignupEnabled } = require("../utils/usernameSignup");
const { phoneProblem } = require("../utils/phone");
const { positiveIntEnv } = require("./dbLimiter");

const JOBSEEKER_ROLES = ["jobseeker", "employee", "resident"];
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAILY_CAP = 20;

const appliesTo = (req) => isUsernameSignupEnabled() && req.user && JOBSEEKER_ROLES.includes(req.user.role);

const PHONE_MESSAGES = {
  PHONE_REQUIRED: "Add your phone number to apply for jobs.",
  PHONE_INVALID: "Enter a valid phone number to apply for jobs.",
};

// A plausible phone number must be on file before a REGULAR job application.
// Format check only (no SMS). SPES apply does not use this: it has its own
// contact number. Place after the age gate and before the upload middleware.
const requireApplyPhone = async (req, res, next) => {
  try {
    if (!appliesTo(req)) return next();
    const user = await User.findById(req.user._id || req.user.id).select("phone");
    const problem = phoneProblem(user && user.phone);
    if (!problem) return next();
    return res.status(400).json({ code: problem, message: PHONE_MESSAGES[problem], field: "phone" });
  } catch (error) {
    return next(error);
  }
};

// Daily cap on job applications per account. Counts the account's applications
// created in the last 24 hours, INCLUDING withdrawn ones (otherwise withdraw
// and re-apply would defeat it). Database count, so it holds across restarts
// and instances. Runs before files are read. The limit is read on each request
// from JOB_APPLY_DAILY_CAP (positive integer, default 20).
const requireApplyBudget = async (req, res, next) => {
  try {
    if (!appliesTo(req)) return next();
    const cap = positiveIntEnv("JOB_APPLY_DAILY_CAP", DEFAULT_DAILY_CAP);
    const applicant = req.user._id || req.user.id;
    const since = new Date(Date.now() - DAY_MS);
    const used = await JobApplication.countDocuments({ applicant, createdAt: { $gte: since } });
    if (used < cap) return next();

    const oldest = await JobApplication.findOne({ applicant, createdAt: { $gte: since } })
      .sort({ createdAt: 1 })
      .select("createdAt");
    const frees = oldest ? new Date(oldest.createdAt).getTime() + DAY_MS : Date.now() + DAY_MS;
    const retryAfter = Math.max(1, Math.ceil((frees - Date.now()) / 1000));
    res.set("Retry-After", String(retryAfter));
    return res.status(429).json({
      code: "APPLY_DAILY_LIMIT",
      message: "You have reached the daily limit for job applications. Try again later.",
      retryAfter,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = { requireApplyPhone, requireApplyBudget, DEFAULT_DAILY_CAP };
