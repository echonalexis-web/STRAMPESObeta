const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      default: null,
    },
    actorRole: {
      type: String,
      enum: ["resident", "employer", "admin", "system", "anonymous"],
      default: "anonymous",
    },
    action: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    targetUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      default: null,
    },
    targetType: {
      type: String,
      default: "user",
      trim: true,
      maxlength: 80,
    },
    targetId: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
    },
    severity: {
      type: String,
      enum: ["info", "warning", "critical"],
      default: "info",
    },
    ipAddress: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
    },
    userAgent: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ targetUserId: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
