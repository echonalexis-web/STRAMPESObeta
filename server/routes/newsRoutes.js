const router = require("express").Router();
const {
  listNews,
  getNewsById,
  createNews,
  updateNews,
  deleteNews,
} = require("../controllers/newsController");
const newsCommentRoutes = require("./newsCommentRoutes");
const { verifyToken: protect, isAdmin } = require("../middleware/auth");
const { optionalAuth } = require("../middleware/auth");
const { singleFileUpload, persistUploads, cleanupUploadedFiles } = require("../middleware/upload");
const {
  sanitizeRequestBody,
  sanitizeQueryParams,
  validateMongoId,
  validateAnnouncementPayload,
  validateRequest,
} = require("../middleware/validation");

// Accepts an optional device photo under the "image" field (multipart/form-data),
// then persists it to the configured storage backend (Cloudinary / local).
// Runs before body sanitising so multipart text fields are parsed into req.body.
const uploadNewsImage = [
  (req, res, next) => {
    singleFileUpload("image")(req, res, (err) => {
      if (err) {
        return res.status(400).json({ message: err.message || "Image upload failed" });
      }
      return next();
    });
  },
  persistUploads("news"),
  cleanupUploadedFiles,
];

router.get("/", optionalAuth, sanitizeQueryParams, listNews);
router.get("/:id", optionalAuth, validateMongoId("id"), validateRequest, getNewsById);

router.post(
  "/",
  protect,
  isAdmin,
  uploadNewsImage,
  sanitizeRequestBody,
  validateAnnouncementPayload,
  validateRequest,
  createNews
);

router.put(
  "/:id",
  protect,
  isAdmin,
  validateMongoId("id"),
  uploadNewsImage,
  sanitizeRequestBody,
  validateAnnouncementPayload,
  validateRequest,
  updateNews
);

router.delete("/:id", protect, isAdmin, validateMongoId("id"), validateRequest, deleteNews);

router.use("/:newsId/comments", newsCommentRoutes);

module.exports = router;
