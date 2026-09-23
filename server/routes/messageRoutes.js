const router = require("express").Router();
const {
  createConversation,
  getConversations,
  getMessages,
  sendMessage,
  unsendMessage,
  deleteConversation,
  getUnreadCount,
  searchUsers,
} = require("../controllers/messageController");
const { verifyToken: protect } = require("../middleware/auth");
const {
  validateMessage,
  validateRequest,
  sanitizeRequestBody,
  sanitizeQueryParams,
  validateMongoId
} = require("../middleware/validation");
const { detectMaliciousPayload } = require("../middleware/security");

// All message routes require authentication
router.use(protect);

// Search users
router.get("/users/search", sanitizeQueryParams, searchUsers);

// Conversations
router.get("/conversations", sanitizeQueryParams, getConversations);
router.post("/conversations", sanitizeRequestBody, detectMaliciousPayload, createConversation);
router.delete("/conversations/:conversationId", validateMongoId("conversationId"), deleteConversation);

// Messages
router.get("/conversations/:conversationId/messages", validateMongoId("conversationId"), sanitizeQueryParams, getMessages);
router.post(
  "/conversations/:conversationId/messages",
  validateMongoId("conversationId"),
  sanitizeRequestBody,
  detectMaliciousPayload,
  validateMessage,
  validateRequest,
  sendMessage
);
router.patch("/:messageId/unsend", validateMongoId("messageId"), unsendMessage);

// Unread count
router.get("/unread-count", getUnreadCount);

module.exports = router;