const router = require("express").Router();
const {
  getAdminAnalytics,
  getAllUsers,
  getHomepageJobManagement,
  updateUserRole,
  deactivateUser,
  reactivateUser,
  updateEmployerVerification,
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

// User management
router.get("/users", sanitizeQueryParams, getAllUsers);
router.put("/users/:id/role", validateMongoId("id"), sanitizeRequestBody, detectMaliciousPayload, updateUserRole);
router.put("/users/:id/deactivate", validateMongoId("id"), sanitizeRequestBody, deactivateUser);
router.put("/users/:id/reactivate", validateMongoId("id"), sanitizeRequestBody, reactivateUser);
router.put("/users/:id/verification", validateMongoId("id"), sanitizeRequestBody, updateEmployerVerification);
router.delete("/users/:id", validateMongoId("id"), deleteUser);

// Job management
router.get("/jobs/homepage-display", sanitizeQueryParams, getHomepageJobManagement);
router.put("/jobs/:id/homepage-feature", validateMongoId("id"), sanitizeRequestBody, toggleHomepageFeature);

module.exports = router;