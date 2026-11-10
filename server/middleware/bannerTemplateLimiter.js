const rateLimit = require("express-rate-limit");

// Image uploads for banner templates are CPU heavy (sharp) and rare, so they get a
// tighter per-account budget than the general /superadmin limiter in server.js.
// Same DISABLE_RATE_LIMITS switch as the other limiters. Tests may pass a small max.
const buildTemplateUploadLimiter = ({ windowMs = 60 * 60 * 1000, max = Number(process.env.BANNER_TEMPLATE_UPLOADS_PER_HOUR) || 40 } = {}) => {
  if (process.env.DISABLE_RATE_LIMITS === "true") return (req, res, next) => next();
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // Per signed-in account, so one superadmin does not spend another's budget.
    keyGenerator: (req) => String(req.user?.id || req.ip),
    handler: (req, res) =>
      res.status(429).json({ code: "TEMPLATE_UPLOAD_RATE_LIMITED", message: "Too many template uploads. Please try again later." }),
  });
};

module.exports = { buildTemplateUploadLimiter };
