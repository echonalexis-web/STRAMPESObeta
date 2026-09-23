const mongoose = require("mongoose");

// A jobseeker's reusable library of resumes / cover letters. Rows here are
// never exposed to employers directly — an employer only ever sees the
// storedValue that gets copied onto a JobApplication at the moment the
// jobseeker actually applies (see jobController.applyToJob), so saving a
// document to the library carries no visibility to anyone until then.
const jobseekerDocumentSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    kind: {
      type: String,
      enum: ["resume", "coverLetter"],
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    storedValue: {
      type: String,
      required: true,
    },
    mimeType: {
      type: String,
      default: "",
    },
    sizeBytes: {
      type: Number,
      default: 0,
    },
    source: {
      type: String,
      enum: ["upload", "builder"],
      default: "upload",
    },
    // Exactly one document per (owner, kind) may be primary — enforced in
    // jobseekerDocumentController, not at the schema level, since Mongo has
    // no direct "unique among siblings" constraint for a non-unique value.
    isPrimary: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

jobseekerDocumentSchema.index({ owner: 1, kind: 1, createdAt: -1 });

module.exports = mongoose.model("JobseekerDocument", jobseekerDocumentSchema);
