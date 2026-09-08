const router = require("express").Router();
const { verifyToken: protect, verifyAppealToken, isAdmin } = require("../middleware/auth");
const { sanitizeRequestBody, sanitizeQueryParams, validateMongoId, validateRequest } = require("../middleware/validation");
const { detectMaliciousPayload } = require("../middleware/security");
const { submitAppeal, getMyAppeal, listAppeals, resolveAppeal } = require("../controllers/appealController");

// Suspended user — authenticated with the short-lived "appeal-only" token.
router.post("/", verifyAppealToken, sanitizeRequestBody, detectMaliciousPayload, submitAppeal);
router.get("/me", verifyAppealToken, getMyAppeal);

// Admin review.
router.get("/admin", protect, isAdmin, sanitizeQueryParams, listAppeals);
router.patch(
  "/admin/:id/resolve",
  protect,
  isAdmin,
  validateMongoId("id"),
  sanitizeRequestBody,
  detectMaliciousPayload,
  validateRequest,
  resolveAppeal
);

module.exports = router;
