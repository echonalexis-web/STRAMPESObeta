const router = require("express").Router();
const { verifyToken: protect, authorizeRoles } = require("../middleware/auth");
const {
  sanitizeRequestBody,
  sanitizeQueryParams,
  validateMongoId,
} = require("../middleware/validation");
const { detectMaliciousPayload } = require("../middleware/security");
const {
  getVerificationQueue,
  reviewEmployerVerification,
} = require("../controllers/verificationController");

router.use(protect);

// The pending-employer queue. Admins own verification day-to-day; superadmins
// get the same list read-only for oversight.
router.get(
  "/queue",
  authorizeRoles("admin", "superadmin"),
  sanitizeQueryParams,
  getVerificationQueue
);

// Approve / reject a submission — admin only.
router.patch(
  "/:id",
  authorizeRoles("admin"),
  validateMongoId("id"),
  sanitizeRequestBody,
  detectMaliciousPayload,
  reviewEmployerVerification
);

module.exports = router;
