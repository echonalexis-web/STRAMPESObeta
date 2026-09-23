const SystemSettings = require("../models/SystemSettings");
const { logAuditEvent } = require("../services/auditService");

exports.getSystemSettings = async (req, res) => {
  try {
    const settings = await SystemSettings.getSingleton();
    res.json({
      autoCloseDays: settings.autoCloseDays,
      appealWindowDays: settings.appealWindowDays,
      requireEmployerVerification: settings.requireEmployerVerification,
      updatedAt: settings.updatedAt,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Could not load system settings" });
  }
};

exports.updateSystemSettings = async (req, res) => {
  try {
    const { autoCloseDays, appealWindowDays, requireEmployerVerification } = req.body || {};

    const $set = {};

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
      updatedAt: settings.updatedAt,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Could not save system settings" });
  }
};
