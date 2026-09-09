const router = require("express").Router();
const { verifyToken: protect, verifyAppealToken, isSuperadmin } = require("../middleware/auth");
const { sanitizeRequestBody, sanitizeQueryParams, validateMongoId, validateRequest } = require("../middleware/validation");
const { detectMaliciousPayload } = require("../middleware/security");
const { submitAppeal, getMyAppeal, listAppeals, resolveAppeal } = require("../controllers/appealController");

// Suspended user — authenticated with the short-lived "appeal-only" token.
router.post("/", verifyAppealToken, sanitizeRequestBody, detectMaliciousPayload, submitAppeal);
router.get("/me", verifyAppealToken, getMyAppeal);

// Appeal review — superadmin-only.
router.get("/admin", protect, isSuperadmin, sanitizeQueryParams, listAppeals);
router.patch(
  "/admin/:id/resolve",
  protect,
  isSuperadmin,
  validateMongoId("id"),
  sanitizeRequestBody,
  detectMaliciousPayload,
  validateRequest,
  resolveAppeal
);

module.exports = router;
