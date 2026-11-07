const mongoose = require("mongoose");

// A 90-day tombstone for a username that was just released — either an
// account changed away from it, or a superadmin force-cleared one. While a
// row exists here, utils/username.js's availability check treats that name
// as taken even though no User document holds it anymore. This is what
// stops the "release a trusted name, immediately re-register it as someone
// else" attack described in
// markdowns/NOTIF_EMAIL_ID_OCR_AND_ACCOUNT_RECOVERY_PLAN.md §3.3 — without
// it, a sparse unique index alone would let that happen the instant the old
// document stopped holding the value.
const reservedUsernameSchema = new mongoose.Schema(
  {
    // Stored already-normalized (lowercase, NFKC) — the same form
    // utils/username.js compares against, and the same collation-backed
    // uniqueness every write path already relies on for User.username.
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    releasedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reason: { type: String, enum: ["changed", "released_by_admin"], default: "changed" },
  },
  { timestamps: true }
);

// TTL: a tombstone expires 90 days after it was written, after which the
// name becomes claimable again.
reservedUsernameSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model("ReservedUsername", reservedUsernameSchema);
