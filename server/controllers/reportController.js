const mongoose = require("mongoose");
const Report = require("../models/Report");
const User = require("../models/User");
const JobVacancy = require("../models/JobVacancy");
const NewsComment = require("../models/NewsComment");
const Announcement = require("../models/Announcement");
const AuditLog = require("../models/AuditLog");
const { logAuditEvent } = require("../services/auditService");
const { createNotificationForUser, notifyManyUsers } = require("../services/notificationService");
const { forceLogout } = require("../services/sessionService");

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const {
  REPORT_TARGET_TYPES,
  REPORT_CATEGORIES,
  REPORT_STATUSES,
  REPORT_ACTIONS,
} = Report;

const getUserId = (req) => req.user._id || req.user.id;

// Resolve the owning user of whatever was reported, so the admin queue can act
// on the person (warn / suspend) directly from the report.
const resolveTargetOwner = async (targetType, targetId) => {
  try {
    if (targetType === "user" || targetType === "avatar") {
      const user = await User.findById(targetId).select("_id");
      return user?._id || null;
    }
    if (targetType === "job") {
      const job = await JobVacancy.findById(targetId).select("employer");
      return job?.employer || null;
    }
    if (targetType === "news_comment") {
      const comment = await NewsComment.findById(targetId).select("author");
      return comment?.author || null;
    }
    if (targetType === "news_post") {
      const post = await Announcement.findById(targetId).select("author");
      return post?.author || null;
    }
    // message / other — owner is supplied by the client if known
    return null;
  } catch {
    return null;
  }
};

// ---------- Create a report (any authenticated user) ----------
exports.createReport = async (req, res) => {
  try {
    const reporterId = getUserId(req);
    const { targetType, targetId, category } = req.body;
    const details = String(req.body.details || "").trim().slice(0, 1000);

    if (!REPORT_TARGET_TYPES.includes(targetType)) {
      return res.status(400).json({ message: "Invalid report target type" });
    }
    if (!targetId) {
      return res.status(400).json({ message: "targetId is required" });
    }
    if (!REPORT_CATEGORIES.includes(category)) {
      return res.status(400).json({ message: "Invalid report category" });
    }

    let targetOwner = await resolveTargetOwner(targetType, targetId);
    if (!targetOwner && req.body.targetOwner) {
      targetOwner = req.body.targetOwner;
    }

    // Can't report yourself.
    if (targetOwner && String(targetOwner) === String(reporterId)) {
      return res.status(400).json({ message: "You cannot report your own content" });
    }

    // One open report per reporter + target.
    const existing = await Report.findOne({
      reporter: reporterId,
      targetType,
      targetId: String(targetId),
      status: { $in: ["open", "under_review"] },
    });
    if (existing) {
      return res.status(409).json({
        message: "You already have an open report for this. Our team is reviewing it.",
      });
    }

    const report = await Report.create({
      reporter: reporterId,
      targetType,
      targetId: String(targetId),
      targetOwner: targetOwner || null,
      category,
      details,
    });

    await logAuditEvent({
      req,
      actorId: reporterId,
      actorRole: req.user.role,
      action: "report.submitted",
      targetType: "user",
      targetId: String(targetOwner || targetId),
      severity: "warning",
      metadata: { reportId: String(report._id), targetType, category },
    });

    // Alert superadmins — moderation is their surface now.
    try {
      const admins = await User.find({ role: "superadmin" }).select("_id");
      await notifyManyUsers({
        recipientIds: admins.map((a) => a._id),
        actorId: reporterId,
        type: "admin_action",
        title: "New user report",
        message: `A ${category.replace(/_/g, " ")} report was filed on a ${targetType.replace(/_/g, " ")}.`,
        relatedEntityType: "user",
        relatedEntityId: targetOwner || reporterId,
        actionUrl: "/admin/users/moderation",
        io: req.app.get("io"),
        preferenceKey: "notifyUserReport",
      });
    } catch {
      /* non-fatal */
    }

    return res.status(201).json({ message: "Report submitted. Thank you for helping keep STRAM PESO safe.", report });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to submit report" });
  }
};

// ---------- Admin: list reports ----------
exports.listReports = async (req, res) => {
  try {
    const { status, category, targetType } = req.query;
    const filter = {};
    if (status && REPORT_STATUSES.includes(status)) filter.status = status;
    if (category && REPORT_CATEGORIES.includes(category)) filter.category = category;
    if (targetType && REPORT_TARGET_TYPES.includes(targetType)) filter.targetType = targetType;

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

    const [reports, total, statusCounts, resolvedToday] = await Promise.all([
      Report.find(filter)
        .populate("reporter", "name email role")
        .populate("targetOwner", "name email role isActive accountStatus createdAt suspendedAt")
        .populate("resolution.handledBy", "name")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Report.countDocuments(filter),
      Report.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
      Report.countDocuments({ "resolution.resolvedAt": { $gte: startOfToday() } }),
    ]);

    // Per-reported-user context so admins can triage a row without opening it:
    // how many other reports target this person, and how many prior enforcement
    // actions (admin suspensions/bans, report-driven suspensions/bans) they carry.
    const ownerIds = [
      ...new Set(reports.map((r) => r.targetOwner?._id).filter(Boolean).map(String)),
    ];
    const ownerContext = {};
    if (ownerIds.length) {
      const objIds = ownerIds.map((id) => new mongoose.Types.ObjectId(id));
      const [reportAgg, enforcementAgg] = await Promise.all([
        Report.aggregate([
          { $match: { targetOwner: { $in: objIds } } },
          {
            $group: {
              _id: "$targetOwner",
              total: { $sum: 1 },
              open: {
                $sum: { $cond: [{ $in: ["$status", ["open", "under_review"]] }, 1, 0] },
              },
            },
          },
        ]),
        AuditLog.aggregate([
          {
            $match: {
              $or: [
                { targetUserId: { $in: objIds }, action: "admin.user.deactivated" },
                {
                  targetId: { $in: ownerIds },
                  action: "report.resolved",
                  "metadata.action": { $in: ["suspension", "ban"] },
                },
              ],
            },
          },
          { $group: { _id: { $ifNull: ["$targetUserId", "$targetId"] }, n: { $sum: 1 } } },
        ]),
      ]);
      reportAgg.forEach((row) => {
        const key = String(row._id);
        ownerContext[key] = { ...ownerContext[key], reportTotal: row.total, reportOpen: row.open };
      });
      enforcementAgg.forEach((row) => {
        const key = String(row._id);
        const prev = ownerContext[key]?.enforcementActions || 0;
        ownerContext[key] = { ...ownerContext[key], enforcementActions: prev + row.n };
      });
    }

    const withContext = reports.map((r) => {
      const key = r.targetOwner?._id ? String(r.targetOwner._id) : null;
      const ctx = (key && ownerContext[key]) || {};
      return {
        ...r,
        ownerContext: {
          reportTotal: ctx.reportTotal || 0,
          reportOpen: ctx.reportOpen || 0,
          enforcementActions: ctx.enforcementActions || 0,
        },
      };
    });

    const counts = { open: 0, under_review: 0, action_taken: 0, dismissed: 0, resolvedToday };
    statusCounts.forEach((row) => {
      if (row._id in counts) counts[row._id] = row.n;
    });
    const openCount = counts.open + counts.under_review;

    return res.json({ reports: withContext, total, openCount, counts, page, limit });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to load reports" });
  }
};

// ---------- Admin: resolve a report ----------
exports.resolveReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, action, note } = req.body;

    if (!REPORT_STATUSES.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    const resolutionAction = REPORT_ACTIONS.includes(action) ? action : "none";

    const report = await Report.findById(id);
    if (!report) return res.status(404).json({ message: "Report not found" });

    report.status = status;
    report.resolution = {
      action: resolutionAction,
      note: String(note || "").trim() || null,
      handledBy: getUserId(req),
      resolvedAt: ["action_taken", "dismissed"].includes(status) ? new Date() : null,
    };
    await report.save();

    // Optionally cascade into a suspension so the moderation queue can act in
    // one step. (Deletion of content is left to the existing per-resource
    // admin tools.)
    if (resolutionAction === "suspension" || resolutionAction === "ban") {
      if (report.targetOwner && String(report.targetOwner) !== String(getUserId(req))) {
        const target = await User.findById(report.targetOwner);
        if (target && target.isActive !== false) {
          target.isActive = false;
          target.accountStatus = resolutionAction === "ban" ? "banned" : "suspended";
          target.suspensionReason = report.resolution.note || `Report: ${report.category}`;
          target.suspendedAt = new Date();
          target.suspendedBy = getUserId(req);
          await target.save();

          forceLogout(req.app.get("io"), target._id, {
            code: "ACCOUNT_SUSPENDED",
            message:
              resolutionAction === "ban"
                ? "This account has been banned following a report review."
                : "This account has been suspended following a report review.",
            accountStatus: target.accountStatus,
            suspensionReason: target.suspensionReason,
            suspendedAt: target.suspendedAt,
          });

          await createNotificationForUser({
            recipientId: target._id,
            actorId: getUserId(req),
            type: "admin_action",
            title: resolutionAction === "ban" ? "Your account was banned" : "Your account was suspended",
            message: `Following a review of a report, your account was ${
              resolutionAction === "ban" ? "banned" : "suspended"
            }. You can appeal to LMD Admin from the login screen.`,
            relatedEntityType: "user",
            relatedEntityId: target._id,
            io: req.app.get("io"),
          });
        }
      }
    }

    await logAuditEvent({
      req,
      actorId: getUserId(req),
      actorRole: req.user.role,
      action: "report.resolved",
      targetType: "user",
      targetId: String(report.targetOwner || report.targetId),
      severity: resolutionAction === "none" ? "info" : "critical",
      metadata: { reportId: String(report._id), status, action: resolutionAction },
    });

    // Let the reporter know their report was actioned.
    try {
      await createNotificationForUser({
        recipientId: report.reporter,
        actorId: getUserId(req),
        type: "admin_action",
        title: "Update on your report",
        message:
          status === "dismissed"
            ? "After review, no action was taken on the content you reported."
            : "Thanks for your report — our team has reviewed it and taken action.",
        relatedEntityType: "system",
        relatedEntityId: report._id,
        io: req.app.get("io"),
      });
    } catch {
      /* non-fatal */
    }

    const populated = await Report.findById(report._id)
      .populate("reporter", "name email role")
      .populate("targetOwner", "name email role isActive accountStatus")
      .populate("resolution.handledBy", "name")
      .lean();

    return res.json({ message: "Report updated", report: populated });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to resolve report" });
  }
};
