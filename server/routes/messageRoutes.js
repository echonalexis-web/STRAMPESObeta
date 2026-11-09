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
const { getShareState, createShare, revokeShare } = require("../controllers/contactShareController");
const { verifyToken: protect } = require("../middleware/auth");
const { conversationBudget } = require("../middleware/budgets");
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
router.post("/conversations", conversationBudget, sanitizeRequestBody, detectMaliciousPayload, createConversation);
router.delete("/conversations/:conversationId", validateMongoId("conversationId"), deleteConversation);

// "Share my contact details": a jobseeker's explicit, revocable share with the employer in this conversation.
router.get("/conversations/:conversationId/share-contact", validateMongoId("conversationId"), getShareState);
router.post("/conversations/:conversationId/share-contact", validateMongoId("conversationId"), sanitizeRequestBody, detectMaliciousPayload, createShare);
router.delete("/conversations/:conversationId/share-contact", validateMongoId("conversationId"), revokeShare);

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