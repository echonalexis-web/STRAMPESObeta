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
  
  // NEW: Structured qualifications array replacing requirements
  qualifications: {
    type: [qualificationSchema],
    default: [],
    required: false,
  },
  
  // DEPRECATED: Kept for backward compatibility during migration
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
});

// Index for efficient qualification queries
jobVacancySchema.index({ "qualifications.type": 1 });

module.exports = mongoose.model("JobVacancy", jobVacancySchema);