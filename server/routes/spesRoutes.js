const router = require("express").Router();
const { verifyToken: protect, isAdmin, isResident } = require("../middleware/auth");
const {
  documentsUpload,
  persistUploads,
  cleanupUploadedFiles,
} = require("../middleware/upload");
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
  "/admin/:id/result",
  isAdmin,
  validateMongoId("id"),
  sanitizeRequestBody,
  spes.adminAmendResult
);
router.post(
  "/admin/announcements/:announcementId/release-results",
  isAdmin,
  validateMongoId("announcementId"),
  spes.adminReleaseResults
);

// --- Applicant: per-announcement ---
router.get("/:announcementId/me", validateMongoId("announcementId"), spes.getMySpesApplication);
router.get("/:announcementId/results", validateMongoId("announcementId"), spes.getSpesResultsRoster);
router.post(
  "/:announcementId/apply",
  validateMongoId("announcementId"),
  isResident,
  documentsUpload.array("documents", 4),
  cleanupUploadedFiles,
  persistUploads("spes"),
  sanitizeRequestBody,
  spes.applyToSpes
);

module.exports = router;
