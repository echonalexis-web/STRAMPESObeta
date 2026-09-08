const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");
const { notifyNewMessage } = require("../services/notificationService");
const presenceService = require("../services/presenceService");

const getUserId = (req) => req.user._id || req.user.id;
const ACTIVE_USER_FILTER = { $ne: false };

const getEntityId = (value) => {
  if (!value) return null;
  if (typeof value === "object") {
    return value._id || value.id || null;
  }
  return value;
};

const getDistinctParticipantIds = (participants = []) => {
  const ids = participants
    .map((participant) => getEntityId(participant))
    .filter(Boolean)
    .map((participantId) => String(participantId));

  return Array.from(new Set(ids));
};

const hasOtherParticipant = (conversation, userId) => {
  const participantIds = getDistinctParticipantIds(conversation?.participants);
  return participantIds.some((participantId) => participantId !== String(userId));
};

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
    $expr: { $eq: [{ $size: "$participants" }, 2] },
  });

  if (existing) {
    return existing;
  }

  return Conversation.create({ participants: [userA, userB] });
};

exports.ensureConversationBetweenUsers = ensureConversationBetweenUsers;

// Programmatic message from one user to another, used by review flows
// (employer verification, SPES). Mirrors sendMessage's side effects:
// conversation preview update, socket push, and a collapsed notification.
const postSystemMessage = async ({ fromUserId, toUserId, content, io = null }) => {
  if (!fromUserId || !toUserId || !String(content || "").trim()) return null;
  if (String(fromUserId) === String(toUserId)) return null;

  const conversation = await ensureConversationBetweenUsers(fromUserId, toUserId);
  const message = await Message.create({
    conversationId: conversation._id,
    sender: fromUserId,
    content: String(content).trim(),
  });

  await Conversation.findByIdAndUpdate(conversation._id, {
    $set: { lastMessage: message.content, lastMessageAt: message.createdAt },
  });

  const populated = await Message.findById(message._id).populate("sender", "name role");

  if (io) {
    io.to(`user:${String(toUserId)}`).emit("receive_message", {
      ...populated.toObject(),
      conversationId: String(conversation._id),
    });
  }

  try {
    if (!presenceService.isViewingConversation(toUserId, conversation._id)) {
      await notifyNewMessage({
        recipientId: toUserId,
        actorId: fromUserId,
        actorName: populated.sender?.name || "STRAM PESO",
        conversationId: conversation._id,
        messagePreview: String(content).trim(),
        io,
      });
    }
  } catch (_) {
    // notification failure must not break the caller's flow
  }

  return conversation;
};

exports.postSystemMessage = postSystemMessage;

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
      select: "name role desiredJobTitle profileImage",
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
      .select("name email role desiredJobTitle companyName profileImage")
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
      .populate({
        path: "participants",
        select: "name role desiredJobTitle isActive profileImage",
        // Keep a null slot for participants whose account was deleted so the
        // conversation is still returned (shown as "unavailable" on the client)
        // instead of silently vanishing.
        options: { retainNullValues: true },
      })
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .lean();

    const seen = new Set();
    const result = [];

    conversations.forEach((conversation) => {
      const participants = Array.isArray(conversation.participants)
        ? conversation.participants
        : [];

      if (participants.length < 2) return;

      const includesSelf = participants.some(
        (participant) => participant && String(participant._id) === String(userId)
      );
      if (!includesSelf) return;

      // Replace deleted (null) or deactivated participants with a lightweight
      // placeholder carrying an `unavailable` flag the client can render.
      const normalizedParticipants = participants.map((participant, index) => {
        if (!participant) {
          return {
            _id: `unavailable-${conversation._id}-${index}`,
            name: null,
            unavailable: true,
            unavailableReason: "deleted",
          };
        }
        if (participant.isActive === false) {
          return { ...participant, unavailable: true, unavailableReason: "suspended" };
        }
        return participant;
      });

      const key = normalizedParticipants
        .map((participant) => String(participant._id))
        .sort()
        .join(":");
      if (seen.has(key)) return;
      seen.add(key);

      result.push({ ...conversation, participants: normalizedParticipants });
    });

    return res.json(result);
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

    // Populate sender consistently with the create/broadcast paths so the
    // client never has to guess between a raw id and a populated object.
    const messages = await Message.find({ conversationId })
      .sort({ createdAt: 1 })
      .populate("sender", "name role");

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

// ===== FIXED: sendMessage with broadcast only to other participants =====
exports.sendMessage = async (req, res) => {
  try {
    const userId = getUserId(req);
    const conversationId = req.params.conversationId || req.body.conversationId;
    const { content } = req.body;

    if (!conversationId || !content || !String(content).trim()) {
      return res.status(400).json({ message: "conversationId and content are required" });
    }

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

    const otherParticipant = conversation.participants.find(
      (participant) => String(participant) !== String(userId)
    );

    if (!otherParticipant) {
      return res.status(400).json({ message: "Conversation has no valid receiver" });
    }

    // Block sending when the other account has been deleted or deactivated.
    const otherUser = await User.findById(otherParticipant).select("isActive");
    if (!otherUser || otherUser.isActive === false) {
      return res.status(403).json({ message: "This user is unavailable" });
    }

    const message = await Message.create({
      conversationId,
      sender: userId,
      content: String(content).trim(),
    });

    await Conversation.findByIdAndUpdate(conversationId, {
      $set: {
        lastMessage: message.content,
        lastMessageAt: message.createdAt,
      },
    });

    const populatedMessage = await Message.findById(message._id).populate("sender", "name role");

    // Broadcast only to the other participant (not the sender)
    const io = req.app.get("io");
    if (io && otherParticipant) {
      io.to(`user:${String(otherParticipant)}`).emit("receive_message", {
        ...populatedMessage.toObject(),
        conversationId: conversationId,
      });
    }

    // Notify the other participant, unless they already have this
    // conversation open (they'll see the message live in the thread).
    if (otherParticipant && !presenceService.isViewingConversation(otherParticipant, conversationId)) {
      try {
        await notifyNewMessage({
          recipientId: otherParticipant,
          actorId: userId,
          actorName: populatedMessage.sender?.name || "Someone",
          conversationId,
          messagePreview: String(content).trim(),
          io,
        });
      } catch (notifErr) {
        console.warn("⚠️ Failed to create notification for message:", notifErr.message);
      }
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