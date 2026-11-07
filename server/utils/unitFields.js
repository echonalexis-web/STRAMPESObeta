// [mock-defense item 3] height/weight gained explicit persisted units
// (heightUnit/weightUnit on JobseekerProfile). Both authController.updateProfile
// and userController.completeOnboarding need the exact same "coerce an incoming
// unit token to a valid enum value, default sensibly otherwise" rule, so it's
// extracted once here rather than duplicated — and kept as a pure function so
// it's unit-testable without the Mongoose-mocking machinery those controllers
// would otherwise require (mirrors utils/personalizationEligibility.js's
// reasoning for the same kind of extraction).
//
// Anything other than the exact valid token (missing, undefined, "", a legacy
// client that never sends the field, or garbage input) falls back to the
// metric default — the same default the schema itself uses for existing
// records that predate these fields, so client and DB agree on "sensible
// default" for records with no stored unit.
const VALID_HEIGHT_UNITS = ["cm", "ft_in"];
const VALID_WEIGHT_UNITS = ["kg", "lb"];

function normalizeHeightUnit(raw) {
  return VALID_HEIGHT_UNITS.includes(raw) ? raw : "cm";
}

function normalizeWeightUnit(raw) {
  return VALID_WEIGHT_UNITS.includes(raw) ? raw : "kg";
}

module.exports = {
  VALID_HEIGHT_UNITS,
  VALID_WEIGHT_UNITS,
  normalizeHeightUnit,
  normalizeWeightUnit,
};
