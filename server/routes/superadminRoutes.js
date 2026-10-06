const router = require("express").Router();
const {
  listAdmins,
  createAdmin,
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
const { detectMaliciousPayload } = require("../middleware/security");

// Every superadmin route requires a valid session AND the superadmin role.
// "admin" is deliberately not accepted here.
router.use(protect, isSuperadmin);

router.get("/admins", listAdmins);

router.post(
  "/admins",
  sanitizeRequestBody,
  detectMaliciousPayload,
  createAdmin
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
