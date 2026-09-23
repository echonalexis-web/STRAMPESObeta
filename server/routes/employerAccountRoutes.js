const router = require("express").Router();
const { verifyToken: protect } = require("../middleware/auth");
const { sanitizeRequestBody, validateMongoId } = require("../middleware/validation");
const { detectMaliciousPayload } = require("../middleware/security");
const {
  avatarUpload,
  documentsUpload,
  validateFile,
  persistUploads,
  persistFields,
  cleanupUploadedFiles,
} = require("../middleware/upload");
const {
  uploadEmployerAvatar,
  submitEmployerVerificationWithDocuments,
} = require("../controllers/verificationController");

// Self-service account endpoints for an employer whose account may not be
// verified yet (profile picture, verification-document submission). These
// are deliberately NOT behind isVerifiedEmployer (see routes/employerRoutes.js)
// since an unverified employer has to be able to reach them.
router.use(protect);

router.post(
  "/:id/avatar",
  validateMongoId("id"),
  avatarUpload.single("file"),
  validateFile,
  cleanupUploadedFiles,
  persistUploads("avatar"),
  uploadEmployerAvatar
);

router.post(
  "/:id/verification/submit",
  validateMongoId("id"),
  documentsUpload.fields([
    { name: "businessPermit", maxCount: 1 },
    { name: "registrationDoc", maxCount: 1 },
  ]),
  cleanupUploadedFiles,
  persistFields({ businessPermit: "permit", registrationDoc: "registration" }),
  sanitizeRequestBody,
  detectMaliciousPayload,
  submitEmployerVerificationWithDocuments
);

module.exports = router;
