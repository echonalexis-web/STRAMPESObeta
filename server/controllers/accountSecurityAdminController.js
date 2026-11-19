// Admin operations for username-only accounts (phase 5b). Counts only: no
// emails, no dates of birth, no usernames in the summary.

const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const loginLock = require("../services/loginLockService");
const { logAuditEvent } = require("../services/auditService");
const { sendError } = require("../utils/sendError");

const JOBSEEKER_ROLES = ["jobseeker", "employee", "resident"];
const DAY_MS = 24 * 60 * 60 * 1000;
const IDLE_DAYS = 90;

// GET /admin/accounts/security-summary
exports.getSecuritySummary = async (req, res) => {
  try {
    const now = Date.now();
    const idleBefore = new Date(now - IDLE_DAYS * DAY_MS);
    // Soft-deleted (and purged) accounts are not counted: purged ones have no
    // email left and would otherwise inflate the email-less total.
    const emailLess = { role: { $in: JOBSEEKER_ROLES }, email: { $exists: false }, deletedAt: null };

    const [emailLessCount, idleEmailLessCount, locksLast24h, locksLast7d, lockedNow] = await Promise.all([
      User.countDocuments(emailLess),
      User.countDocuments({
        ...emailLess,
        $or: [
          { lastLoginAt: { $lt: idleBefore } },
          { lastLoginAt: null, createdAt: { $lt: idleBefore } },
        ],
      }),
      AuditLog.countDocuments({ action: "auth.account.locked", createdAt: { $gte: new Date(now - DAY_MS) } }),
      AuditLog.countDocuments({ action: "auth.account.locked", createdAt: { $gte: new Date(now - 7 * DAY_MS) } }),
      User.countDocuments({ "loginLock.lockedUntil": { $gt: new Date(now) }, deletedAt: null }),
    ]);

    res.json({
      emailLessCount,
      idleEmailLessCount,
      idleDays: IDLE_DAYS,
      locksLast24h,
      locksLast7d,
      lockedNow,
    });
  } catch (error) {
    sendError(res, error);
  }
};

// PUT /admin/users/:id/unlock-login  { reason }
exports.unlockLogin = async (req, res) => {
  try {
    const reason = String(req.body.reason || "").trim().slice(0, 200);
    if (reason.length < 5) {
      return res.status(400).json({ code: "REASON_REQUIRED", message: "Give a short reason (at least 5 characters)." });
    }

    const target = await User.findById(req.params.id).select("role");
    if (!target || !JOBSEEKER_ROLES.includes(target.role)) {
      return res.status(404).json({ message: "Account not found" });
    }

    const hadLock = await loginLock.unlock(target._id);

    await logAuditEvent({
      req,
      actorId: req.user._id || req.user.id,
      actorRole: req.user.role,
      action: "auth.account.unlocked",
      targetUserId: target._id,
      targetType: "user",
      targetId: String(target._id),
      severity: "warning",
      metadata: { reason, hadLock },
    });

    res.json({ unlocked: hadLock });
  } catch (error) {
    sendError(res, error);
  }
};
