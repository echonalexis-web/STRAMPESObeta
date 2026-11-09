const mongoose = require("mongoose");
const governmentIdOcrSchema = require("./schemas/governmentIdOcr");
const { Schema } = mongoose;

// Plan §5: identity proofing by staff. Contact possession is verified before
// approval, and no public response exposes the resolved account.
const schema = new Schema({
  claimedIdentifier: { type: String, required: true, maxlength: 254 },
  resolvedUser: { type: Schema.Types.ObjectId, ref: "User", default: null },
  // Removed on resolution. The unique index enforces one open request/account.
  openAccountKey: { type: String },
  fullName: { type: String, required: true, maxlength: 200 },
  dateOfBirth: { type: Date, required: true },
  phone: { type: String, maxlength: 40 },
  lastKnownAddress: { type: String, maxlength: 500 },
  governmentIdFile: { type: String, required: true },
  selfieFile: { type: String, required: true },
  idTypeDeclared: { type: String, maxlength: 150 },
  idNumberDeclared: { type: String, maxlength: 80 },
  ocr: { type: governmentIdOcrSchema, default: () => ({ status: "queued" }) },
  // How the PESO office can reach the requester. "phone" (only while the username
  // sign-up feature is on) is for someone with no email: nothing is emailed, the
  // request cannot be approved by link, and staff complete it in person.
  contactMethod: { type: String, enum: ["email", "phone"], default: "email" },
  contactEmail: {
    type: String,
    required: function () {
      return this.contactMethod !== "phone";
    },
    lowercase: true,
    trim: true,
  },
  contactPhone: { type: String, maxlength: 40 },
  contactVerifiedAt: { type: Date, default: null },
  contactVerificationHash: { type: String, select: false },
  contactVerificationExpires: { type: Date, select: false },
  revision: { type: String, required: true },
  status: { type: String, enum: ["pending", "under_review", "approved", "rejected", "expired"], default: "pending", index: true },
  reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  adminResponse: { type: String, maxlength: 2000 },
  resolvedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true },
  redeemedAt: Date,
  // Outcome of emailing the one-time recovery link after approval. Holds no
  // token and no error text, only whether it was delivered and by which
  // channel, so staff can see "failed" in the queue and resend.
  delivery: {
    status: { type: String, enum: ["sent", "failed"] },
    attempts: { type: Number, default: 0 },
    lastAttemptAt: Date,
    lastAttemptBy: { type: Schema.Types.ObjectId, ref: "User" },
    channel: { type: String, maxlength: 20 },
  },
  filesDeletedAt: Date,
  ipAddress: String,
  userAgent: String,
}, { timestamps: true });
schema.index({ openAccountKey: 1 }, { unique: true, sparse: true });
schema.index({ resolvedUser: 1, resolvedAt: -1 });
schema.index({ status: 1, expiresAt: 1 });
module.exports = mongoose.model("AccountRecoveryRequest", schema);
