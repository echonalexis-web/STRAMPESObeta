const mongoose = require("mongoose");

// Qualification sub-schema
const qualificationSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ["education", "experience", "skill", "certification", "license", "other"],
    required: true,
  },
  value: {
    type: String,
    required: true,
    trim: true,
  },
  optional: {
    type: Boolean,
    default: false,
  },
  order: {
    type: Number,
    default: 0,
  },
}, { _id: false });

const jobVacancySchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  location: { type: String, required: true },
  salary: { type: String, default: "", required: false },
  salaryMin: {
    type: Number,
    default: null,
  },
  salaryMax: {
    type: Number,
    default: null,
  },
  
  // NEW: Structured qualifications
  qualifications: {
    type: [qualificationSchema],
    default: [],
    required: false,
  },
  
  // DEPRECATED: Kept for backward compatibility
  requirements: {
    type: String,
    default: "",
    required: false,
  },
  
  applicationDeadline: { type: Date, default: null, required: false },
  jobType: {
    type: String,
    enum: ["Full-time", "Part-time", "Contract", "Internship", "Temporary", "Remote"],
    default: "Full-time",
  },
  slots: { type: Number, default: 1 },
  employer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  isActive: { type: Boolean, default: true },
  status: { type: String, enum: ["active", "closed", "draft"], default: "active" },
  isFeatured: { type: Boolean, default: false },
  featuredOrder: { type: Number, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },

  // ===== NEW: Fields for filtering (semantic recommendation) =====
  industry: {
    type: String,
    default: "",
  },
  workNature: {
    type: String,
    enum: ["remote", "onsite", "hybrid"],
    default: null,
  },
  
  // NEW: Job archival and closure tracking
  archived: {
    type: Boolean,
    default: false,
  },
  archivedAt: {
    type: Date,
    default: null,
  },
  archiveReason: {
    type: String,
    enum: ["quota_reached", "manual_close", "deadline_passed", null],
    default: null,
  },
  closedAt: {
    type: Date,
    default: null,
  },
  archivedMetrics: {
    totalApplicants: { type: Number, default: 0 },
    qualifiedCount: { type: Number, default: 0 },
    shortlistedCount: { type: Number, default: 0 },
    hiredCount: { type: Number, default: 0 },
    hiredCandidateIds: [{ type: String, default: [] }],
    hiredCandidateNames: [{ type: String, default: [] }],
    qualifiedRate: { type: Number, default: 0 },
    shortlistedRate: { type: Number, default: 0 },
    hireRate: { type: Number, default: 0 },
    daysActive: { type: Number, default: 0 },
    archiveReason: {
      type: String,
      enum: ["quota_reached", "manual_close", "deadline_passed", null],
      default: null,
    },
    archivedAt: { type: Date, default: null },
  },
});

// Indexes for performance
jobVacancySchema.index({ "qualifications.type": 1 });
jobVacancySchema.index({ status: 1 });
jobVacancySchema.index({ industry: 1 });
jobVacancySchema.index({ workNature: 1 });
jobVacancySchema.index({ location: 1 });
jobVacancySchema.index({ salaryMin: 1, salaryMax: 1 });
jobVacancySchema.index({ archived: 1 });
jobVacancySchema.index({ closedAt: 1 });

module.exports = mongoose.model("JobVacancy", jobVacancySchema);