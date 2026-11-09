const router = require("express").Router();
const { verifyToken: protect, isAdmin } = require("../middleware/auth");
const { sanitizeRequestBody, sanitizeQueryParams, validateMongoId, validateRequest } = require("../middleware/validation");
const { detectMaliciousPayload } = require("../middleware/security");
const { createReport, listReports, resolveReport } = require("../controllers/reportController");

// Any authenticated user can file a report.
router.post("/", protect, sanitizeRequestBody, detectMaliciousPayload, createReport);

// Moderation queue. The superadmin sees and decides everything. A PESO admin sees
// only reports about jobseeker accounts and may review them (dismiss, mark under
// review, or record a warning); suspension and ban stay superadmin-only. The
// scoping is enforced in the controller.
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
