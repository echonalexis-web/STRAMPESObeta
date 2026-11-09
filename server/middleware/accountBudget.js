const RateLimitCounter = require("../models/RateLimitCounter");
const { MongoRateLimitStore } = require("./mongoRateLimitStore");
const { isUsernameSignupEnabled } = require("../utils/usernameSignup");
const { positiveIntEnv } = require("./dbLimiter");

const hasFiles = (req) =>
  Boolean(req.file) ||
  (Array.isArray(req.files) ? req.files.length > 0 : Object.values(req.files || {}).some((list) => list && list.length));

// A light PER-ACCOUNT budget (not per IP): counted in MongoDB, so it holds
// across restarts and instances, and many people behind one IP (a job fair)
// each get their own. Fixed windows of `windowMs`.
//
//   name        counter name; routes that pass the same name share one counter
//   envName     environment variable holding the limit (positive integer)
//   defaultMax  limit used when the variable is unset or invalid
//   code        error code in the 429 answer
//   onlyWithFiles  count only requests that carry an uploaded file (place the
//                  middleware AFTER multer for such routes)
//   whenFlagOff    "skip" (default): the budget applies only while
//                  USERNAME_SIGNUP_ENABLED is on, so flag off changes nothing
//
// Fails open when the database errors (see MongoRateLimitStore), because the
// request itself needs the same database anyway.
const buildAccountBudget = ({
  name,
  windowMs,
  envName,
  defaultMax,
  code,
  message,
  onlyWithFiles = false,
  model = RateLimitCounter,
  alwaysOn = false,
}) => {
  if (process.env.DISABLE_RATE_LIMITS === "true") return (req, res, next) => next();
  const store = new MongoRateLimitStore({ model, name });
  store.init({ windowMs });
  const max = envName ? positiveIntEnv(envName, defaultMax) : defaultMax;

  return async (req, res, next) => {
    try {
      if (!alwaysOn && !isUsernameSignupEnabled()) return next();
      const userId = req.user && (req.user._id || req.user.id);
      if (!userId) return next();
      if (onlyWithFiles && !hasFiles(req)) return next();

      const { totalHits, resetTime } = await store.increment(String(userId));
      if (totalHits > max) {
        const retryAfter = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
        res.set("Retry-After", String(retryAfter));
        return res.status(429).json({ code, message, retryAfter });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
};

module.exports = { buildAccountBudget, hasFiles };
