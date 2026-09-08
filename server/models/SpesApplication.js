const mongoose = require("mongoose");

const { Schema } = mongoose;

// A resident's application to a SPES (Special Program for Employment of
// Students) program that an LMD Admin posted as an announcement. The exam and
// interview happen offline; the platform tracks the pipeline stage and, once
// results are released, the outcome.
const spesApplicationSchema = new Schema(
  {
    applicant: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    announcement: { type: Schema.Types.ObjectId, ref: "Announcement", required: true, index: true },

    status: {
      type: String,
      enum: [
        "submitted",
        "under_review",
        "for_exam",
        "for_interview",
        "evaluated",
        "results_released",
        "withdrawn",
        "disqualified",
      ],
      default: "submitted",
    },

    nsrpComplete: { type: Boolean, default: false },
    contactNumber: { type: String, default: "" },
    school: { type: String, default: "" },
    gradeLevel: { type: String, default: "" },
    guardianName: { type: String, default: "" },

    documents: [
      {
        label: { type: String, default: "" },
        fileUrl: { type: String, default: "" },
      },
    ],

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
    adminNote: { type: String, default: "" },
  },
  { timestamps: true }
);

spesApplicationSchema.index({ applicant: 1, announcement: 1 }, { unique: true });
spesApplicationSchema.index({ announcement: 1, status: 1 });

module.exports = mongoose.model("SpesApplication", spesApplicationSchema);
