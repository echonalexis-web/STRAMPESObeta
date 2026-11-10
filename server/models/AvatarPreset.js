const mongoose = require("mongoose");

// A profile avatar a jobseeker can pick (superadmin managed). Like a banner template
// it is an uploaded SVG or PNG that the server rasterized to a 512x512 WebP plus a
// thumbnail; the upload itself is never stored. Jobseekers store only this
// document's id on their account (User.avatar.presetId), never a URL.
const avatarPresetSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 60 },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    nameFil: { type: String, default: "", trim: true, maxlength: 60 },
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
    // Shipped with the app (installed from the bundled SVGs): can be renamed, archived
    // or reordered, never deleted. The key is stable.
    isBuiltIn: { type: Boolean, default: false },
    builtInKey: { type: String, trim: true, maxlength: 60 },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    archivedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

avatarPresetSchema.index({ isActive: 1, sortOrder: 1 });
avatarPresetSchema.index({ builtInKey: 1 }, { unique: true, partialFilterExpression: { builtInKey: { $type: "string" } } });

module.exports = mongoose.model("AvatarPreset", avatarPresetSchema);
