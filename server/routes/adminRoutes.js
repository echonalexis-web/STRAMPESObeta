const router = require("express").Router();
const {
  getAdminAnalytics,
  getProvincialAnalytics,
  getAllUsers,
  getUserProfileDetails,
  getHomepageJobManagement,
  getAdminVacancies,
  getAdminVacancyStats,
  deleteJob,
  updateJobStatus,
  updateUserRole,
  deactivateUser,
  reactivateUser,
  updateEmployerVerification,
  getVerificationQueue,
  getAuditLogs,
  deleteUser,
  toggleHomepageFeature,
} = require("../controllers/adminController");
const { verifyToken: protect, isAdmin } = require("../middleware/auth");
const {
  sanitizeRequestBody,
  sanitizeQueryParams,
  validateMongoId,
  validateRequest
} = require("../middleware/validation");
const { detectMaliciousPayload } = require("../middleware/security");

// All admin routes require authentication and admin role
router.use(protect, isAdmin);

// Dashboard
router.get("/analytics", sanitizeQueryParams, getAdminAnalytics);
router.get("/analytics/provincial", sanitizeQueryParams, getProvincialAnalytics);

// User management
router.get("/users", sanitizeQueryParams, getAllUsers);
router.get("/users/verification-queue", sanitizeQueryParams, getVerificationQueue);
router.get("/users/:id", validateMongoId("id"), sanitizeQueryParams, validateRequest, getUserProfileDetails);
router.put("/users/:id/role", validateMongoId("id"), sanitizeRequestBody, detectMaliciousPayload, updateUserRole);
router.put("/users/:id/deactivate", validateMongoId("id"), sanitizeRequestBody, deactivateUser);
router.put("/users/:id/reactivate", validateMongoId("id"), sanitizeRequestBody, reactivateUser);
router.put("/users/:id/verification", validateMongoId("id"), sanitizeRequestBody, updateEmployerVerification);
router.delete("/users/:id", validateMongoId("id"), deleteUser);
router.get("/audit-logs", sanitizeQueryParams, getAuditLogs);

// Job management
router.get("/jobs", sanitizeQueryParams, getAdminVacancies);
router.get("/jobs/stats", sanitizeQueryParams, getAdminVacancyStats);
router.get("/jobs/homepage-display", sanitizeQueryParams, getHomepageJobManagement);
router.put("/jobs/:id/homepage-feature", validateMongoId("id"), sanitizeRequestBody, toggleHomepageFeature);
router.put("/jobs/:id/status", validateMongoId("id"), sanitizeRequestBody, validateRequest, updateJobStatus);
router.delete("/jobs/:id", validateMongoId("id"), deleteJob);

module.exports = router;