const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    // ===== Authentication =====
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["resident", "employer", "admin"],
      default: "resident",
    },
    phone: { type: String, default: null },

    // ===== Common profile fields =====
    about: { type: String, default: "" },
    address: { type: String, default: null },
    profileImage: { type: String, default: null },

    // ===== Jobseeker-specific fields =====
    dateOfBirth: { type: Date, default: null },
    gender: {
      type: String,
      enum: ["Male", "Female", "Prefer not to say"],
      default: null,
    },
    desiredJobTitle: { type: String, default: null },
    skills: { type: [String], default: [] },
    workExperience: {
      type: String,
      enum: [
        "Fresh Graduate",
        "Less than 1 year",
        "1–3 years",
        "3–5 years",
        "5+ years",
      ],
      default: null,
    },
    educationalAttainment: {
      type: String,
      enum: [
        "Elementary Graduate",
        "High School Graduate",
        "Senior High School Graduate",
        "Vocational / TESDA",
        "College Undergraduate",
        "College Graduate",
        "Master's Degree",
        "Doctorate",
      ],
      default: null,
    },
    availabilityStatus: {
      type: String,
      enum: ["Actively Looking", "Open to Offers", "Currently Employed"],
      default: null,
    },

    // ===== Employer-specific fields =====
    companyName: { type: String, default: "" },
    industry: { type: String, default: "" },
    companySize: {
      type: String,
      enum: ["", "1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5000+"],
      default: "",
    },
    website: { type: String, default: "" },
    companyDescription: { type: String, default: "" },
    businessAddress: { type: String, default: "" },

    // ===== Verification & status =====
    verificationStatus: {
      type: String,
      enum: ["unverified", "pending", "verified"],
      default: "unverified",
    },
    businessPermitUrl: { type: String, default: null },
    registrationDocUrl: { type: String, default: null },
    resumeFile: { type: String, default: null },
    validIdFile: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    hasCompletedOnboarding: { type: Boolean, default: false },
    onboardingComplete: { type: Boolean, default: false },

    createdAt: { type: Date, default: Date.now },

    notifications: [
      {
        message: String,
        isRead: { type: Boolean, default: false },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);