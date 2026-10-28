const mongoose = require("mongoose");
const { DIMENSION_KEYS } = require("../utils/matchWeights");

const boundFields = {};
DIMENSION_KEYS.forEach((key) => {
  boundFields[key] = {
    min: { type: Number, required: true, min: 0, max: 100 },
    max: { type: Number, required: true, min: 0, max: 100 },
  };
});

// §C.1 — per-criterion {min, max} bounds every MatchWeightProfile's weights
// must fall within. A single document ("singleton") holds every bound —
// there is exactly one row in this collection, found/created via
// MatchWeightBounds.getSingleton() — same pattern as SystemSettings.js.
const matchWeightBoundsSchema = new mongoose.Schema(
  {
    singletonKey: { type: String, default: "global", unique: true },
    bounds: { type: boundFields, required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// Unconstrained (0-100) default for every dimension — the zero-config
// starting state, not an error, until a superadmin tightens any of them.
const defaultBounds = () => {
  const bounds = {};
  DIMENSION_KEYS.forEach((key) => { bounds[key] = { min: 0, max: 100 }; });
  return bounds;
};

matchWeightBoundsSchema.statics.getSingleton = async function getSingleton() {
  // findOneAndUpdate + upsert (rather than findOne-then-create) so two
  // concurrent first-ever calls can't race each other into a duplicate-key
  // error on singletonKey — same reasoning as SystemSettings.getSingleton().
  return this.findOneAndUpdate(
    { singletonKey: "global" },
    { $setOnInsert: { singletonKey: "global", bounds: defaultBounds() } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

module.exports = mongoose.model("MatchWeightBounds", matchWeightBoundsSchema);
