const rateLimit = require("express-rate-limit");
const { MongoRateLimitStore } = require("./mongoRateLimitStore");
const RateLimitCounter = require("../models/RateLimitCounter");

const positiveIntEnv = (name, fallback) => {
  const n = Number.parseInt(process.env[name], 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

// Per-IP limiter whose counters live in MongoDB (shared across restarts and
// instances). Honours DISABLE_RATE_LIMITS like server.js's createLimiter. The
// limit is read from `envName` (a positive integer) or falls back to `max`.
// Generous defaults on purpose: PESO events and schools share one IP.
const dbLimiter = ({ name, windowMs, max, envName, code = "RATE_LIMITED", message, model = RateLimitCounter }) => {
  if (process.env.DISABLE_RATE_LIMITS === "true") return (req, res, next) => next();
  return rateLimit({
    windowMs,
    max: envName ? positiveIntEnv(envName, max) : max,
    message: { code, message: message || "Too many attempts. Please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
    store: new MongoRateLimitStore({ model, name }),
  });
};

module.exports = { dbLimiter, positiveIntEnv };
