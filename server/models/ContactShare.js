const mongoose = require("mongoose");

// A jobseeker's explicit, revocable decision to share contact details with ONE
// employer, in ONE conversation (the "Share my contact details" button). A reply
// is never consent: only this document is. It records WHICH fields are shared,
// not copies of the values, so a number changed later is not leaked by an old
// share, and revoking ends access at once. Applying to an employer is a separate
// path (an active application also shares contact; see profileProjection.js).
const contactShareSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true },
    jobseeker: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    employer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    fields: {
      phone: { type: Boolean, default: false },
      email: { type: Boolean, default: false },
    },
    sharedAt: { type: Date, default: Date.now },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

contactShareSchema.index({ conversation: 1 }, { unique: true });
contactShareSchema.index({ employer: 1, jobseeker: 1, revokedAt: 1 });

module.exports = mongoose.model("ContactShare", contactShareSchema);
