const router = require("express").Router();
const { verifyToken: protect, isSuperadmin } = require("../middleware/auth");
const { sanitizeRequestBody, sanitizeQueryParams, validateMongoId, validateRequest } = require("../middleware/validation");
const { detectMaliciousPayload } = require("../middleware/security");
const { createReport, listReports, resolveReport } = require("../controllers/reportController");

// Any authenticated user can file a report.
router.post("/", protect, sanitizeRequestBody, detectMaliciousPayload, createReport);

// Moderation queue — superadmin-only.
router.get("/admin", protect, isSuperadmin, sanitizeQueryParams, listReports);
router.patch(
  "/admin/:id/resolve",
  protect,
  isSuperadmin,
  validateMongoId("id"),
  sanitizeRequestBody,
  detectMaliciousPayload,
  validateRequest,
  resolveReport
);

module.exports = router;
