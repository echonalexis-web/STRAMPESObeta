const mongoose = require("mongoose");

const { Schema } = mongoose;

// A queued notification email, drained in the background by
// services/emailOutboxService.js. Kept as its own collection (rather than
// sending inline from notificationService) for two reasons: (1) a single
// bulk event (e.g. an announcement) can fan out to far more recipients than
// Gmail's SMTP daily cap allows in one run, so sends must be spread over
// time; (2) collapsing a burst of "new message" notifications into one
// email per conversation per hour (see `dedupeKey` below) needs somewhere
// to hold the in-progress digest between messages.
const emailOutboxSchema = new Schema(
  {
    recipient: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // A snapshot of the address at queue time, so a later email change on
    // the account can't retarget an email already waiting to go out.
    toEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    // The in-app Notification this email mirrors, if any (null for
    // transactional mail that never goes through notificationService).
    notification: {
      type: Schema.Types.ObjectId,
      ref: "Notification",
      default: null,
    },
    // The User.emailNotificationPreferences key this email is gated by
    // (e.g. "notifyMessages"), or "" when it isn't subject to a per-category
    // toggle at all.
    category: {
      type: String,
      default: "",
      trim: true,
    },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    heading: { type: String, required: true, trim: true, maxlength: 200 },
    paragraphs: { type: [String], default: [] },
    buttonUrl: { type: String, default: "" },
    buttonLabel: { type: String, default: "" },
    footnote: { type: String, default: "" },
    status: {
      type: String,
      enum: ["queued", "sending", "sent", "failed", "suppressed"],
      default: "queued",
      index: true,
    },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: "" },
    // When this row becomes eligible to send. Set in the future to collapse
    // a burst of events into one email (see `dedupeKey`), or by the retry
    // backoff after a failed send attempt.
    scheduledAt: { type: Date, default: Date.now, index: true },
    sentAt: { type: Date, default: null },
    // Set once this row reaches a terminal state (sent/failed/suppressed) —
    // separate from sentAt (which only "sent" sets) so the TTL index below
    // can clean up every terminal state, not only successful sends. Left
    // unset (not merely null) while the row is still queued/sending/retrying,
    // so the partial TTL index can use `$exists` to tell the two apart.
    resolvedAt: { type: Date },
    // Lets a burst of the same kind of event for the same recipient collapse
    // into one row instead of one email per event — e.g.
    // "msg:<conversationId>:<recipientId>:<YYYY-MM-DD-HH>" for new-message
    // notifications. Unique+sparse, and DELIBERATELY NO DEFAULT: a sparse
    // index only exempts a document where the field is genuinely ABSENT, not
    // one where it's present with value `null` — a `default: null` here
    // would make Mongoose write `null` into every row that doesn't dedupe,
    // and the unique index would then allow only the very first such row
    // ever created, silently failing every one after it (E11000 on
    // `dedupeKey: null`). Omitting the default leaves the field genuinely
    // unset when no dedupeKey is given, which IS what the sparse index skips.
    dedupeKey: { type: String },
  },
  { timestamps: true }
);

emailOutboxSchema.index({ status: 1, scheduledAt: 1 });
emailOutboxSchema.index({ recipient: 1, createdAt: -1 });
emailOutboxSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });
// Mirrors Notification.js's own TTL pattern: terminal rows (sent, failed, or
// suppressed) age out 30 days after they're resolved; anything still queued
// or retrying has no `resolvedAt` yet and is therefore never touched by this.
emailOutboxSchema.index(
  { resolvedAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60, partialFilterExpression: { resolvedAt: { $exists: true } } }
);

module.exports = mongoose.model("EmailOutbox", emailOutboxSchema);
