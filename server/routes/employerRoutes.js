const router = require("express").Router();
const {
  getEmployerJobs,
  createJob,
  updateJob,
  deleteJob,
  getApplicantsForJob,
  updateApplicationStatus,
  scheduleInterview,
  bulkScheduleInterview,
  markInterviewNoShow,
  bulkUpdateApplicationStatuses,
  getEmployerStats,
  getEmployerProfileStats,
  getConnectedJobseekerProfile,
} = require("../controllers/employerController");
const { getRankedApplicants } = require("../controllers/employerRecommendationController");
const {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} = require("../controllers/qualificationTemplateController");
const { verifyToken: protect, isEmployer, isVerifiedEmployer } = require("../middleware/auth");
const {
  sanitizeRequestBody,
  sanitizeQueryParams,
  validateMongoId,
  validateRequest,
  validateJobPosting,
  validateQualifications,
} = require("../middleware/validation");
const { detectMaliciousPayload } = require("../middleware/security");
const rateLimit = require("express-rate-limit");

// Rate limiting for employer routes
const employerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { message: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

const jobCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { message: "Too many job postings. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Every route below requires a signed-in employer. `isVerifiedEmployer` is
// deliberately NOT applied blanket-wide here (it used to be, via
// `router.use(...)`) — that meant an employer who hasn't been verified yet
// (or is still mid-review) got a 403 just for loading their own dashboard
// stats or job list, which are read-only and have nothing to do with the
// "must be verified to post a job" rule. It's applied per-route instead,
// only on the actions that rule actually protects.
router.use(protect, isEmployer, employerLimiter);

// Jobs — viewing your own (possibly empty) list never requires verification;
// creating/editing a posting does.
router.get("/jobs", sanitizeQueryParams, getEmployerJobs);
router.post("/jobs",
  isVerifiedEmployer,
  jobCreationLimiter,
  sanitizeRequestBody,
  detectMaliciousPayload,
  validateJobPosting,
  validateQualifications,
  validateRequest,
  createJob
);
router.put("/jobs/:id",
  isVerifiedEmployer,
  validateMongoId("id"),
  sanitizeRequestBody,
  detectMaliciousPayload,
  validateJobPosting,
  validateQualifications,
  validateRequest,
  updateJob
);
router.delete("/jobs/:id",
  isVerifiedEmployer,
  validateMongoId("id"),
  deleteJob
);

// Applications — only reachable once a job exists, which already implies
// verification, but gated explicitly anyway for defense in depth.
router.get("/jobs/:jobId/applicants",
  isVerifiedEmployer,
  validateMongoId("jobId"),
  sanitizeQueryParams,
  getApplicantsForJob
);
router.put("/applications/:applicationId/status",
  isVerifiedEmployer,
  validateMongoId("applicationId"),
  sanitizeRequestBody,
  detectMaliciousPayload,
  updateApplicationStatus
);
router.put("/applications/bulk-status",
  isVerifiedEmployer,
  sanitizeRequestBody,
  detectMaliciousPayload,
  bulkUpdateApplicationStatuses
);
router.put("/applications/:applicationId/interview",
  isVerifiedEmployer,
  validateMongoId("applicationId"),
  sanitizeRequestBody,
  detectMaliciousPayload,
  scheduleInterview
);
router.put("/applications/bulk-interview",
  isVerifiedEmployer,
  sanitizeRequestBody,
  detectMaliciousPayload,
  bulkScheduleInterview
);
router.put("/applications/:applicationId/no-show",
  isVerifiedEmployer,
  validateMongoId("applicationId"),
  sanitizeRequestBody,
  detectMaliciousPayload,
  markInterviewNoShow
);

// --- Ranked applicants (semantic) ---
router.get("/jobs/:jobId/applicants/ranked",
  isVerifiedEmployer,
  validateMongoId("jobId"),
  sanitizeQueryParams,
  getRankedApplicants
);

// --- Reusable qualification / skillset templates ---
router.get("/qualification-templates", isVerifiedEmployer, listTemplates);
router.post("/qualification-templates",
  isVerifiedEmployer,
  sanitizeRequestBody,
  detectMaliciousPayload,
  createTemplate
);
router.put("/qualification-templates/:id",
  isVerifiedEmployer,
  validateMongoId("id"),
  sanitizeRequestBody,
  detectMaliciousPayload,
  updateTemplate
);
router.delete("/qualification-templates/:id",
  isVerifiedEmployer,
  validateMongoId("id"),
  deleteTemplate
);

// Stats — read-only dashboard numbers, viewable regardless of verification
// status (this is what a pending/unverified employer's own profile page
// loads, alongside the Verification tab itself).
router.get("/stats", sanitizeQueryParams, getEmployerStats);
router.get("/profile-stats", sanitizeQueryParams, getEmployerProfileStats);

// View a jobseeker's profile (only applicants or followers) — moot before
// verification (no jobs means no applicants/followers yet), gated to match.
router.get("/jobseekers/:userId", isVerifiedEmployer, validateMongoId("userId"), getConnectedJobseekerProfile);

// Error handling middleware
router.use((err, req, res, next) => {
  console.error("Employer route error:", err);
  
  if (err.name === "ValidationError") {
    return res.status(400).json({ 
      message: "Validation error", 
      errors: err.errors 
    });
  }
  
  if (err.name === "CastError") {
    return res.status(400).json({ 
      message: "Invalid ID format" 
    });
  }
  
  res.status(err.status || 500).json({ 
    message: process.env.NODE_ENV === "production" 
      ? "An error occurred" 
      : err.message 
  });
});

module.exports = router;