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
    googleComplete,
    resendEmailVerification,
    confirmEmailVerification,
    getMe,
    getProfile,
    updateProfile,
    updateAvatar,
    registerEmployer,
    acceptTerms,
    changePassword,
    setPassword,
    checkUsernameAvailable,
    setUsername,
    requestRecoveryEmail,
    confirmRecoveryEmail,
    generateBackupCodes,
    redeemBackupCode,
    recoverSetPassword,
    getSettings,
    updateSettings,
    deactivateAccount
} = require("../controllers/authController");
const { verifyToken: protect, verifyRecoveryToken, isAdmin } = require("../middleware/auth");
const { exportOwnForm1, exportOwnForm2 } = require("../controllers/nsrpFormController");
const {
  sanitizeRequestBody,
  sanitizeQueryParams,
  validateUserRegistration,
  validateUserLogin,
  validateRequest
} = require("../middleware/validation");
const { detectMaliciousPayload, sensitiveOperationLimiter } = require("../middleware/security");
const idUploadLimit = require("../middleware/idUploadLimit");
const { confirmIdOcr, getIdFormats } = require("../controllers/idOcrController");

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

// Google sign-in step 2 for first-time jobseekers: pendingToken + date of birth
router.post(
  "/google/complete",
  sanitizeRequestBody,
  detectMaliciousPayload,
  googleComplete
);

// Confirm an email change (token from the link — no session needed)
router.post(
  "/email-change/confirm",
  sanitizeRequestBody,
  detectMaliciousPayload,
  confirmEmailChange
);

// Confirm a recovery email (token from the link — no session needed)
router.post(
  "/recovery-email/confirm",
  sanitizeRequestBody,
  detectMaliciousPayload,
  confirmRecoveryEmail
);

// Redeem a backup code — the account-recovery path of last resort for
// someone with neither their password nor a live Google session. Public by
// necessity; rate-limited hard and never reveals anything beyond "accepted"
// or a single generic failure — see authController.redeemBackupCode.
router.post(
  "/recover/backup-code",
  sensitiveOperationLimiter(5, 60 * 60 * 1000),
  sanitizeRequestBody,
  detectMaliciousPayload,
  redeemBackupCode
);

// Finish recovery: set a new password. Behind verifyRecoveryToken (the
// short-lived token redeemBackupCode issues), NOT the normal session
// middleware — a stolen/leaked recovery token can only ever do this one
// thing, never anything else the API offers.
router.post(
  "/recover/set-password",
  verifyRecoveryToken,
  sensitiveOperationLimiter(10, 60 * 60 * 1000),
  sanitizeRequestBody,
  detectMaliciousPayload,
  recoverSetPassword
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

// Live "is this username available?" check — public (reached from the
// registration screen pre-auth, and from Settings) and tightly rate-limited:
// a live checker necessarily leaks a little about which usernames exist, a
// trade-off accepted deliberately — see authController.checkUsernameAvailable.
router.get(
  "/username-available",
  sensitiveOperationLimiter(10, 60 * 1000),
  sanitizeQueryParams,
  checkUsernameAvailable
);

// Protected routes
router.get("/me", protect, getMe);
router.get("/profile", protect, getProfile);
router.get("/id-formats", protect, getIdFormats);
router.post("/id-ocr/confirm", protect, sanitizeRequestBody, confirmIdOcr);
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

// Add a password to a Google-only account — requires a fresh Google
// credential (verified server-side against the account's linked googleId),
// not just the current session. See authController.setPassword.
router.post(
  "/set-password",
  protect,
  sensitiveOperationLimiter(5, 60 * 60 * 1000),
  sanitizeRequestBody,
  detectMaliciousPayload,
  setPassword
);

// Set/change the signed-in user's username — format + availability +
// 30-day change cooldown enforced in authController.setUsername.
router.post(
  "/username",
  protect,
  sensitiveOperationLimiter(10, 60 * 60 * 1000),
  sanitizeRequestBody,
  detectMaliciousPayload,
  setUsername
);

// Start an email change — requires the current session + password re-auth
router.post(
  "/email-change/request",
  protect,
  sanitizeRequestBody,
  detectMaliciousPayload,
  requestEmailChange
);

// Set/change the recovery email — requires the current session + password
// re-auth, same reasoning as email-change/request above.
router.post(
  "/recovery-email/request",
  protect,
  sensitiveOperationLimiter(5, 60 * 60 * 1000),
  sanitizeRequestBody,
  detectMaliciousPayload,
  requestRecoveryEmail
);

// Generate (or regenerate) backup codes — Settings → Security.
router.post(
  "/backup-codes/generate",
  protect,
  sensitiveOperationLimiter(3, 60 * 60 * 1000),
  sanitizeRequestBody,
  detectMaliciousPayload,
  generateBackupCodes
);

router.put(
  "/profile",
  protect,
  documentsUpload.fields(PROFILE_DOC_FIELDS),
  idUploadLimit,
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
  idUploadLimit,
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
