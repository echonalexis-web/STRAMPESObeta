const mongoose = require("mongoose");

// A profile banner preset managed by the superadmin. The `definition` is
// validated JSON (see services/bannerTemplateService.js): gradient and pattern
// settings only, never free CSS or a url(), so a template can not inject CSS or
// load an external image. Accounts with no cover render the built-in "Classic
// green", which needs no document here.
const bannerTemplateSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 60 },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    nameFil: { type: String, default: "", trim: true, maxlength: 60 },
    // "gradient" and "pattern" are legacy (no longer creatable); new templates are "image".
    kind: { type: String, enum: ["gradient", "pattern", "image"], required: true },
    // Legacy templates only. Kept untouched when a legacy template gets an image.
    definition: {
      type: mongoose.Schema.Types.Mixed,
      required: function requiredForLegacy() {
        return this.kind !== "image";
      },
    },
    // The processed banner (1600x400 WebP) and its thumbnail (800x200 WebP).
    // The upload itself is never stored: only this normalized output.
    image: {
      url: { type: String },
      thumbUrl: { type: String },
      storedValue: { type: String },
      thumbStoredValue: { type: String },
      width: { type: Number },
      height: { type: Number },
      bytes: { type: Number },
      placeholderColor: { type: String },
      luminance: { type: Number },
    },
    // Text-contrast hint. Image templates get it from the image's average brightness.
    overlay: { type: String, enum: ["light", "dark"], default: "dark" },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

bannerTemplateSchema.index({ isActive: 1, sortOrder: 1 });
// Exactly one default.
bannerTemplateSchema.index({ isDefault: 1 }, { unique: true, partialFilterExpression: { isDefault: true } });

module.exports = mongoose.model("BannerTemplate", bannerTemplateSchema);
