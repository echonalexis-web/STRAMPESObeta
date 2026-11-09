const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const { verifyToken: protect } = require("../middleware/auth");
const { profileViewBudget } = require("../middleware/budgets");
const { getSummary, getProfile } = require("../controllers/profileViewController");

// A per-process burst limiter per ACCOUNT (not per IP, so a job fair network is
// not blocked). It resets on restart; the database daily budget is the real guard.
const burstLimiter =
  process.env.DISABLE_RATE_LIMITS === "true"
    ? (req, res, next) => next()
    : rateLimit({
        windowMs: 60 * 1000,
        limit: Number.parseInt(process.env.PROFILE_VIEWS_PER_MINUTE, 10) > 0 ? Number.parseInt(process.env.PROFILE_VIEWS_PER_MINUTE, 10) : 60,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => `profile-view:${req.user ? req.user._id || req.user.id : "anon"}`,
        handler: (req, res) => res.status(429).json({ code: "PROFILE_VIEW_RATE_LIMITED", message: "Too many profile views. Please slow down." }),
      });

// Signed-in users of every role. Signed-out visitors get 401 from protect.
router.use(protect, burstLimiter, profileViewBudget);
// No id validation middleware: a malformed id gets the same "unavailable" answer as any other miss.
router.get("/:id/summary", getSummary);
router.get("/:id", getProfile);

module.exports = router;
