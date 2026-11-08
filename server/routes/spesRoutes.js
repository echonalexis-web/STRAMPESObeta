const router = require("express").Router();
const { verifyToken: protect, isAdmin, isJobseeker, requireSpesAge } = require("../middleware/auth");
const { persistUploads, cleanupUploadedFiles } = require("../middleware/upload");
const { spesSlotsUpload, spesSingleUpload, validateSpesFiles } = require("../middleware/spesUpload");
const {
  sanitizeRequestBody,
  sanitizeQueryParams,
  validateMongoId,
} = require("../middleware/validation");
const spes = require("../controllers/spesController");

router.use(protect);

// --- Applicant: list own applications ---
router.get("/applications", spes.listMySpesApplications);

// --- Admin ---
router.get("/admin/programs", isAdmin, spes.adminListPrograms);
router.get("/admin/list", isAdmin, sanitizeQueryParams, spes.adminListSpesApplications);
router.get("/admin/:id", isAdmin, validateMongoId("id"), spes.adminGetSpesApplication);
router.patch(
  "/admin/:id/evaluation",
  isAdmin,
  validateMongoId("id"),
  sanitizeRequestBody,
  spes.adminRecordEvaluation
);
router.patch(
  "/admin/:id/documents/:docId",
  isAdmin,
  validateMongoId("id"),
  validateMongoId("docId"),
  sanitizeRequestBody,
  spes.adminVerifyDocument
);
router.patch(
  "/admin/:id/result",
  isAdmin,
  validateMongoId("id"),
  sanitizeRequestBody,
  spes.adminAmendResult
);
router.get(
  "/admin/announcements/:announcementId/release-summary",
  isAdmin,
  validateMongoId("announcementId"),
  spes.adminReleaseSummary
);
router.patch(
  "/admin/announcements/:announcementId/closed",
  isAdmin,
  validateMongoId("announcementId"),
  sanitizeRequestBody,
  spes.adminSetProgramClosed
);
router.post(
  "/admin/announcements/:announcementId/release-results",
  isAdmin,
  validateMongoId("announcementId"),
  spes.adminReleaseResults
);

// --- Applicant: per-announcement ---
router.get("/:announcementId/me", validateMongoId("announcementId"), spes.getMySpesApplication);
router.get("/:announcementId/eligibility", validateMongoId("announcementId"), isJobseeker, spes.getSpesEligibility);
router.get("/:announcementId/results", validateMongoId("announcementId"), spes.getSpesResultsRoster);
// requireSpesAge runs before the upload middleware so an ineligible user's
// files are never read or stored.
router.post(
  "/:announcementId/apply",
  validateMongoId("announcementId"),
  isJobseeker,
  requireSpesAge,
  spesSlotsUpload,
  validateSpesFiles,
  cleanupUploadedFiles,
  persistUploads("spes"),
  sanitizeRequestBody,
  spes.applyToSpes
);
router.post(
  "/:announcementId/documents/:slot",
  validateMongoId("announcementId"),
  isJobseeker,
  spesSingleUpload,
  validateSpesFiles,
  cleanupUploadedFiles,
  persistUploads("spes"),
  spes.replaceMyDocument
);
router.post("/:announcementId/withdraw", validateMongoId("announcementId"), isJobseeker, spes.withdrawMyApplication);

module.exports = router;
