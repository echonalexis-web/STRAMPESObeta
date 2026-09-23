const mongoose = require("mongoose");

const jobApplicationSchema = new mongoose.Schema({
  applicant: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  vacancy: { type: mongoose.Schema.Types.ObjectId, ref: "JobVacancy", required: true },
  resume: { type: String, required: false },
  // Set only when `resume` was copied from a JobseekerDocument the applicant
  // saved earlier, instead of a one-off upload — see jobController.applyToJob.
  // Withdraw/update logic must never delete storage for a document-sourced
  // file, since the same library entry may still back other applications.
  resumeDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: "JobseekerDocument", default: null },
  coverLetter: { type: String, default: "", required: false },
  coverLetterFile: { type: String, default: "", required: false },
  coverLetterDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: "JobseekerDocument", default: null },
  status: {
    type: String,
    enum: [
      "pending",
      "reviewed",
      "shortlisted",
      "rejected",
      "hired",
      "Applied",
      "Reviewed",
      "Accepted",
      "Rejected",
    ],
    default: "pending"
  },
  employerNote: { type: String, default: "" },
  statusUpdatedAt: { type: Date, default: null },
  appliedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  interview: {
    scheduledAt: { type: Date, default: null },
    mode: { type: String, enum: ["onsite", "online", null], default: null },
    location: { type: String, default: "" },
    notes: { type: String, default: "" },
    scheduledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedAt: { type: Date, default: null },
    noShow: { type: Boolean, default: false },
  },
});

// Prevents the same applicant from ending up with two applications to the
// same vacancy under concurrent requests — the pre-insert findOne check in
// jobController.applyToJob narrows the window but can't close it alone; this
// index is what actually rejects the second of two truly-simultaneous inserts.
// It also serves every "my applications" lookup (`{applicant}`), since that's
// this compound index's leftmost field — but NOT a vacancy-only lookup (the
// "applicants for this job" queries below need their own index for that).
jobApplicationSchema.index({ applicant: 1, vacancy: 1 }, { unique: true });
jobApplicationSchema.index({ vacancy: 1 });

module.exports = mongoose.model("JobApplication", jobApplicationSchema);
