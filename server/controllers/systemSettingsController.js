const SystemSettings = require("../models/SystemSettings");
const { logAuditEvent } = require("../services/auditService");
const { sendError } = require("../utils/sendError");

exports.getSystemSettings = async (req, res) => {
  try {
    const settings = await SystemSettings.getSingleton();
    res.json({
      autoCloseDays: settings.autoCloseDays,
      appealWindowDays: settings.appealWindowDays,
      requireEmployerVerification: settings.requireEmployerVerification,
      deletedAccountGraceDays: settings.deletedAccountGraceDays ?? 30,
      staffInviteExpiryHours: settings.staffInviteExpiryHours ?? 48,
      staffInviteResendCooldownSeconds: settings.staffInviteResendCooldownSeconds ?? 60,
      updatedAt: settings.updatedAt,
    });
  } catch (error) {
    sendError(res, error, "Could not load system settings");
  }
};

exports.updateSystemSettings = async (req, res) => {
  try {
    const {
      autoCloseDays,
      appealWindowDays,
      requireEmployerVerification,
      deletedAccountGraceDays,
      staffInviteExpiryHours,
      staffInviteResendCooldownSeconds,
    } = req.body || {};

    const $set = {};

    if (staffInviteExpiryHours !== undefined) {
      const hours = Number(staffInviteExpiryHours);
      if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
        return res.status(400).json({ message: "Invite expiry must be between 1 and 168 hours." });
      }
      $set.staffInviteExpiryHours = Math.round(hours);
    }

    if (staffInviteResendCooldownSeconds !== undefined) {
      const seconds = Number(staffInviteResendCooldownSeconds);
      if (!Number.isFinite(seconds) || seconds < 30 || seconds > 3600) {
        return res.status(400).json({ message: "Resend cooldown must be between 30 and 3600 seconds." });
      }
      $set.staffInviteResendCooldownSeconds = Math.round(seconds);
    }

    if (autoCloseDays !== undefined) {
      const days = Number(autoCloseDays);
      if (!Number.isFinite(days) || days < 1 || days > 365) {
        return res.status(400).json({ message: "Auto-close days must be between 1 and 365." });
      }
      $set.autoCloseDays = Math.round(days);
    }

    if (appealWindowDays !== undefined) {
      const days = Number(appealWindowDays);
      if (!Number.isFinite(days) || days < 1 || days > 90) {
        return res.status(400).json({ message: "Appeal window must be between 1 and 90 days." });
      }
      $set.appealWindowDays = Math.round(days);
    }

    if (deletedAccountGraceDays !== undefined) {
      const days = Number(deletedAccountGraceDays);
      if (!Number.isFinite(days) || days < 7 || days > 365) {
        return res.status(400).json({ message: "Deleted-account grace period must be between 7 and 365 days." });
      }
      $set.deletedAccountGraceDays = Math.round(days);
    }

    if (requireEmployerVerification !== undefined) {
      if (typeof requireEmployerVerification !== "boolean") {
        return res.status(400).json({ message: "requireEmployerVerification must be true or false." });
      }
      $set.requireEmployerVerification = requireEmployerVerification;
    }

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ message: "No valid settings fields were provided." });
    }

    $set.updatedBy = req.user.id;

    const settings = await SystemSettings.findOneAndUpdate(
      { singletonKey: "global" },
      { $set },
      { new: true, upsert: true }
    );

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "superadmin",
      action: "superadmin.system_settings.updated",
      targetType: "system",
      targetId: "global",
      severity: "warning",
      metadata: $set,
    });

    res.json({
      message: "System settings saved.",
      autoCloseDays: settings.autoCloseDays,
      appealWindowDays: settings.appealWindowDays,
      requireEmployerVerification: settings.requireEmployerVerification,
      deletedAccountGraceDays: settings.deletedAccountGraceDays ?? 30,
      staffInviteExpiryHours: settings.staffInviteExpiryHours ?? 48,
      staffInviteResendCooldownSeconds: settings.staffInviteResendCooldownSeconds ?? 60,
      updatedAt: settings.updatedAt,
    });
  } catch (error) {
    sendError(res, error, "Could not save system settings");
  }
};
