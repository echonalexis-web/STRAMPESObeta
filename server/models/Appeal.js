const mongoose = require("mongoose");

// A suspended / banned user's request for an administrator ("LMD Admin") to
// review their account status. One open appeal per user at a time — the
// controller enforces the dedupe.
const appealSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Snapshot of the account state at submission time, for admin context.
    accountStatus: {
      type: String,
      enum: ["suspended", "banned"],
      required: true,
    },
    suspensionReason: { type: String, default: null },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    status: {
      type: String,
      enum: ["pending", "under_review", "approved", "denied"],
      default: "pending",
      index: true,
    },
    adminResponse: { type: String, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

appealSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("Appeal", appealSchema);
