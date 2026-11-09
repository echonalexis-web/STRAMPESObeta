const router = require("express").Router();
const { verifyToken: protect } = require("../middleware/auth");
const { uploadBudget } = require("../middleware/budgets");
const {
  completeOnboarding,
  getProfile,
  updateProfile,
  uploadProfileImage,
  changePassword,
  uploadResume,
  setMyDateOfBirth,
} = require("../controllers/userController");
const { submitEmployerVerification } = require("../controllers/verificationController");
const { profileUpload, validateFile, persistUploads, cleanupUploadedFiles } = require("../middleware/upload");
const {
  validateUserUpdate,
  validatePasswordChange,
  validateRequest,
  sanitizeRequestBody,
  sanitizeQueryParams,
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

// Legacy accounts: set the date of birth once (locked afterwards)
router.post("/me/dob", sanitizeRequestBody, detectMaliciousPayload, sensitiveOperationLimiter, setMyDateOfBirth);

// Profile routes
router.get("/profile", sanitizeQueryParams, getProfile);
router.put("/profile", sanitizeRequestBody, detectMaliciousPayload, validateUserUpdate, validateRequest, updateProfile);

// Profile image upload (public asset)
router.post(
  "/upload-profile-image",
  uploadBudget,
  profileUpload.single("profileImage"),
  validateFile,
  cleanupUploadedFiles,
  persistUploads("avatar"),
  uploadProfileImage
);

// Resume upload (private document)
router.post(
  "/upload-resume",
  uploadBudget,
  profileUpload.single("resume"),
  validateFile,
  cleanupUploadedFiles,
  persistUploads("resume"),
  uploadResume
);

// Employer verification submission (documents uploaded via the profile route)
router.post("/verification/submit", sanitizeRequestBody, submitEmployerVerification);

// Password change with rate limiting
router.put("/change-password", sensitiveOperationLimiter(3, 60 * 60 * 1000), sanitizeRequestBody, detectMaliciousPayload, validatePasswordChange, validateRequest, changePassword);

module.exports = router;