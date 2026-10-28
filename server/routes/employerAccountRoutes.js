const router = require("express").Router();
const { verifyToken: protect, isEmployer } = require("../middleware/auth");
const { sanitizeRequestBody, validateMongoId, validateRequest } = require("../middleware/validation");
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
const {
  getEmployerMatchWeights,
  updateEmployerMatchWeights,
  resetEmployerMatchWeights,
} = require("../controllers/matchWeightsController");

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

// §C.1 — employer's own default job-matching weight profile. Role-gated
// per-route (isEmployer) rather than at router.use() level, matching this
// file's existing precedent of keeping the blanket `protect` loose and
// applying narrower checks only where a route actually needs them.
router.get("/match-weights", isEmployer, getEmployerMatchWeights);
router.put(
  "/match-weights",
  isEmployer,
  sanitizeRequestBody,
  detectMaliciousPayload,
  validateRequest,
  updateEmployerMatchWeights
);
router.delete("/match-weights", isEmployer, resetEmployerMatchWeights);

module.exports = router;
