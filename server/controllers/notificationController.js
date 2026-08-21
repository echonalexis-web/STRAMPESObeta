const Notification = require("../models/Notification");

const getUserId = (req) => req.user._id || req.user.id;

const toPositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

exports.getNotifications = async (req, res) => {
  try {
    const userId = getUserId(req);
    const page = toPositiveNumber(req.query.page, 1);
    const limit = Math.min(toPositiveNumber(req.query.limit, 20), 100);
    const unreadOnly = String(req.query.unreadOnly || "false").toLowerCase() === "true";
    const type = String(req.query.type || "").trim();

    const query = { recipient: userId };
    if (unreadOnly) {
      query.isRead = false;
    }
    if (type) {
      query.type = type;
    }

    const [items, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .populate("actor", "name role")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Notification.countDocuments(query),
      Notification.countDocuments({ recipient: userId, isRead: false }),
    ]);

    return res.json({
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
      unreadCount,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch notifications" });
  }
};

exports.getUnreadCount = async (req, res) => {
  try {
    const userId = getUserId(req);
    const count = await Notification.countDocuments({ recipient: userId, isRead: false });
    return res.json({ count });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch unread count" });
  }
};

exports.markNotificationRead = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { notificationId } = req.params;

    const updated = await Notification.findOneAndUpdate(
      { _id: notificationId, recipient: userId },
      { $set: { isRead: true, readAt: new Date() } },
      { new: true }
    ).populate("actor", "name role");

    if (!updated) {
      return res.status(404).json({ message: "Notification not found" });
    }

    const io = req.app.get("io");
    if (io) {
      io.to(`user:${String(userId)}`).emit("notification:updated", {
        _id: updated._id,
        isRead: updated.isRead,
        readAt: updated.readAt,
      });
    }

    return res.json({ message: "Notification marked as read", notification: updated });
  } catch (error) {
    return res.status(500).json({ message: "Failed to mark notification as read" });
  }
};

exports.markAllNotificationsRead = async (req, res) => {
  try {
    const userId = getUserId(req);

    await Notification.updateMany(
      { recipient: userId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    const io = req.app.get("io");
    if (io) {
      io.to(`user:${String(userId)}`).emit("notification:all-read", {
        userId: String(userId),
      });
    }

    return res.json({ message: "All notifications marked as read" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to mark all notifications as read" });
  }
};

exports.deleteNotification = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { notificationId } = req.params;

    const deleted = await Notification.findOneAndDelete({ _id: notificationId, recipient: userId });
    if (!deleted) {
      return res.status(404).json({ message: "Notification not found" });
    }

    const io = req.app.get("io");
    if (io) {
      io.to(`user:${String(userId)}`).emit("notification:deleted", {
        _id: notificationId,
      });
    }

    return res.json({ message: "Notification deleted" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete notification" });
  }
};
