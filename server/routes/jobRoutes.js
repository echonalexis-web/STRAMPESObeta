const express = require("express");
const router = express.Router();
const {
  getJobs,
  getJobById,
  getHomepageJobs,
  closeJob,
  archiveJob,
  reopenJob,
  applyToJob,
  updateMyApplication,
  deleteMyApplication,
  getApplicationsForJob,
  getMyApplications,
} = require("../controllers/jobController");
const { verifyToken, isJobseeker, isEmployer, isVerifiedEmployer } = require("../middleware/auth");
const {
  validateJobApplication,
  validateRequest,
  sanitizeRequestBody,
  sanitizeQueryParams,
  validateMongoId,
} = require("../middleware/validation");
const { detectMaliciousPayload } = require("../middleware/security");
const { jobAttachmentUpload, persistFields, cleanupUploadedFiles } = require("../middleware/upload");

// Multipart parser for job-application attachments (buffers only; persisted by persistFields)
const upload = jobAttachmentUpload;
const APPLICATION_FILE_CATEGORIES = {
  resume: "applicationResume",
  coverLetterFile: "applicationCover",
};

// ============ PUBLIC ROUTES ============
router.get("/homepage", getHomepageJobs);
router.get("/", getJobs);
router.get("/:id", getJobById);

// ============ PROTECTED ROUTES ============

// Employer routes – now require verified status
router.post("/:id/close", verifyToken, isEmployer, isVerifiedEmployer, closeJob);
router.post("/:id/archive", verifyToken, isEmployer, isVerifiedEmployer, archiveJob);
router.post("/:id/reopen", verifyToken, isEmployer, isVerifiedEmployer, reopenJob);

// Job applications - Employer viewing (also verified)
router.get("/:id/applications", verifyToken, isEmployer, isVerifiedEmployer, getApplicationsForJob);

// Jobseeker routes
router.get("/applications/me", verifyToken, isJobseeker, getMyApplications);

// Apply to job with resume and optional cover letter file upload
router.post(
  "/:id/apply",
  verifyToken,
  isJobseeker,
  validateMongoId("id"),
  upload.fields([
    { name: "resume", maxCount: 1 },
    { name: "coverLetterFile", maxCount: 1 },
  ]),
  cleanupUploadedFiles,
  persistFields(APPLICATION_FILE_CATEGORIES),
  sanitizeRequestBody,
  detectMaliciousPayload,
  validateJobApplication,
  validateRequest,
  applyToJob
);

// Update application files
router.put(
  "/applications/:id",
  verifyToken,
  isJobseeker,
  validateMongoId("id"),
  upload.fields([
    { name: "resume", maxCount: 1 },
    { name: "coverLetterFile", maxCount: 1 },
  ]),
  cleanupUploadedFiles,
  persistFields(APPLICATION_FILE_CATEGORIES),
  sanitizeRequestBody,
  detectMaliciousPayload,
  validateJobApplication,
  validateRequest,
  updateMyApplication
);

// Delete application
router.delete(
  "/applications/:id",
  verifyToken,
  isJobseeker,
  validateMongoId("id"),
  deleteMyApplication
);

module.exports = router;