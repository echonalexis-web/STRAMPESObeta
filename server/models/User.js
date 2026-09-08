const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    // ===== Authentication =====
    name: { type: String, required: true },
    surname: { type: String, default: null },
    firstName: { type: String, default: null },
    middleName: { type: String, default: null },
    suffix: { type: String, default: null },
    email: { type: String, required: true, unique: true },
    // Not required for accounts created through Google sign-in (they have no
    // password until the user sets one via "Forgot password?").
    password: {
      type: String,
      required: function () {
        return !this.googleId;
      },
    },
    // ===== Google sign-in =====
    // Google's stable account id (the ID token `sub`). Uniqueness is enforced
    // in the controller (find-by-googleId) rather than a partial index, to keep
    // the existing Atlas indexes untouched.
    googleId: { type: String, default: null },
    authProvider: { type: String, enum: ["local", "google"], default: "local" },
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
    
    // ===== NEW: Industry Preferences (Mirrored from JobseekerProfile for quick access) =====
    preferredIndustries: { type: [String], default: [] },
    industryPreferenceLevel: {
      type: String,
      enum: ["strict", "flexible"],
      default: "flexible",
    },

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
      enum: ["unverified", "pending", "verified", "rejected"],
      default: "unverified",
    },
    businessPermitUrl: { type: String, default: null },
    registrationDocUrl: { type: String, default: null },
    // Review trail for the employer document verification flow.
    verificationNote: { type: String, default: null },
    verificationSubmittedAt: { type: Date, default: null },
    verificationReviewedAt: { type: Date, default: null },
    verificationReviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resumeFile: { type: String, default: null },
    validIdFile: { type: String, default: null },
    isActive: { type: Boolean, default: true },

    // ===== Moderation / suspension =====
    // `isActive` stays the runtime gate every existing check relies on.
    // `accountStatus` records *why* an account is inactive so the login wall
    // and the appeal flow can tell a temporary suspension from a permanent ban.
    accountStatus: {
      type: String,
      enum: ["active", "suspended", "banned"],
      default: "active",
    },
    suspensionReason: { type: String, default: null },
    suspendedAt: { type: Date, default: null },
    suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // ===== Password reset =====
    // A SHA-256 hash of the token that was put in the reset link (never the raw
    // token), so a database leak can't be used to reset accounts.
    passwordResetToken: { type: String, default: null },
    passwordResetExpires: { type: Date, default: null },

    // ===== Email change (verification) =====
    // The requested new address, held here until the user opens the
    // confirmation link sent to it. `email` is only overwritten on confirm.
    pendingEmail: { type: String, default: null },
    emailChangeToken: { type: String, default: null },
    emailChangeExpires: { type: Date, default: null },

    // ===== Terms & community-guidelines acceptance =====
    acceptedTermsAt: { type: Date, default: null },
    termsVersion: { type: String, default: null },

    hasCompletedOnboarding: { type: Boolean, default: false },
    onboardingComplete: { type: Boolean, default: false },

    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);