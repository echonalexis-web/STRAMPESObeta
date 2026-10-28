const mongoose = require("mongoose");
const { DIMENSION_KEYS } = require("../utils/matchWeights");

// Builds the { skills: Number, title: Number, ... } sub-schema from the
// canonical dimension key list, so a new dimension key only ever needs to be
// added in one place (matchWeightsService.DIMENSION_KEYS).
const weightsFields = {};
DIMENSION_KEYS.forEach((key) => {
  weightsFields[key] = { type: Number, required: true, min: 0, max: 100 };
});

// §C.1 — a configurable job-matching weight profile. One collection holds
// three kinds of document, distinguished by which of `owner`/`vacancy` is
// null:
//   owner: null,        vacancy: null        → the single platform-default profile
//   owner: <employerId>, vacancy: null        → that employer's own default
//   owner: <employerId>, vacancy: <jobId>     → that one job's override
// `owner` is kept on the per-vacancy document even though it's redundant
// with the job's own `employer` field, so the unique index below can use a
// flat {owner, vacancy} key — ownership must still be re-verified against
// the job's actual `employer` field before any write, never trusted from
// this field alone (see matchWeightsController.js).
const matchWeightProfileSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  vacancy: { type: mongoose.Schema.Types.ObjectId, ref: "JobVacancy", default: null },
  weights: { type: weightsFields, required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });

matchWeightProfileSchema.index({ owner: 1, vacancy: 1 }, { unique: true });

module.exports = mongoose.model("MatchWeightProfile", matchWeightProfileSchema);
