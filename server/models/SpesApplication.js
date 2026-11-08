const mongoose = require("mongoose");
const { ALL_STATUSES } = require("../utils/spesLifecycle");
const { ALL_SLOTS } = require("../utils/spesDocuments");

const { Schema } = mongoose;

// A jobseeker's application to a SPES (Special Program for Employment of
// Students) program that an LMD Admin posted as an announcement. The exam and
// interview happen offline; the platform tracks the pipeline stage and, once
// results are released, the outcome.
//
// `status` is the single lifecycle field (see utils/spesLifecycle.js). Older
// rows may still hold under_review / for_exam / for_interview; every new
// field below has a safe default so existing applications keep working.
const spesApplicationSchema = new Schema(
  {
    applicant: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    announcement: { type: Schema.Types.ObjectId, ref: "Announcement", required: true, index: true },

    status: {
      type: String,
      enum: ALL_STATUSES,
      default: "submitted",
    },

    nsrpComplete: { type: Boolean, default: false },
    contactNumber: { type: String, default: "" },
    isOutOfSchoolYouth: { type: Boolean, default: false },
    // "student" | "osy". Rows from before this field derive it from isOutOfSchoolYouth.
    applicantType: { type: String, enum: ["student", "osy"], default: "student" },
    school: { type: String, default: "" },
    gradeLevel: { type: String, default: "" },
    // GWA is stored with its scale so staff can read it correctly.
    gwa: { type: Number, default: null },
    gwaScale: { type: String, enum: ["percent", "one_to_five", null], default: null },
    guardianName: { type: String, default: "" },
    guardianContact: { type: String, default: "" },
    // Tier label only ("minor15to17" | "adult18to30"), never the date of birth.
    ageTierAtApplication: { type: String, default: "" },

    documents: [
      {
        slot: { type: String, enum: [...ALL_SLOTS, null], default: null },
        label: { type: String, default: "" },
        fileUrl: { type: String, default: "" },
        mimeType: { type: String, default: "" },
        size: { type: Number, default: 0 },
        uploadedAt: { type: Date, default: Date.now },
        verification: {
          state: { type: String, enum: ["pending", "verified", "needs_replacement"], default: "pending" },
          reason: { type: String, default: "" },
          by: { type: Schema.Types.ObjectId, ref: "User", default: null },
          at: { type: Date, default: null },
        },
      },
    ],

    // Shown to the applicant as soon as they are set (not tied to results release).
    disqualification: {
      reason: { type: String, default: "" },
      by: { type: Schema.Types.ObjectId, ref: "User", default: null },
      at: { type: Date, default: null },
    },
    needsResubmission: {
      reason: { type: String, default: "" },
      requestedAt: { type: Date, default: null },
    },
    withdrawnAt: { type: Date, default: null },

    // Admin working data — never exposed to the applicant before release.
    evaluation: {
      examScore: { type: Number, default: null },
      examTakenAt: { type: Date, default: null },
      interviewScore: { type: Number, default: null },
      interviewAt: { type: Date, default: null },
      evaluatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },

    // Draft outcome; surfaced to the applicant only after resultReleasedAt is set.
    result: {
      outcome: {
        type: String,
        enum: ["pending", "accepted", "waitlisted", "not_accepted"],
        default: "pending",
      },
      rank: { type: Number, default: null },
      remarks: { type: String, default: "" },
      decidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      decidedAt: { type: Date, default: null },
    },

    resultReleasedAt: { type: Date, default: null },
    // Internal staff note. Never returned to the applicant.
    adminNote: { type: String, default: "" },
  },
  { timestamps: true }
);

spesApplicationSchema.index({ applicant: 1, announcement: 1 }, { unique: true });
spesApplicationSchema.index({ announcement: 1, status: 1 });
spesApplicationSchema.index({ announcement: 1, applicantType: 1, status: 1 });

module.exports = mongoose.model("SpesApplication", spesApplicationSchema);
