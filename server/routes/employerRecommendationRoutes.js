const express = require("express");
const router = express.Router();
const { getRankedApplicants } = require("../controllers/employerRecommendationController");
const { verifyToken: protect, isEmployer, isVerifiedEmployer } = require("../middleware/auth");
const { validateMongoId, sanitizeQueryParams } = require("../middleware/validation");

// All routes require employer authentication
router.use(protect, isEmployer, isVerifiedEmployer);

// GET /api/employer-recommendations/jobs/:jobId/applicants/ranked
router.get(
  "/jobs/:jobId/applicants/ranked",
  validateMongoId("jobId"),
  sanitizeQueryParams,
  getRankedApplicants
);

module.exports = router;