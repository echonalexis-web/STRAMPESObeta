const router = require("express").Router();
const { verifyToken: protect } = require("../middleware/auth");
const {
  likeJob,
  unlikeJob,
  getLikedJobs,
  getJobLikeStatus,
  getJobLikeCount
} = require("../controllers/jobLikeController");

// Like/Unlike endpoints
router.post("/:jobId/like", protect, likeJob);
router.post("/:jobId/unlike", protect, unlikeJob);

// Get endpoints
router.get("/liked", protect, getLikedJobs);
router.get("/:jobId/like-status", protect, getJobLikeStatus);
router.get("/:jobId/like-count", getJobLikeCount);

module.exports = router;
