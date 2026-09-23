const router = require("express").Router();
const {
    documentsUpload,
    avatarUpload,
    validateFile,
    persistFields,
    persistUploads,
    cleanupUploadedFiles,
} = require("../middleware/upload");
const {
    register,
    login,
    forgotPassword,
    resetPassword,
    requestEmailChange,
    confirmEmailChange,
    googleAuth,
    resendEmailVerification,
    confirmEmailVerification,
    getMe,
    getProfile,
    updateProfile,
    updateAvatar,
    registerEmployer,
    acceptTerms,
    changePassword,
    getSettings,
    updateSettings,
    deactivateAccount
} = require("../controllers/authController");
const { verifyToken: protect, isAdmin } = require("../middleware/auth");
const { exportOwnForm1, exportOwnForm2 } = require("../controllers/nsrpFormController");
const {
  sanitizeRequestBody,
  sanitizeQueryParams,
  validateUserRegistration,
  validateUserLogin,
  validateRequest
} = require("../middleware/validation");
const { detectMaliciousPayload, sensitiveOperationLimiter } = require("../middleware/security");

// Field -> storage category for the profile update endpoints
const PROFILE_DOC_FIELDS = [
  { name: "resumeFile", maxCount: 1 },
  { name: "validIdFile", maxCount: 1 },
  { name: "businessPermit", maxCount: 1 },
  { name: "registrationDoc", maxCount: 1 },
];
const PROFILE_DOC_CATEGORIES = {
  resumeFile: "resume",
  validIdFile: "validId",
  businessPermit: "permit",
  registrationDoc: "registration",
};

const ME_DOC_FIELDS = [
  { name: "resume", maxCount: 1 },
  { name: "supportingDocument", maxCount: 1 },
];
const ME_DOC_CATEGORIES = {
  resume: "resume",
  supportingDocument: "validId",
};

// Public routes
router.post(
  "/register",
  sanitizeRequestBody,
  detectMaliciousPayload,
  validateUserRegistration,
  validateRequest,
  register
);

router.post(
  "/login",
  sanitizeRequestBody,
  detectMaliciousPayload,
  validateUserLogin,
  validateRequest,
  login
);

router.post(
  "/forgot-password",
  sanitizeRequestBody,
  detectMaliciousPayload,
  forgotPassword
);

router.post(
  "/reset-password",
  sanitizeRequestBody,
  detectMaliciousPayload,
  resetPassword
);

// Google Identity Services — verify an ID token, then find-or-create + issue JWT
router.post(
  "/google",
  sanitizeRequestBody,
  detectMaliciousPayload,
  googleAuth
);

// Confirm an email change (token from the link — no session needed)
router.post(
  "/email-change/confirm",
  sanitizeRequestBody,
  detectMaliciousPayload,
  confirmEmailChange
);

// Registration email verification — both public, no session needed.
router.post(
  "/verify-email/resend",
  sanitizeRequestBody,
  detectMaliciousPayload,
  resendEmailVerification
);

router.post(
  "/verify-email/confirm",
  sanitizeRequestBody,
  detectMaliciousPayload,
  confirmEmailVerification
);

router.post(
  "/register/employer",
  sanitizeRequestBody,
  detectMaliciousPayload,
  validateUserRegistration,
  validateRequest,
  registerEmployer
);

// Protected routes
router.get("/me", protect, getMe);
router.get("/profile", protect, getProfile);
router.get("/nsrp-form-1/export", protect, exportOwnForm1);
router.get("/nsrp-form-2/export", protect, exportOwnForm2);
router.post("/accept-terms", protect, sanitizeRequestBody, acceptTerms);
router.post(
  "/change-password",
  protect,
  sanitizeRequestBody,
  detectMaliciousPayload,
  changePassword
);

// Start an email change — requires the current session + password re-auth
router.post(
  "/email-change/request",
  protect,
  sanitizeRequestBody,
  detectMaliciousPayload,
  requestEmailChange
);

router.put(
  "/profile",
  protect,
  documentsUpload.fields(PROFILE_DOC_FIELDS),
  cleanupUploadedFiles,
  persistFields(PROFILE_DOC_CATEGORIES),
  sanitizeRequestBody,
  detectMaliciousPayload,
  updateProfile
);

router.patch(
  "/me",
  protect,
  documentsUpload.fields(ME_DOC_FIELDS),
  cleanupUploadedFiles,
  persistFields(ME_DOC_CATEGORIES),
  sanitizeRequestBody,
  detectMaliciousPayload,
  updateProfile
);

// Profile picture — image-only, available to every authenticated role.
router.patch(
  "/profile/avatar",
  protect,
  avatarUpload.single("profileImage"),
  validateFile,
  cleanupUploadedFiles,
  persistUploads("avatar"),
  updateAvatar
);

// Settings → Notifications + Privacy
router.get("/settings", protect, getSettings);
router.put("/settings", protect, sanitizeRequestBody, detectMaliciousPayload, updateSettings);

// Settings → Danger Zone — self-service account deactivation
router.post(
  "/deactivate",
  protect,
  sensitiveOperationLimiter(3, 60 * 60 * 1000),
  sanitizeRequestBody,
  detectMaliciousPayload,
  deactivateAccount
);

module.exports = router;