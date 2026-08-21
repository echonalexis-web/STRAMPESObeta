const mongoose = require("mongoose");

const jobseekerProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Personal Identity
    civilStatus: {
      type: String,
      enum: ["Single", "Married", "Widowed", "Separated", "Divorced"],
      default: null,
    },
    placeOfBirth: { type: String, default: null },
    citizenship: { type: String, default: null },
    height: { type: Number, default: null },
    weight: { type: Number, default: null },
    // Contact
    landline: { type: String, default: null },
    mobileSecondary: { type: String, default: null },
    // Addresses (structured)
    presentAddress: {
      street: { type: String, default: "" },
      barangay: { type: String, default: "" },
      municipality: { type: String, default: "" },
      province: { type: String, default: "" },
      region: { type: String, default: "" },
    },
    permanentAddress: {
      street: { type: String, default: "" },
      barangay: { type: String, default: "" },
      municipality: { type: String, default: "" },
      province: { type: String, default: "" },
      region: { type: String, default: "" },
    },
    // Demographic Trackers
    disability: {
      type: [String],
      enum: ["Visual", "Hearing", "Speech", "Physical", "Others"],
      default: [],
    },
    is4psBeneficiary: { type: Boolean, default: false },
    _4psHouseholdId: { type: String, default: null },
    isOfw: { type: Boolean, default: false },
    isRepatriated: { type: Boolean, default: false },
    repatriationIntent: { type: String, default: null },
    // Current Status
    employmentStatus: {
      type: String,
      enum: ["employed", "unemployed"],
      default: null,
    },
    employmentType: {
      type: String,
      enum: ["wage", "self"],
      default: null,
    },
    unemploymentReason: {
      type: String,
      enum: [
        "fresh_grad",
        "finished_contract",
        "resigned",
        "retired",
        "laidoff_local",
        "laidoff_abroad",
      ],
      default: null,
    },
    laidoffCountry: { type: String, default: null },

    // ===== NEW: Skills & Preferences for semantic matching =====
    skills: {
      type: [String],
      default: [],
    },
    preferredIndustries: {
      type: [String],
      default: [],
      validate: {
        validator: function (v) {
          return v.length <= 10; // Prevent users from selecting unlimited industries
        },
        message: "You can select a maximum of 10 preferred industries.",
      },
    },
    preferredJobTypes: {
      type: [String],
      enum: ["Full-time", "Part-time", "Contract", "Temporary", "Internship"],
      default: [],
    },
    preferredWorkNature: {
      type: [String],
      enum: ["Remote", "Onsite", "Hybrid"],
      default: [],
    },
    industrySelectionStep: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

jobseekerProfileSchema.index({ userId: 1 }, { unique: true });
// Performance index for querying by preferred industries
jobseekerProfileSchema.index({ preferredIndustries: 1 });

module.exports = mongoose.model("JobseekerProfile", jobseekerProfileSchema);