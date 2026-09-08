const mongoose = require("mongoose");

// A single line inside a template. Mirrors the `qualificationSchema`
// sub-document on JobVacancy so template items can be applied to a job
// posting without any transformation.
const templateItemSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["education", "experience", "skill", "certification", "license", "other"],
      required: true,
    },
    value: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    optional: {
      type: Boolean,
      default: false,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

// An employer-owned, reusable set of qualifications. Built-in ("system")
// templates are NOT stored here — they live in server/data/qualificationTemplates.js
// and are merged in at read time. Every document in this collection is a
// "custom" template owned by exactly one employer.
const qualificationTemplateSchema = new mongoose.Schema(
  {
    employer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    // Optional hint used to auto-suggest a template from the job title the
    // employer is typing on the posting form.
    jobTitle: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
    },
    items: {
      type: [templateItemSchema],
      default: [],
    },
    source: {
      type: String,
      enum: ["custom"],
      default: "custom",
    },
  },
  { timestamps: true }
);

// One template name per employer keeps the "save" flow idempotent — saving
// again under the same name overwrites rather than piling up duplicates.
qualificationTemplateSchema.index({ employer: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("QualificationTemplate", qualificationTemplateSchema);
