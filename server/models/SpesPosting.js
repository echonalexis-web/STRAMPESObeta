const mongoose = require("mongoose");

const { Schema } = mongoose;

// A SPES posting: one intake of the Special Program for Employment of Students
// (application period, required documents, slots, and the per-posting results
// release). It replaces "an Announcement with category spes"; announcements that
// were posted that way keep working through utils/spesPosting.fromAnnouncement
// until scripts/migrateSpesPostings.js is run.
//
// `status` is visibility only (draft / published / archived). What people see as
// open, closed or results released is derived (utils/spesPosting.getApplyState).
const spesPostingSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 180 },
    description: { type: String, default: "", trim: true, maxlength: 8000 },
    coverImage: { type: String, default: "", trim: true },

    status: { type: String, enum: ["draft", "published", "archived"], default: "draft" },

    // Application period. A null opensAt means "open as soon as it is published".
    opensAt: { type: Date, default: null },
    applicationDeadline: { type: Date, default: null },
    // Manual close by PESO staff, independent of the deadline. Reopen sets it back to null.
    closedAt: { type: Date, default: null },

    slots: { type: Number, default: null, min: 0 },
    // Document types an applicant must supply (utils/spesDocuments.js). Empty = standard set.
    requiredSlots: { type: [String], default: [] },
    // Free-text display lines (not enforced).
    requirements: { type: [String], default: [] },

    // Results release is per posting.
    results: {
      status: { type: String, enum: ["pending", "released"], default: "pending" },
      releasedAt: { type: Date, default: null },
      releasedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      summary: { type: String, default: "" },
      url: { type: String, default: "" },
      publishAcceptedList: { type: Boolean, default: false },
      exposeScores: { type: Boolean, default: false },
    },

    // Per-posting override of the global guardian config flag. null = use the default.
    guardianRequired: { type: Boolean, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    publishedAt: { type: Date, default: null },

    // Set by the migration; links the posting back to the announcement it came from.
    legacyAnnouncementId: { type: Schema.Types.ObjectId, ref: "Announcement" },
    // Optional news-feed card that links to this posting.
    newsAnnouncementId: { type: Schema.Types.ObjectId, ref: "Announcement", default: null },
  },
  { timestamps: true }
);

spesPostingSchema.index({ status: 1, publishedAt: -1 });
spesPostingSchema.index({ applicationDeadline: 1 });
// Partial, so postings that never came from an announcement do not collide on null.
spesPostingSchema.index(
  { legacyAnnouncementId: 1 },
  { unique: true, partialFilterExpression: { legacyAnnouncementId: { $type: "objectId" } } }
);

module.exports = mongoose.model("SpesPosting", spesPostingSchema);
