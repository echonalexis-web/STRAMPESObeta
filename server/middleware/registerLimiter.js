const { isUsernameSignupEnabled } = require("../utils/usernameSignup");

const positiveIntEnv = (name, fallback) => {
  const n = Number.parseInt(process.env[name], 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

// Counts SUCCESSFUL sign-ups per IP (authLimiter skips successes, so without
// this a bot could create unlimited accounts). Only active while
// USERNAME_SIGNUP_ENABLED is on, and only for POST on the jobseeker /register
// route itself (not /register/employer). Defaults suit PESO events and schools
// that share one IP; override with SIGNUP_LIMIT_PER_HOUR and
// SIGNUP_LIMIT_PER_DAY. Read when the server builds its middleware, so a change
// needs a restart. `createLimiter` is server.js's wrapper (honours
// DISABLE_RATE_LIMITS).
const buildRegisterLimiters = (createLimiter) => {
  const options = (windowMs, max) => ({
    windowMs,
    max,
    message: { code: "RATE_LIMITED", message: "Too many sign-ups from this network. Please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
    skipFailedRequests: true,
    skip: (req) => !isUsernameSignupEnabled() || req.method !== "POST" || req.path !== "/",
  });
  return [
    createLimiter(options(60 * 60 * 1000, positiveIntEnv("SIGNUP_LIMIT_PER_HOUR", 30))),
    createLimiter(options(24 * 60 * 60 * 1000, positiveIntEnv("SIGNUP_LIMIT_PER_DAY", 200))),
  ];
};

module.exports = { buildRegisterLimiters };
