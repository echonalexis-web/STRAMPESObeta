const express = require("express");
const router = express.Router();
const {
  listMyDocuments,
  uploadMyDocument,
  deleteMyDocument,
  setPrimaryDocument,
} = require("../controllers/jobseekerDocumentController");
const { verifyToken, isJobseeker } = require("../middleware/auth");
const { documentsUpload, validateFile } = require("../middleware/upload");
const { validateMongoId, validateRequest, sanitizeRequestBody } = require("../middleware/validation");

// Jobseeker's private resume / cover letter library. Never exposed to
// employers — see jobseekerDocumentController for the access rationale.
router.get("/", verifyToken, isJobseeker, listMyDocuments);

router.post(
  "/upload",
  verifyToken,
  isJobseeker,
  documentsUpload.single("file"),
  validateFile,
  sanitizeRequestBody,
  uploadMyDocument
);

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
