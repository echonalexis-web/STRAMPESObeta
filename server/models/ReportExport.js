const mongoose = require("mongoose");

// One row per generated report: metadata only. The file itself is never stored (it would
// duplicate regulated data, and regenerating is cheap); contentSha256 lets someone prove
// that a file they hold is the one that was generated.
const reportExportSchema = new mongoose.Schema(
  {
    reportId: { type: String, required: true, trim: true },
    // Snapshot of the preparer at generation time (re-read from the database, never from the request).
    preparedBy: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
      name: { type: String, default: "" },
      role: { type: String, default: "" },
      staffNote: { type: String, default: null },
    },
    dataset: { type: String, required: true },
    format: { type: String, required: true },
    // Canonical filter object (the same one the dashboard uses) plus the chosen columns and grouping.
    params: { type: mongoose.Schema.Types.Mixed, default: {} },
    columns: { type: [String], default: [] },
    grouping: { type: String, default: "none" },
    periodFrom: { type: Date, default: null },
    periodTo: { type: Date, default: null },
    recordCount: { type: Number, default: 0 },
    purpose: { type: String, default: "" },
    contentSha256: { type: String, default: "" },
    status: { type: String, enum: ["completed"], default: "completed" },
    durationMs: { type: Number, default: 0 },
    regeneratedFrom: { type: String, default: null },
    schemaVersion: { type: Number, default: 1 },
  },
  { timestamps: true }
);

// Indexes live in server/config/reportIndexes.js and are created only by
// scripts/createReportIndexes.js (autoIndex is not relied on for the reports work).
module.exports = mongoose.model("ReportExport", reportExportSchema);
