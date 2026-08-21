const router = require("express").Router();
const { verifyToken: protect } = require("../middleware/auth");
const {
  sanitizeQueryParams,
  sanitizeRequestBody,
  validateMongoId,
} = require("../middleware/validation");
const {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
} = require("../controllers/notificationController");

router.use(protect);

router.get("/", sanitizeQueryParams, getNotifications);
router.get("/unread-count", getUnreadCount);
router.put("/mark-all-read", sanitizeRequestBody, markAllNotificationsRead);
router.put("/:notificationId/read", validateMongoId("notificationId"), sanitizeRequestBody, markNotificationRead);
router.delete("/:notificationId", validateMongoId("notificationId"), deleteNotification);

module.exports = router;
