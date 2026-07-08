const router = require("express").Router();
const {
  getEmployerJobs,
  createJob,
  updateJob,
  deleteJob,
  getApplicantsForJob,
  updateApplicationStatus,
  getEmployerStats,
  getEmployerProfileStats,
} = require("../controllers/employerController");
const { verifyToken: protect, isEmployer } = require("../middleware/auth");
const {
  sanitizeRequestBody,
  sanitizeQueryParams,
  validateMongoId,
  validateRequest,
  validateJobPosting
} = require("../middleware/validation");
const { detectMaliciousPayload } = require("../middleware/security");
const rateLimit = require("express-rate-limit");

// Rate limiting for employer routes
const employerLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { message: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limit for job creation
const jobCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 job creations per hour
  message: { message: "Too many job postings. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// All employer routes require authentication and employer role
router.use(protect, isEmployer, employerLimiter);

// Jobs
router.get("/jobs", sanitizeQueryParams, getEmployerJobs);
router.post("/jobs", 
  jobCreationLimiter,
  sanitizeRequestBody, 
  detectMaliciousPayload, 
  validateJobPosting, 
  validateRequest, 
  createJob
);
router.put("/jobs/:id", 
  validateMongoId("id"), 
  sanitizeRequestBody, 
  detectMaliciousPayload, 
  validateJobPosting, 
  validateRequest, 
  updateJob
);
router.delete("/jobs/:id", 
  validateMongoId("id"), 
  deleteJob
);

// Applications
router.get("/jobs/:jobId/applicants", 
  validateMongoId("jobId"), 
  sanitizeQueryParams, 
  getApplicantsForJob
);
router.put("/applications/:applicationId/status", 
  validateMongoId("applicationId"), 
  sanitizeRequestBody, 
  detectMaliciousPayload, 
  updateApplicationStatus
);

// Stats
router.get("/stats", sanitizeQueryParams, getEmployerStats);
router.get("/profile-stats", sanitizeQueryParams, getEmployerProfileStats);

// Error handling middleware for this router
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