const AuditLog = require("../models/AuditLog");

const getClientIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "";
};

const logAuditEvent = async ({ req, actorId = null, actorRole = "anonymous", action, targetUserId = null, targetType = "user", targetId = "", severity = "info", metadata = {} }) => {
  try {
    if (!action) return;

    await AuditLog.create({
      actorId,
      actorRole,
      action,
      targetUserId,
      targetType,
      targetId,
      severity,
      ipAddress: req ? getClientIp(req) : "",
      userAgent: req?.headers?.["user-agent"] || "",
      metadata,
    });
  } catch (error) {
    // Audit logging failure should not break main request flow.
    console.error("Audit logging failed:", error.message);
  }
};

module.exports = {
  logAuditEvent,
};
