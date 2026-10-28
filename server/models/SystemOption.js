const mongoose = require("mongoose");

// Admin-maintainable catalog entries backing the three dropdown lists the
// mock-defense revision document asked to be admin-editable (item 11):
// industries, job types, government ID types. Deliberately NOT extended to
// application statuses (wired into scoring/notifications/audit logic),
// municipalities (a large PH government geographic reference file), or
// education levels (ordinal, not a free list) — see
// markdowns/MOCK_DEFENSE_REVISION_STATUS.md for why those stay as code.
const systemOptionSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      enum: ["industry", "jobType", "governmentIdType"],
      required: true,
    },
    value: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
    // Display order within a category — lower sorts first.
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// One value per category — the catalog itself has no duplicates, though
// retiring (isActive: false) is preferred over deleting so existing records
// that reference a retired value aren't orphaned from their own history.
systemOptionSchema.index({ category: 1, value: 1 }, { unique: true });
systemOptionSchema.index({ category: 1, isActive: 1, order: 1 });

module.exports = mongoose.model("SystemOption", systemOptionSchema);
