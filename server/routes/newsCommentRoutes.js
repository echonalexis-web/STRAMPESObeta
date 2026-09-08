const router = require("express").Router({ mergeParams: true });
const { listComments, createComment, deleteComment } = require("../controllers/newsCommentController");
const { verifyToken: protect, optionalAuth } = require("../middleware/auth");
const {
  sanitizeRequestBody,
  validateMongoId,
  validateRequest,
} = require("../middleware/validation");

router.get("/", optionalAuth, validateMongoId("newsId"), validateRequest, listComments);
router.post("/", protect, validateMongoId("newsId"), sanitizeRequestBody, validateRequest, createComment);
router.delete(
  "/:commentId",
  protect,
  validateMongoId("newsId"),
  validateMongoId("commentId"),
  validateRequest,
  deleteComment
);

module.exports = router;
