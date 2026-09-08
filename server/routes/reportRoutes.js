const router = require("express").Router();
const { verifyToken: protect, isAdmin } = require("../middleware/auth");
const { sanitizeRequestBody, sanitizeQueryParams, validateMongoId, validateRequest } = require("../middleware/validation");
const { detectMaliciousPayload } = require("../middleware/security");
const { createReport, listReports, resolveReport } = require("../controllers/reportController");

// Any authenticated user can file a report.
router.post("/", protect, sanitizeRequestBody, detectMaliciousPayload, createReport);

// Admin moderation queue.
router.get("/admin", protect, isAdmin, sanitizeQueryParams, listReports);
router.patch(
  "/admin/:id/resolve",
  protect,
  isAdmin,
  validateMongoId("id"),
  sanitizeRequestBody,
  detectMaliciousPayload,
  validateRequest,
  resolveReport
);

module.exports = router;
