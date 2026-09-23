const mongoose = require("mongoose");

// Portal-wide configuration, edited from Settings → System Preferences
// (superadmin only). A single document ("singleton") holds every rule —
// there is exactly one row in this collection, found/created via
// SystemSettings.getSingleton().
const systemSettingsSchema = new mongoose.Schema(
  {
    singletonKey: { type: String, default: "global", unique: true },
    // Auto-close a vacancy after this many days with no new applications
    // (see employerController.applyInactivityAutoCloseForEmployer).
    autoCloseDays: { type: Number, default: 30, min: 1, max: 365 },
    // Suspension/ban appeal token lifetime, in days (see authController.login).
    appealWindowDays: { type: Number, default: 14, min: 1, max: 90 },
    // Whether employers must be verified before posting jobs. Defaults to
    // true to preserve the behavior that was previously hardcoded in
    // middleware/auth.js's isVerifiedEmployer.
    requireEmployerVerification: { type: Boolean, default: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

systemSettingsSchema.statics.getSingleton = async function getSingleton() {
  // findOneAndUpdate + upsert (rather than findOne-then-create) so two
  // concurrent first-ever calls — e.g. right after a fresh deploy — can't
  // race each other into a duplicate-key error on singletonKey.
  return this.findOneAndUpdate(
    { singletonKey: "global" },
    { $setOnInsert: { singletonKey: "global" } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

module.exports = mongoose.model("SystemSettings", systemSettingsSchema);
