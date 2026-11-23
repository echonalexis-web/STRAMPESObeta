const express = require("express");
const router = express.Router();
const {
  listMyDocuments,
  uploadMyDocument,
  deleteMyDocument,
  setPrimaryDocument,
} = require("../controllers/jobseekerDocumentController");
const { verifyToken, isJobseeker } = require("../middleware/auth");
const { uploadBudget } = require("../middleware/budgets");
const { documentsUpload, validateFile, avatarUpload } = require("../middleware/upload");
const {
  getResumePhotoInfo,
  getResumePhoto,
  putResumePhoto,
  removeResumePhoto,
} = require("../controllers/resumePhotoController");
const { validateMongoId, validateRequest, sanitizeRequestBody } = require("../middleware/validation");

// Jobseeker's private resume / cover letter library. Never exposed to
// employers — see jobseekerDocumentController for the access rationale.
router.get("/", verifyToken, isJobseeker, listMyDocuments);

router.post(
  "/upload",
  verifyToken,
  isJobseeker,
  uploadBudget,
  documentsUpload.single("file"),
  validateFile,
  sanitizeRequestBody,
  uploadMyDocument
);

// The applicant's resume photo: one per account, separate from the profile photo, owner-only (no id in
// the path). Same upload cap and image types as profile pictures; the controller checks the real bytes.
const photoUpload = (req, res, next) =>
  avatarUpload.single("photo")(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error.code === "LIMIT_FILE_SIZE";
    return res.status(tooLarge ? 413 : 400).json({
      code: tooLarge ? "RESUME_PHOTO_TOO_LARGE" : "RESUME_PHOTO_TYPE",
      message: tooLarge ? "That photo is larger than 2 MB." : "Use a JPG, PNG or WebP photo.",
    });
  });

router.get("/photo/info", verifyToken, isJobseeker, getResumePhotoInfo);
router.get("/photo", verifyToken, isJobseeker, getResumePhoto);
router.put("/photo", verifyToken, isJobseeker, uploadBudget, photoUpload, putResumePhoto);
router.delete("/photo", verifyToken, isJobseeker, uploadBudget, removeResumePhoto);

router.patch(
  "/:id/primary",
  verifyToken,
  isJobseeker,
  validateMongoId("id"),
  validateRequest,
  setPrimaryDocument
);

router.delete("/:id", verifyToken, isJobseeker, validateMongoId("id"), validateRequest, deleteMyDocument);

module.exports = router;
