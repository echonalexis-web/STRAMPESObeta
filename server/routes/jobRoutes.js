const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const {
  createJob,
  getJobs,
  getJobById,
  getHomepageJobs,
  updateJob,
  deleteJob,
  applyToJob,
  updateMyApplication,
  deleteMyApplication,
  getApplicationsForJob,
  getMyApplications,
  getEmployerJobs,
} = require("../controllers/jobController");
const { verifyToken, isResident, isEmployer, isVerifiedEmployer } = require("../middleware/auth");
const { 
  validateJobApplication, 
  validateRequest,
  sanitizeRequestBody,
  sanitizeQueryParams,
  validateMongoId,
  validateJobPosting,
  validateQualifications, // NEW
} = require("../middleware/validation");
const { detectMaliciousPayload } = require("../middleware/security");
const { validateFile, cleanupUploadedFiles } = require("../middleware/upload");

// Ensure upload directory exists
const uploadDir = path.join(__dirname, "../uploads/resumes");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true, mode: 0o755 });
}

// Multer configuration for resume uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '');
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    cb(null, `${timestamp}-${random}-${cleanName}`);
  }
});

const upload = multer({
  storage,
  limits: { 
    fileSize: 5 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    const allowedExtensions = ['.pdf', '.doc', '.docx'];
    
    const ext = path.extname(file.originalname).toLowerCase();
    const isValidType = allowedTypes.includes(file.mimetype) || allowedExtensions.includes(ext);
    
    if (isValidType) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Please upload PDF, DOC, or DOCX files."));
    }
  }
});

// ============ PUBLIC ROUTES ============
router.get("/homepage", getHomepageJobs);
router.get("/", getJobs);
router.get("/:id", getJobById);

// ============ PROTECTED ROUTES ============

// Employer routes – now require verified status
router.get("/mine", verifyToken, isEmployer, isVerifiedEmployer, getEmployerJobs);
router.post("/", verifyToken, isEmployer, isVerifiedEmployer, validateJobPosting, validateQualifications, validateRequest, createJob);
router.put("/:id", verifyToken, isEmployer, isVerifiedEmployer, validateJobPosting, validateQualifications, validateRequest, updateJob);
router.delete("/:id", verifyToken, isEmployer, isVerifiedEmployer, deleteJob);

// Job applications - Employer viewing (also verified)
router.get("/:id/applications", verifyToken, isEmployer, isVerifiedEmployer, getApplicationsForJob);

// Resident (Job Seeker) routes
router.get("/applications/me", verifyToken, isResident, getMyApplications);

// Apply to job with cover letter validation
router.post(
  "/:id/apply",
  verifyToken,
  isResident,
  sanitizeRequestBody,
  validateMongoId("id"),
  detectMaliciousPayload,
  validateJobApplication,
  validateRequest,
  upload.single("resume"),
  validateFile,
  cleanupUploadedFiles,
  applyToJob
);

// Update application with cover letter validation
router.put(
  "/applications/:id",
  verifyToken,
  isResident,
  sanitizeRequestBody,
  validateMongoId("id"),
  detectMaliciousPayload,
  validateJobApplication,
  validateRequest,
  upload.single("resume"),
  validateFile,
  cleanupUploadedFiles,
  updateMyApplication
);

// Delete application
router.delete(
  "/applications/:id",
  verifyToken,
  isResident,
  validateMongoId("id"),
  deleteMyApplication
);

module.exports = router;