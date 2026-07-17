const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");

const getUserId = (req) => req.user._id || req.user.id;
const ACTIVE_USER_FILTER = { $ne: false };

const normalizeRole = (role) => {
  const value = String(role || "").toLowerCase();
  if (value === "employee") return "resident";
  return value;
};

const getAllowedSearchRoles = (role) => {
  const normalized = normalizeRole(role);
  if (normalized === "admin") return ["resident", "employee", "employer", "admin"];
  if (normalized === "employer") return ["resident", "employee"];
  if (normalized === "resident") return ["employer"];
  return [];
};

const canMessageTarget = (sourceRole, targetRole) => {
  const source = normalizeRole(sourceRole);
  const target = normalizeRole(targetRole);

  if (source === "admin") return ["resident", "employer", "admin"].includes(target);
  if (source === "resident") return target === "employer";
  if (source === "employer") return target === "resident";
  return false;
};

const ensureConversationBetweenUsers = async (userA, userB) => {
  const existing = await Conversation.findOne({
    participants: { $all: [userA, userB] },
  });

  if (existing) {
    return existing;
  }

  return Conversation.create({ participants: [userA, userB] });
};

exports.ensureConversationBetweenUsers = ensureConversationBetweenUsers;

exports.createConversation = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { participantId } = req.body;

    if (!participantId) {
      return res.status(400).json({ message: "participantId is required" });
    }

    if (String(participantId) === String(userId)) {
      return res.status(400).json({ message: "Cannot create conversation with yourself" });
    }

    const [currentUser, targetUser] = await Promise.all([
      User.findById(userId).select("role isActive"),
      User.findById(participantId).select("role isActive name"),
    ]);

    if (!currentUser || currentUser.isActive === false) {
      return res.status(403).json({ message: "Current account is not allowed to message" });
    }

    if (!targetUser || targetUser.isActive === false) {
      return res.status(404).json({ message: "Target user not found" });
    }

    if (!canMessageTarget(currentUser.role, targetUser.role)) {
      return res.status(403).json({ message: "Messaging this user is not allowed" });
    }

    const conversation = await ensureConversationBetweenUsers(userId, participantId);
    const populated = await Conversation.findById(conversation._id).populate({
      path: "participants",
      select: "name role desiredJobTitle",
    });

    return res.status(201).json(populated);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create conversation" });
  }
};

exports.searchUsers = async (req, res) => {
  try {
    const userId = getUserId(req);
    const query = String(req.query.query || "").trim();
    const role = String(req.user.role || "");

    if (!query || query.length < 2) {
      return res.json([]);
    }

    const allowedRoles = getAllowedSearchRoles(role);
    if (!allowedRoles.length) {
      return res.json([]);
    }

    const candidates = await User.find({
      _id: { $ne: userId },
      isActive: ACTIVE_USER_FILTER,
      $or: [
        { name: { $regex: query, $options: "i" } },
        { email: { $regex: query, $options: "i" } },
        { companyName: { $regex: query, $options: "i" } },
      ],
    })
      .select("name email role desiredJobTitle companyName")
      .sort({ name: 1 })
      .limit(60);

    const users = candidates
      .filter((candidate) => allowedRoles.includes(String(candidate.role || "").toLowerCase()))
      .filter((candidate) => canMessageTarget(role, candidate.role))
      .slice(0, 20);

    return res.json(users);
  } catch (error) {
    return res.status(500).json({ message: "Failed to search users" });
  }
};

exports.getConversations = async (req, res) => {
  try {
    const userId = getUserId(req);

    const conversations = await Conversation.find({ participants: userId })
      .populate({ path: "participants", select: "name role desiredJobTitle" })
      .sort({ lastMessageAt: -1, createdAt: -1 });

    return res.json(conversations);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch conversations" });
  }
};

exports.getMessages = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { conversationId } = req.params;

    const conversation = await Conversation.findById(conversationId).select("participants");
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const isParticipant = conversation.participants.some(
      (participant) => String(participant) === String(userId)
    );

    if (!isParticipant) {
      return res.status(403).json({ message: "Access denied" });
    }

    const messages = await Message.find({ conversationId }).sort({ createdAt: 1 });

    await Message.updateMany(
      {
        conversationId,
        sender: { $ne: userId },
        isRead: false,
      },
      { $set: { isRead: true } }
    );

    return res.json(messages);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch messages" });
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const userId = getUserId(req);
    const conversationId = req.params.conversationId || req.body.conversationId;
    const { content, receiverId } = req.body;

    // Validate required fields
    if (!conversationId || !content || !String(content).trim()) {
      return res.status(400).json({ message: "conversationId and content are required" });
    }

    // Find conversation
    const conversation = await Conversation.findById(conversationId).select("participants");
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    // Check if sender is a participant
    const isParticipant = conversation.participants.some(
      (participant) => String(participant) === String(userId)
    );
    if (!isParticipant) {
      return res.status(403).json({ message: "Access denied" });
    }

    // If receiverId is provided, verify it is the other participant
    if (receiverId) {
      const otherParticipant = conversation.participants.find(
        (participant) => String(participant) !== String(userId)
      );
      if (String(otherParticipant) !== String(receiverId)) {
        return res.status(400).json({ message: "Invalid receiver ID" });
      }
    }

    // Create and save message
    const message = await Message.create({
      conversationId,
      sender: userId,
      content: String(content).trim(),
    });

    // Update conversation's last message
    await Conversation.findByIdAndUpdate(conversationId, {
      $set: {
        lastMessage: message.content,
        lastMessageAt: message.createdAt,
      },
    });

    // Populate sender info for response
    const populatedMessage = await Message.findById(message._id).populate("sender", "name role");

    // Broadcast via Socket.IO to the conversation room
    const io = req.app.get("io");
    if (io) {
      io.to(String(conversationId)).emit("receive_message", {
        ...populatedMessage.toObject(),
        conversationId: conversationId,
      });
    }

    return res.status(201).json(populatedMessage);
  } catch (error) {
    console.error("❌ Send message error:", error);
    return res.status(500).json({ message: "Failed to send message" });
  }
};

exports.deleteConversation = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { conversationId } = req.params;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const isParticipant = conversation.participants.some(
      (participant) => String(participant) === String(userId)
    );

    if (!isParticipant) {
      return res.status(403).json({ message: "Access denied" });
    }

    await Conversation.findByIdAndDelete(conversationId);
    await Message.deleteMany({ conversationId });

    return res.json({ message: "Conversation deleted" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete conversation" });
  }
};

exports.getUnreadCount = async (req, res) => {
  try {
    const userId = getUserId(req);

    const conversations = await Conversation.find({ participants: userId }).select("_id");
    const conversationIds = conversations.map((conversation) => conversation._id);

    if (!conversationIds.length) {
      return res.json({ count: 0 });
    }

    const count = await Message.countDocuments({
      conversationId: { $in: conversationIds },
      sender: { $ne: userId },
      isRead: false,
    });

    return res.json({ count });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch unread count" });
  }
};