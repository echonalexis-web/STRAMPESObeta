const router = require("express").Router();
const { verifyToken: protect } = require("../middleware/auth");
const { 
  completeOnboarding, 
  getProfile, 
  updateProfile, 
  uploadProfileImage,
  getUserById,
  deleteAccount,
  changePassword,
  uploadResume,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead
} = require("../controllers/userController");
const { profileUpload, validateFile, cleanupUploadedFiles } = require("../middleware/upload");
const { 
  validateUserUpdate, 
  validatePasswordChange,
  validateRequest,
  sanitizeRequestBody,
  sanitizeQueryParams,
  validateMongoId,
  validateNotificationRead
} = require("../middleware/validation");
const { detectMaliciousPayload, sensitiveOperationLimiter } = require("../middleware/security");

// ============ PROTECTED ROUTES (Authentication required) ============
router.use(protect); // Apply authentication to all routes below

// Onboarding route
router.put(
  "/onboarding",
  sanitizeRequestBody,
  detectMaliciousPayload,
  validateUserUpdate,
  validateRequest,
  completeOnboarding
);

// Profile routes
router.get("/profile", sanitizeQueryParams, getProfile);
router.put("/profile", sanitizeRequestBody, detectMaliciousPayload, validateUserUpdate, validateRequest, updateProfile);

// Profile image upload with security
router.post("/upload-profile-image", profileUpload.single("profileImage"), validateFile, cleanupUploadedFiles, uploadProfileImage);

// Resume upload
router.post("/upload-resume", profileUpload.single("resume"), validateFile, cleanupUploadedFiles, uploadResume);

// Password change with rate limiting
router.put("/change-password", sensitiveOperationLimiter(3, 60 * 60 * 1000), sanitizeRequestBody, detectMaliciousPayload, validatePasswordChange, validateRequest, changePassword);

// Get user by ID with validation
router.get("/:id", validateMongoId("id"), sanitizeQueryParams, getUserById);

// Delete account with rate limiting
router.delete("/account", sensitiveOperationLimiter(2, 24 * 60 * 60 * 1000), deleteAccount);

// Notification routes
router.get("/notifications", sanitizeQueryParams, getNotifications);
router.put("/notifications/:notificationId", validateNotificationRead, sanitizeRequestBody, markNotificationRead);
router.put("/notifications/mark-all-read", sanitizeRequestBody, markAllNotificationsRead);

module.exports = router;