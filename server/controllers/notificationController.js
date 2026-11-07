const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const User = require("../models/User");
const { logAuditEvent } = require("../services/auditService");
const { verifyUnsubscribeSignature } = require("../utils/emailUnsubscribe");
const { clientBaseUrl } = require("../utils/clientUrl");

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

    await logAuditEvent({
      req,
      actorId: userId,
      actorRole: req.user.role,
      action: "notification.read",
      targetType: "notification",
      targetId: String(notificationId),
      severity: "info",
    });

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

    await logAuditEvent({
      req,
      actorId: userId,
      actorRole: req.user.role,
      action: "notification.marked_all_read",
      targetType: "user",
      targetId: String(userId),
      severity: "info",
    });

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

    await logAuditEvent({
      req,
      actorId: userId,
      actorRole: req.user.role,
      action: "notification.deleted",
      targetType: "notification",
      targetId: String(notificationId),
      severity: "info",
    });

    return res.json({ message: "Notification deleted" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete notification" });
  }
};

// ---------- Unsubscribe from one notification email category ----------
// Reached by clicking the link in a notification email's footer — no
// session, by design: whoever is reading that inbox should be able to opt
// out without having to sign in on that device first. The HMAC signature
// (verifyUnsubscribeSignature) is what stops a guessed userId+category pair
// from flipping someone else's preference; see utils/emailUnsubscribe.js.
const EMAIL_PREFERENCE_CATEGORY_LABELS = {
  notifyAccountRecovery: "account recovery requests",
  notifyMessages: "new message emails",
  notifyJobMatch: "job match emails",
  notifyApplicationUpdate: "application update emails",
  notifyNewApplicant: "new applicant emails",
  notifyJobExpiring: "job expiring emails",
  notifyVerificationRequest: "verification request emails",
  notifyUserReport: "user report emails",
  notifySpesSubmission: "SPES submission emails",
  notifySystem: "system notice emails",
  notifyAdminAction: "account & moderation update emails",
  notifyNews: "announcement emails",
  notifyFollow: "new follower emails",
  notifyLikes: "like notification emails",
};

const renderUnsubscribePage = ({ heading, message, isError = false }) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>STRAM PESO — Email preferences</title>
</head>
<body style="margin:0;background:#f0fdf4;padding:24px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;">
  <div style="max-width:420px;width:100%;background:#ffffff;border:1px solid #dcfce7;border-radius:16px;padding:28px;text-align:center;box-sizing:border-box;">
    <div style="font-weight:800;font-size:16px;color:${isError ? "#dc2626" : "#16a34a"};letter-spacing:.02em;margin-bottom:12px;">STRAM PESO</div>
    <h1 style="margin:0 0 12px;font-size:18px;color:#0f172a;">${heading}</h1>
    <p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:1.6;">${message}</p>
    ${
      isError
        ? ""
        : `<a href="${clientBaseUrl()}/settings" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:10px;font-weight:700;font-size:14px;">Manage notification settings</a>`
    }
  </div>
</body>
</html>`;

exports.unsubscribeFromEmailCategory = async (req, res) => {
  const userId = String(req.query.u || "").trim();
  const category = String(req.query.c || "").trim();
  const signature = String(req.query.s || "").trim();

  const isKnownCategory = Object.prototype.hasOwnProperty.call(EMAIL_PREFERENCE_CATEGORY_LABELS, category);
  const isValidId = mongoose.Types.ObjectId.isValid(userId);

  if (!isValidId || !isKnownCategory || !verifyUnsubscribeSignature({ userId, category, signature })) {
    return res.status(400).send(
      renderUnsubscribePage({
        heading: "This link is invalid or has expired",
        message: "Please sign in and open Settings to manage your notification preferences instead.",
        isError: true,
      })
    );
  }

  try {
    await User.updateOne({ _id: userId }, { $set: { [`emailNotificationPreferences.${category}`]: false } });
  } catch (error) {
    return res.status(500).send(
      renderUnsubscribePage({
        heading: "Something went wrong",
        message: "We couldn't update your email preferences just now. Please try again from Settings.",
        isError: true,
      })
    );
  }

  return res.send(
    renderUnsubscribePage({
      heading: "You're unsubscribed",
      message: `You won't get ${EMAIL_PREFERENCE_CATEGORY_LABELS[category]} by email anymore. You can turn this back on anytime from Settings.`,
    })
  );
};
