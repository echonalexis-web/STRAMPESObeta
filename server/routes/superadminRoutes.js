const router = require("express").Router();
const {
  listAdmins,
  createAdmin,
  setAdminActive,
  resetAdminPassword,
  deleteJob,
} = require("../controllers/superadminController");
const { verifyToken: protect, isSuperadmin } = require("../middleware/auth");
const {
  sanitizeRequestBody,
  validateMongoId,
  validateRequest,
} = require("../middleware/validation");
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

module.exports = router;
