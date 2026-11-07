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
  unsubscribeFromEmailCategory,
} = require("../controllers/notificationController");

// Deliberately public and registered BEFORE router.use(protect) below —
// reached by clicking a link in a notification email, where the reader has
// no session on that device. Its own HMAC signature (see
// utils/emailUnsubscribe.js) is what authorizes the one write it makes.
router.get("/unsubscribe", sanitizeQueryParams, unsubscribeFromEmailCategory);

router.use(protect);

router.get("/", sanitizeQueryParams, getNotifications);
router.get("/unread-count", getUnreadCount);
router.put("/mark-all-read", sanitizeRequestBody, markAllNotificationsRead);
router.put("/:notificationId/read", validateMongoId("notificationId"), sanitizeRequestBody, markNotificationRead);
router.delete("/:notificationId", validateMongoId("notificationId"), deleteNotification);

module.exports = router;
