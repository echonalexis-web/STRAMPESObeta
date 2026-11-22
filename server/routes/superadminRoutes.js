const router = require("express").Router();
const {
  listAdmins,
  createAdmin,
  resendInvite,
  cancelInvite,
  setAdminActive,
  resetAdminPassword,
  deleteJob,
} = require("../controllers/superadminController");
const {
  getSystemSettings,
  updateSystemSettings,
} = require("../controllers/systemSettingsController");
const { verifyToken: protect, isSuperadmin } = require("../middleware/auth");
const {
  sanitizeRequestBody,
  validateMongoId,
  validateRequest,
} = require("../middleware/validation");
const { singleFileUpload, validateFile } = require("../middleware/upload");
const {
  validateNsrpTemplate,
  persistNsrpTemplate,
  uploadNsrpTemplate,
  downloadNsrpSample,
  getNsrpTemplateMeta,
} = require("../controllers/nsrpTemplateController");
const { detectMaliciousPayload, sensitiveOperationLimiter } = require("../middleware/security");
const { positiveIntEnv } = require("../middleware/dbLimiter");

// Every superadmin route requires a valid session AND the superadmin role.
// "admin" is deliberately not accepted here.
router.use(protect, isSuperadmin);

// Staff provisioning limits. Read when the router loads. Per superadmin per
// hour for new accounts; per account per hour for resends (the cooldown and the
// per-invite cap in the controller are the stricter checks).
const provisionLimiter = sensitiveOperationLimiter(positiveIntEnv("STAFF_PROVISION_LIMIT_PER_HOUR", 20), 60 * 60 * 1000, {
  keyFn: (req) => `provision|${req.user && req.user.id}`,
});
const resendLimiter = sensitiveOperationLimiter(positiveIntEnv("STAFF_RESEND_LIMIT_PER_HOUR", 12), 60 * 60 * 1000, {
  keyFn: (req) => `resend|${req.params && req.params.id}`,
});

router.get("/admins", listAdmins);

router.post(
  "/admins",
  provisionLimiter,
  sanitizeRequestBody,
  detectMaliciousPayload,
  createAdmin
);

router.post(
  "/admins/:id/resend-invite",
  validateMongoId("id"),
  validateRequest,
  resendLimiter,
  resendInvite
);

router.delete(
  "/admins/:id/invite",
  validateMongoId("id"),
  validateRequest,
  cancelInvite
);

router.patch(
  "/admins/:id/active",
  validateMongoId("id"),
  validateRequest,
  sanitizeRequestBody,
  setAdminActive
);

router.post(
  "/admins/:id/reset-password",
  validateMongoId("id"),
  validateRequest,
  resetAdminPassword
);

router.delete(
  "/jobs/:id",
  validateMongoId("id"),
  validateRequest,
  sanitizeRequestBody,
  detectMaliciousPayload,
  deleteJob
);

// Settings → System Preferences
router.get("/system-settings", getSystemSettings);
router.put(
  "/system-settings",
  sanitizeRequestBody,
  detectMaliciousPayload,
  updateSystemSettings
);

router.put("/system-settings/nsrp-templates/:form",
  (req, res, next) => singleFileUpload("template")(req, res, (error) => {
    if (error) return res.status(400).json({ message: error.message });
    return next();
  }),
  validateFile,
  sanitizeRequestBody,
  detectMaliciousPayload,
  validateRequest,
  validateNsrpTemplate,
  persistNsrpTemplate,
  uploadNsrpTemplate
);
router.get("/system-settings/nsrp-templates/:form/sample", validateRequest, downloadNsrpSample);
router.get("/system-settings/nsrp-templates/:form/meta", validateRequest, getNsrpTemplateMeta);

module.exports = router;
