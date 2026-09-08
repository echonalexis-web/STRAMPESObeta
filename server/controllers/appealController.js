const mongoose = require("mongoose");
const Appeal = require("../models/Appeal");
const User = require("../models/User");
const Report = require("../models/Report");
const { logAuditEvent } = require("../services/auditService");
const { createNotificationForUser, notifyManyUsers } = require("../services/notificationService");

const getUserId = (req) => req.user._id || req.user.id;

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

// ---------- Suspended user: submit an appeal (appeal-only token) ----------
exports.submitAppeal = async (req, res) => {
  try {
    const userId = getUserId(req);
    const message = String(req.body.message || "").trim();

    if (message.length < 10) {
      return res.status(400).json({ message: "Please describe your appeal in at least 10 characters." });
    }
    if (message.length > 2000) {
      return res.status(400).json({ message: "Appeal is too long (2000 characters max)." });
    }

    const user = await User.findById(userId).select("isActive accountStatus suspensionReason name");
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.isActive !== false) {
      return res.status(400).json({ message: "Your account is active — there is nothing to appeal." });
    }

    // One open appeal at a time.
    const existing = await Appeal.findOne({ user: userId, status: { $in: ["pending", "under_review"] } });
    if (existing) {
      return res.status(409).json({
        message: "You already have an appeal under review.",
        appeal: existing,
      });
    }

    const appeal = await Appeal.create({
      user: userId,
      accountStatus: user.accountStatus === "banned" ? "banned" : "suspended",
      suspensionReason: user.suspensionReason || null,
      message,
    });

    await logAuditEvent({
      req,
      actorId: userId,
      actorRole: "anonymous",
      action: "appeal.submitted",
      targetUserId: userId,
      targetType: "user",
      targetId: String(userId),
      severity: "warning",
      metadata: { appealId: String(appeal._id) },
    });

    try {
      const admins = await User.find({ role: "admin" }).select("_id");
      await notifyManyUsers({
        recipientIds: admins.map((a) => a._id),
        actorId: userId,
        type: "admin_action",
        title: "New suspension appeal",
        message: `${user.name || "A user"} submitted an appeal for review.`,
        relatedEntityType: "user",
        relatedEntityId: userId,
        actionUrl: "/admin/users",
        io: req.app.get("io"),
      });
    } catch {
      /* non-fatal */
    }

    return res.status(201).json({ message: "Appeal submitted. LMD Admin will review it.", appeal });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to submit appeal" });
  }
};

// ---------- Suspended user: read own latest appeal (appeal-only token) ----------
exports.getMyAppeal = async (req, res) => {
  try {
    const userId = getUserId(req);
    const appeal = await Appeal.findOne({ user: userId }).sort({ createdAt: -1 }).lean();
    const user = await User.findById(userId)
      .select("accountStatus suspensionReason suspendedAt isActive")
      .lean();

    return res.json({
      appeal: appeal || null,
      account: user
        ? {
            accountStatus: user.isActive === false ? user.accountStatus || "suspended" : "active",
            suspensionReason: user.suspensionReason || null,
            suspendedAt: user.suspendedAt || null,
          }
        : null,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to load appeal" });
  }
};

// ---------- Admin: list appeals ----------
exports.listAppeals = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status && ["pending", "under_review", "approved", "denied"].includes(status)) {
      filter.status = status;
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

    const [appeals, total, statusCounts, resolvedToday] = await Promise.all([
      Appeal.find(filter)
        .populate({
          path: "user",
          select: "name email role isActive accountStatus createdAt suspendedAt suspendedBy",
          populate: { path: "suspendedBy", select: "name" },
        })
        .populate("reviewedBy", "name")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Appeal.countDocuments(filter),
      Appeal.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
      Appeal.countDocuments({ resolvedAt: { $gte: startOfToday() } }),
    ]);

    // How many reports were filed against each appellant — the context an admin
    // needs to judge an appeal without leaving the queue.
    const userIds = [
      ...new Set(appeals.map((a) => a.user?._id).filter(Boolean).map(String)),
    ];
    const reportMap = {};
    if (userIds.length) {
      const reportAgg = await Report.aggregate([
        { $match: { targetOwner: { $in: userIds.map((id) => new mongoose.Types.ObjectId(id)) } } },
        { $group: { _id: "$targetOwner", n: { $sum: 1 } } },
      ]);
      reportAgg.forEach((row) => {
        reportMap[String(row._id)] = row.n;
      });
    }

    const withContext = appeals.map((a) => ({
      ...a,
      context: {
        suspendedByName: a.user?.suspendedBy?.name || null,
        suspendedAt: a.user?.suspendedAt || null,
        reportsAgainstUser: a.user?._id ? reportMap[String(a.user._id)] || 0 : 0,
      },
    }));

    const counts = { pending: 0, under_review: 0, approved: 0, denied: 0, resolvedToday };
    statusCounts.forEach((row) => {
      if (row._id in counts) counts[row._id] = row.n;
    });
    const pendingCount = counts.pending + counts.under_review;

    return res.json({ appeals: withContext, pendingCount, counts, total, page, limit });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to load appeals" });
  }
};

// ---------- Admin: resolve an appeal ----------
exports.resolveAppeal = async (req, res) => {
  try {
    const { id } = req.params;
    const { decision } = req.body; // "approved" | "denied" | "under_review"
    const adminResponse = String(req.body.adminResponse || "").trim() || null;

    if (!["approved", "denied", "under_review"].includes(decision)) {
      return res.status(400).json({ message: "Invalid decision" });
    }

    const appeal = await Appeal.findById(id);
    if (!appeal) return res.status(404).json({ message: "Appeal not found" });

    appeal.status = decision;
    appeal.adminResponse = adminResponse;
    appeal.reviewedBy = getUserId(req);
    appeal.resolvedAt = ["approved", "denied"].includes(decision) ? new Date() : null;
    await appeal.save();

    // Approving an appeal reactivates the account.
    if (decision === "approved") {
      const user = await User.findById(appeal.user);
      if (user) {
        user.isActive = true;
        user.accountStatus = "active";
        user.suspensionReason = null;
        user.suspendedAt = null;
        user.suspendedBy = null;
        await user.save();
      }
    }

    await logAuditEvent({
      req,
      actorId: getUserId(req),
      actorRole: "admin",
      action: "appeal.resolved",
      targetUserId: appeal.user,
      targetType: "user",
      targetId: String(appeal.user),
      severity: decision === "approved" ? "warning" : "info",
      metadata: { appealId: String(appeal._id), decision },
    });

    try {
      await createNotificationForUser({
        recipientId: appeal.user,
        actorId: getUserId(req),
        type: "admin_action",
        title:
          decision === "approved"
            ? "Your appeal was approved"
            : decision === "denied"
              ? "Your appeal was denied"
              : "Your appeal is under review",
        message:
          decision === "approved"
            ? "LMD Admin approved your appeal. Your account has been restored — you can log in again."
            : decision === "denied"
              ? `LMD Admin reviewed your appeal and it was denied.${adminResponse ? ` Note: ${adminResponse}` : ""}`
              : "LMD Admin is now reviewing your appeal.",
        relatedEntityType: "user",
        relatedEntityId: appeal.user,
        io: req.app.get("io"),
      });
    } catch {
      /* non-fatal */
    }

    return res.json({ message: "Appeal updated", appeal });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to resolve appeal" });
  }
};
