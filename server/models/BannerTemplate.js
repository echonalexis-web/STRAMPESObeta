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
    kind: { type: String, enum: ["gradient", "pattern"], required: true },
    definition: { type: mongoose.Schema.Types.Mixed, required: true },
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
