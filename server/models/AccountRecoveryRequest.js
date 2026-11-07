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
  contactEmail: { type: String, required: true, lowercase: true, trim: true },
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
  filesDeletedAt: Date,
  ipAddress: String,
  userAgent: String,
}, { timestamps: true });
schema.index({ openAccountKey: 1 }, { unique: true, sparse: true });
schema.index({ resolvedUser: 1, resolvedAt: -1 });
schema.index({ status: 1, expiresAt: 1 });
module.exports = mongoose.model("AccountRecoveryRequest", schema);
