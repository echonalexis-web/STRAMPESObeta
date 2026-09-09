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
    // "admin"     – LMDPESO / PESO office staff (day-to-day operations)
    // "superadmin" – the maintainer. Superset of admin, and the ONLY role that
    //               can create, disable, or reset admin accounts. Never created
    //               through the app — only by scripts/seedSuperadmin.js.
    role: {
      type: String,
      enum: ["resident", "employer", "admin", "superadmin"],
      default: "resident",
    },
    phone: { type: String, default: null },

    // ===== Staff account provisioning (superadmin-managed admin accounts) =====
    // Set when a superadmin provisions an admin with a temporary password; the
    // account is forced through the change-password screen on first sign-in.
    mustChangePassword: { type: Boolean, default: false },
    // The superadmin who provisioned this admin account (audit trail / "whose
    // account is this" six months later).
    createdBySuperadmin: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Free-text note the superadmin records per admin: real name + PESO position.
    staffNote: { type: String, default: null },
    // Updated on every successful login so the superadmin console can show which
    // admin accounts are dormant.
    lastLoginAt: { type: Date, default: null },

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
    // Headcount band. Uses the same NSRP / DOLE MSME classification as
    // EmployerProfile.totalWorkforceSize so the two attributes stay in sync.
    companySize: {
      type: String,
      enum: ["", "micro", "small", "medium", "large"],
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

// Legacy headcount ranges ("11-50") were stored by an older build before the
// companySize enum moved to the NSRP / DOLE MSME bands. Normalise them before
// validation so an old value on an existing document — or from a stale client —
// can never block a save.
const LEGACY_COMPANY_SIZE = {
  "1-9": "micro",
  "1-10": "micro",
  "10-99": "small",
  "11-50": "small",
  "51-200": "medium",
  "100-199": "medium",
  "200+": "large",
  "201-500": "large",
  "500+": "large",
};

userSchema.pre("validate", function normaliseCompanySize(next) {
  if (this.companySize && LEGACY_COMPANY_SIZE[this.companySize]) {
    this.companySize = LEGACY_COMPANY_SIZE[this.companySize];
  } else if (
    this.companySize &&
    !["micro", "small", "medium", "large"].includes(this.companySize)
  ) {
    this.companySize = "";
  }
  next();
});

module.exports = mongoose.model("User", userSchema);