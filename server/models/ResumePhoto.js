const mongoose = require("mongoose");

// The one photo an applicant uploads for the resumes they make in the Studio. It is NOT the profile
// photo: it is a separate asset, owned by the applicant, read only by them (the Studio embeds it into
// a resume at save time), never shown on a profile page and never offered to employers on its own.
// `data` is the already-processed image (square WebP, metadata stripped), a few tens of KB.
const resumePhotoSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    data: { type: Buffer, required: true },
    contentType: { type: String, default: "image/webp" },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    bytes: { type: Number, default: 0 },
    originalName: { type: String, default: "", maxlength: 80 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ResumePhoto", resumePhotoSchema);
