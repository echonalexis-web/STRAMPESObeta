// Per-IP limits for the public (signed-out) job list, search and detail routes. Same
// library as the app-wide limiters in server.js (express-rate-limit, per IP, in memory),
// with a clear 429 message. Limits are read when the router loads; set
// DISABLE_RATE_LIMITS=true to turn them off locally, like the other limiters.
const rateLimit = require("express-rate-limit");

const positiveInt = (name, fallback) => {
  const n = Number.parseInt(process.env[name], 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

const makeLimiter = ({ max, windowMs }) => {
  if (process.env.DISABLE_RATE_LIMITS === "true") return (req, res, next) => next();
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      code: "RATE_LIMITED",
      message: "Too many requests. Please wait a minute and try again.",
    },
  });
};

// Searching can fire several requests while someone types, so it is more generous
// than the detail limit is strict about scraping.
const publicJobsListLimiter = () =>
  makeLimiter({ max: positiveInt("PUBLIC_JOBS_LIST_LIMIT_PER_MIN", 60), windowMs: 60 * 1000 });
const publicJobDetailLimiter = () =>
  makeLimiter({ max: positiveInt("PUBLIC_JOB_DETAIL_LIMIT_PER_MIN", 60), windowMs: 60 * 1000 });

// Applies `limiter` only to a signed-out caller (run after optionalAuth). Signed-in
// users keep exactly the behaviour they have today.
const visitorOnly = (limiter) => (req, res, next) => (req.user ? next() : limiter(req, res, next));

module.exports = { publicJobsListLimiter, publicJobDetailLimiter, visitorOnly };
