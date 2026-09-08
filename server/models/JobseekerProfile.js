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
      enum: ["Single", "Married", "Widowed", "Separated", "Divorced", "Live-in"],
      default: null,
    },
    placeOfBirth: { type: String, default: null },
    citizenship: { type: String, default: null },
    height: { type: Number, default: null },
    weight: { type: Number, default: null },
    religion: { type: String, default: null },
    // Government IDs (optional)
    tin: { type: String, default: null },
    sssGsisNo: { type: String, default: null },
    pagibigNo: { type: String, default: null },
    philhealthNo: { type: String, default: null },
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
    passportNo: { type: String, default: null },
    passportExpiryDate: { type: Date, default: null },
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

    // ===== Job Preference (NSRP Form 1, Section II) =====
    preferredOccupations: {
      type: [String],
      default: [],
      validate: {
        validator: (v) => v.length <= 4,
        message: "You can list a maximum of 4 preferred occupations.",
      },
    },
    preferredWorkLocationLocal: {
      type: [String],
      default: [],
      validate: {
        validator: (v) => v.length <= 3,
        message: "You can list a maximum of 3 local work locations.",
      },
    },
    preferredWorkLocationOverseas: {
      type: [String],
      default: [],
      validate: {
        validator: (v) => v.length <= 3,
        message: "You can list a maximum of 3 overseas work locations.",
      },
    },
    expectedSalaryMin: { type: Number, default: null },
    expectedSalaryMax: { type: Number, default: null },

    // ===== Educational Background details (NSRP Form 1, Section IV) =====
    schoolAttended: { type: String, default: null },
    schoolAttendedOther: { type: String, default: null },
    course: { type: String, default: null },
    yearGraduated: { type: String, default: null },

    // ===== Language / Dialect Proficiency (NSRP Form 1, Section III) =====
    languageProficiency: {
      English: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        speak: { type: Boolean, default: false },
        understand: { type: Boolean, default: false },
      },
      Filipino: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        speak: { type: Boolean, default: false },
        understand: { type: Boolean, default: false },
      },
      Others: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        speak: { type: Boolean, default: false },
        understand: { type: Boolean, default: false },
      },
    },
    languageOthersLabel: { type: String, default: null },

    // ===== Work History detail (NSRP Form 1, Section VII) — supplements `workExperience` bucket on User =====
    workHistory: {
      type: [
        {
          companyName: { type: String, default: "" },
          address: { type: String, default: "" },
          position: { type: String, default: "" },
          dateFrom: { type: String, default: "" },
          dateTo: { type: String, default: "" },
          status: { type: String, default: "" },
          _id: false,
        },
      ],
      default: [],
    },

    // ===== Technical/Vocational Training (NSRP Form 1, Section V) =====
    vocationalTrainings: {
      type: [
        {
          course: { type: String, default: "" },
          institution: { type: String, default: "" },
          institutionOther: { type: String, default: "" },
          durationFrom: { type: String, default: "" },
          durationTo: { type: String, default: "" },
          certificate: { type: String, default: "" },
          _id: false,
        },
      ],
      default: [],
    },

    // ===== Eligibility / Professional License (NSRP Form 1, Section VI) =====
    eligibilities: {
      type: [
        {
          name: { type: String, default: "" },
          rating: { type: String, default: "" },
          examDate: { type: String, default: "" },
          _id: false,
        },
      ],
      default: [],
    },
    professionalLicenses: {
      type: [
        {
          name: { type: String, default: "" },
          validUntil: { type: String, default: "" },
          _id: false,
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

jobseekerProfileSchema.index({ userId: 1 }, { unique: true });
// Performance index for querying by preferred industries
jobseekerProfileSchema.index({ preferredIndustries: 1 });

module.exports = mongoose.model("JobseekerProfile", jobseekerProfileSchema);