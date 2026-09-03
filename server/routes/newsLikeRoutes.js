const router = require("express").Router();
const { verifyToken: protect } = require("../middleware/auth");
const { validateMongoId, validateRequest } = require("../middleware/validation");
const {
  likeNews,
  unlikeNews,
  getLikedNews,
  getNewsLikeStatus,
} = require("../controllers/newsLikeController");

// Current user's liked announcements ("My Likes")
router.get("/liked", protect, getLikedNews);

// Like / unlike
router.post("/:newsId/like", protect, validateMongoId("newsId"), validateRequest, likeNews);
router.post("/:newsId/unlike", protect, validateMongoId("newsId"), validateRequest, unlikeNews);

// Like status + count for one announcement
router.get("/:newsId/like-status", protect, validateMongoId("newsId"), validateRequest, getNewsLikeStatus);

module.exports = router;
