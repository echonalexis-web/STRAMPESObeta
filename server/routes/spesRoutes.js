const router = require("express").Router();
const {
  verifyToken: protect,
  isAdmin,
  isJobseeker,
  requireSpesAge,
  requireSpesViewAge,
} = require("../middleware/auth");
const { persistUploads, cleanupUploadedFiles } = require("../middleware/upload");
const { spesSlotsUpload, spesSingleUpload, validateSpesFiles } = require("../middleware/spesUpload");
const {
  sanitizeRequestBody,
  sanitizeQueryParams,
  validateMongoId,
} = require("../middleware/validation");
const spes = require("../controllers/spesController");
const postings = require("../controllers/spesPostingController");

router.use(protect);

// --- Applicant: list own applications ---
router.get("/applications", spes.listMySpesApplications);

// --- Applicant: browse postings (15 and older; 31+ read-only) ---
router.get("/postings", isJobseeker, requireSpesViewAge, spes.listPostings);
router.get("/postings/:postingId", validateMongoId("postingId"), isJobseeker, requireSpesViewAge, spes.getPostingDetail);

// --- Admin: postings ---
router.get("/admin/postings", isAdmin, postings.adminListPostings);
router.post("/admin/postings", isAdmin, sanitizeRequestBody, postings.createPosting);
router.get("/admin/postings/:postingId", isAdmin, validateMongoId("postingId"), postings.adminGetPosting);
router.put("/admin/postings/:postingId", isAdmin, validateMongoId("postingId"), sanitizeRequestBody, postings.updatePosting);
router.delete("/admin/postings/:postingId", isAdmin, validateMongoId("postingId"), postings.deletePosting);
router.patch("/admin/postings/:postingId/status", isAdmin, validateMongoId("postingId"), sanitizeRequestBody, postings.setPostingStatus);
router.patch("/admin/postings/:postingId/closed", isAdmin, validateMongoId("postingId"), sanitizeRequestBody, postings.setPostingClosed);
router.get("/admin/postings/:postingId/release-summary", isAdmin, validateMongoId("postingId"), postings.releaseSummary);
router.post("/admin/postings/:postingId/release-results", isAdmin, validateMongoId("postingId"), postings.releaseResults);

// Old admin paths, kept so existing callers keep working (the id may be a posting
// or a legacy announcement; resolvePosting accepts either).
router.get("/admin/programs", isAdmin, postings.adminListPostings);
router.patch(
  "/admin/announcements/:postingId/closed",
  isAdmin,
  validateMongoId("postingId"),
  sanitizeRequestBody,
  postings.setPostingClosed
);
router.get("/admin/announcements/:postingId/release-summary", isAdmin, validateMongoId("postingId"), postings.releaseSummary);
router.post("/admin/announcements/:postingId/release-results", isAdmin, validateMongoId("postingId"), postings.releaseResults);

// --- Admin: monitoring (application queue, review, evaluation) ---
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

// --- Applicant: per posting. Both /postings/:postingId/... and the old
// /:postingId/... paths work (the id may be a legacy announcement id). ---
for (const prefix of ["/postings/:postingId", "/:postingId"]) {
  router.get(`${prefix}/me`, validateMongoId("postingId"), spes.getMySpesApplication);
  router.get(`${prefix}/eligibility`, validateMongoId("postingId"), isJobseeker, requireSpesViewAge, spes.getSpesEligibility);
  router.get(`${prefix}/results`, validateMongoId("postingId"), spes.getSpesResultsRoster);
  // requireSpesAge runs before the upload middleware so an ineligible user's
  // files are never read or stored.
  router.post(
    `${prefix}/apply`,
    validateMongoId("postingId"),
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
    `${prefix}/documents/:slot`,
    validateMongoId("postingId"),
    isJobseeker,
    spesSingleUpload,
    validateSpesFiles,
    cleanupUploadedFiles,
    persistUploads("spes"),
    spes.replaceMyDocument
  );
  router.post(`${prefix}/withdraw`, validateMongoId("postingId"), isJobseeker, spes.withdrawMyApplication);
}

module.exports = router;
