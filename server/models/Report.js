const mongoose = require("mongoose");

// A user-submitted report of a policy violation. With preventive automation
// deferred, this is the primary abuse-prevention channel and feeds the admin
// moderation queue under User Management.
const REPORT_TARGET_TYPES = [
  "user",
  "job",
  "news_comment",
  "news_post",
  "message",
  "avatar",
];

const REPORT_CATEGORIES = [
  "illegal_job",
  "scam_or_fee",
  "discrimination",
  "inappropriate_avatar",
  "harassment",
  "hate_speech",
  "spam",
  "impersonation",
  "other",
];

const REPORT_STATUSES = ["open", "under_review", "action_taken", "dismissed"];

const REPORT_ACTIONS = [
  "none",
  "content_removed",
  "warning",
  "suspension",
  "ban",
];

const reportSchema = new mongoose.Schema(
  {
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    targetType: { type: String, enum: REPORT_TARGET_TYPES, required: true },
    // Not a ref because it can point at several collections; resolved manually.
    targetId: { type: String, required: true },
    // The user who owns / authored the reported thing, denormalized so the
    // admin queue can triage and act (warn / suspend) without extra lookups.
    targetOwner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    category: { type: String, enum: REPORT_CATEGORIES, required: true },
    details: { type: String, default: "", trim: true, maxlength: 1000 },
    status: { type: String, enum: REPORT_STATUSES, default: "open", index: true },
    resolution: {
      action: { type: String, enum: REPORT_ACTIONS, default: "none" },
      note: { type: String, default: null },
      handledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      resolvedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

// Fast lookup for the "does this reporter already have an open report on this
// target?" dedupe check (enforced in the controller, not by a unique index —
// partial-index filter expressions are too limited to express "open OR
// under_review" portably).
reportSchema.index({ reporter: 1, targetType: 1, targetId: 1, status: 1 });
reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ targetType: 1, targetId: 1 });

module.exports = mongoose.model("Report", reportSchema);
module.exports.REPORT_TARGET_TYPES = REPORT_TARGET_TYPES;
module.exports.REPORT_CATEGORIES = REPORT_CATEGORIES;
module.exports.REPORT_STATUSES = REPORT_STATUSES;
module.exports.REPORT_ACTIONS = REPORT_ACTIONS;
