const router = require("express").Router();
const { verifyToken: protect } = require("../middleware/auth");
const {
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
  getFollowStatus,
  getFollowerCounts
} = require("../controllers/followController");

// Post endpoints
router.post("/:userId/follow", protect, followUser);
router.post("/:userId/unfollow", protect, unfollowUser);

// Get endpoints
router.get("/:userId/followers", protect, getFollowers);
router.get("/:userId/following", protect, getFollowing);
router.get("/:userId/follow-status", protect, getFollowStatus);
router.get("/:userId/counts", getFollowerCounts);

module.exports = router;
