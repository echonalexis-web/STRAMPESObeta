const router = require("express").Router();
const {
  getAdminAnalytics,
  getProvincialAnalytics,
  getAllUsers,
  getUserProfileDetails,
  getHomepageJobManagement,
  getAdminVacancies,
  getAdminVacancyStats,
  updateJobStatus,
  getAdminJob,
  adminUpdateJob,
  updateUserRole,
  deactivateUser,
  reactivateUser,
  getAuditLogs,
  deleteUser,
  toggleHomepageFeature,
} = require("../controllers/adminController");
const { adminExportForm1, adminExportForm2 } = require("../controllers/nsrpFormController");
const {
  approveEmployerVerification,
  rejectEmployerVerification,
  markEmployerVerificationUnderReview,
  requestEmployerResubmission,
} = require("../controllers/verificationController");
const {
  getMatchWeightDefaults,
  updateMatchWeightDefaults,
  getMatchWeightBounds,
  updateMatchWeightBounds,
} = require("../controllers/matchWeightsController");
const { verifyToken: protect, isAdmin, isSuperadmin, authorizeRoles } = require("../middleware/auth");
const {
  sanitizeRequestBody,
  sanitizeQueryParams,
  validateMongoId,
  validateRequest,
  validateJobPosting,
  validateQualifications,
} = require("../middleware/validation");
const { detectMaliciousPayload } = require("../middleware/security");

// All admin routes require authentication and admin role
router.use(protect, isAdmin);

// Dashboard
router.get("/analytics", sanitizeQueryParams, getAdminAnalytics);
router.get("/analytics/provincial", sanitizeQueryParams, getProvincialAnalytics);

// User management.
// The management surface (provisioning-tier actions, the audit trail) is
// superadmin-only. Admins keep read access: the directory listing feeds the
// admin Reports & Statistics page, and the per-user detail view is still
// reachable from job monitoring. Employer verification lives on its own route
// module (routes/verificationRoutes.js).
router.get("/users", sanitizeQueryParams, getAllUsers);
router.get("/users/:id", validateMongoId("id"), sanitizeQueryParams, validateRequest, getUserProfileDetails);
router.get("/users/:id/nsrp-form-1/export", validateMongoId("id"), validateRequest, adminExportForm1);
router.get("/users/:id/nsrp-form-2/export", validateMongoId("id"), validateRequest, adminExportForm2);
router.put("/users/:id/role", isSuperadmin, validateMongoId("id"), sanitizeRequestBody, detectMaliciousPayload, updateUserRole);
router.put("/users/:id/deactivate", isSuperadmin, validateMongoId("id"), sanitizeRequestBody, deactivateUser);
router.put("/users/:id/reactivate", isSuperadmin, validateMongoId("id"), sanitizeRequestBody, reactivateUser);
router.delete("/users/:id", isSuperadmin, validateMongoId("id"), deleteUser);
router.get("/audit-logs", isSuperadmin, sanitizeQueryParams, getAuditLogs);

// Employer verification — id-scoped approve/reject matching the documented
// API contract. Admin-only (not superadmin): this router is gated by isAdmin
// above, which lets superadmin through too, so these two routes re-narrow to
// "admin" specifically — mirroring the legacy PATCH decision route in
// routes/verificationRoutes.js (authorizeRoles("admin")), which keeps
// superadmin's access to this feature read-only-by-design.
router.post(
  "/employers/:id/verification/approve",
  authorizeRoles("admin"),
  validateMongoId("id"),
  approveEmployerVerification
);
router.post(
  "/employers/:id/verification/reject",
  authorizeRoles("admin"),
  validateMongoId("id"),
  sanitizeRequestBody,
  detectMaliciousPayload,
  rejectEmployerVerification
);
router.post(
  "/employers/:id/verification/under-review",
  authorizeRoles("admin"),
  validateMongoId("id"),
  markEmployerVerificationUnderReview
);
router.post(
  "/employers/:id/verification/resubmission-required",
  authorizeRoles("admin"),
  validateMongoId("id"),
  sanitizeRequestBody,
  detectMaliciousPayload,
  requestEmployerResubmission
);

// Job management
router.get("/jobs", sanitizeQueryParams, getAdminVacancies);
router.get("/jobs/stats", sanitizeQueryParams, getAdminVacancyStats);
router.get("/jobs/homepage-display", sanitizeQueryParams, getHomepageJobManagement);
router.put("/jobs/:id/homepage-feature", validateMongoId("id"), sanitizeRequestBody, toggleHomepageFeature);
router.put("/jobs/:id/status", validateMongoId("id"), sanitizeRequestBody, validateRequest, updateJobStatus);

router.get("/jobs/:id", validateMongoId("id"), validateRequest, getAdminJob);
router.put("/jobs/:id",
  validateMongoId("id"),
  sanitizeRequestBody,
  detectMaliciousPayload,
  validateJobPosting,
  validateQualifications,
  validateRequest,
  adminUpdateJob
);

// §C.1 — configurable job-matching weights. The platform-default profile
// is reachable by admin and superadmin alike (this router's blanket isAdmin
// above already lets both through); the per-criterion bounds are
// superadmin-only, re-narrowed per-route exactly like /users/:id/role above
// — and re-checked again inside the controller itself, since this is the
// one surface in this feature that must never be reachable by a plain admin.
router.get("/match-weight-defaults", getMatchWeightDefaults);
router.put(
  "/match-weight-defaults",
  sanitizeRequestBody,
  detectMaliciousPayload,
  validateRequest,
  updateMatchWeightDefaults
);

router.get("/match-weight-bounds", isSuperadmin, getMatchWeightBounds);
router.put(
  "/match-weight-bounds",
  isSuperadmin,
  sanitizeRequestBody,
  detectMaliciousPayload,
  validateRequest,
  updateMatchWeightBounds
);

module.exports = router;