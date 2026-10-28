// Pure, dependency-free constants + validation for the configurable
// job-matching weights feature (§C.1) — deliberately has no model/service
// requires, so both server/models/MatchWeightProfile.js and
// server/models/MatchWeightBounds.js (which need DIMENSION_KEYS to build
// their schemas) and server/services/matchWeightsService.js (which needs
// both the models AND this file) can depend on it without a require cycle.
//
// Mirrors client/src/utils/qualifications.js's DIMENSION_ORDER /
// CODE_FALLBACK_WEIGHTS and server/services/semanticService.js's
// DEFAULT_DIMENSION_WEIGHTS exactly — keep all three in sync if the
// dimension set or default weights ever change.

const DIMENSION_KEYS = [
  "skills", "title", "experience", "education", "credentials",
  "industry", "language", "salary", "location", "employmentType",
];

// Integer-percent mirror of semanticService.js's DEFAULT_DIMENSION_WEIGHTS
// (0.27 etc. there, 27 here) — the final fallback link in the resolution
// chain when no MatchWeightProfile exists at any level.
const CODE_FALLBACK_WEIGHTS = {
  skills: 27, title: 11, experience: 12, education: 9, credentials: 6,
  industry: 10, language: 4, salary: 6, location: 9, employmentType: 6,
};

const DEFAULT_BOUND = Object.freeze({ min: 0, max: 100 });

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Validates a submitted WeightsMap against the ten required keys, integer
// 0-100 range, exact-100 sum, and (if provided) per-key bounds. Returns
// `{ valid: true }` or `{ valid: false, message }` — never throws, so
// callers can respond with a clean 400 instead of a 500.
function validateWeights(weights, bounds = null) {
  if (!isPlainObject(weights)) {
    return { valid: false, message: "weights must be an object." };
  }

  const submittedKeys = Object.keys(weights);
  const unknownKeys = submittedKeys.filter((key) => !DIMENSION_KEYS.includes(key));
  if (unknownKeys.length) {
    return { valid: false, message: `Unknown weight key(s): ${unknownKeys.join(", ")}.` };
  }
  const missingKeys = DIMENSION_KEYS.filter((key) => !(key in weights));
  if (missingKeys.length) {
    return { valid: false, message: `Missing weight key(s): ${missingKeys.join(", ")}.` };
  }

  const outOfBounds = [];
  let sum = 0;
  for (const key of DIMENSION_KEYS) {
    const value = weights[key];
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      return { valid: false, message: `"${key}" must be an integer between 0 and 100.` };
    }
    sum += value;
    const bound = bounds?.[key] || DEFAULT_BOUND;
    if (value < bound.min || value > bound.max) {
      outOfBounds.push(`${key} (${bound.min}-${bound.max}%)`);
    }
  }

  if (sum !== 100) {
    return { valid: false, message: `Weights must sum to exactly 100% (got ${sum}%).` };
  }
  if (outOfBounds.length) {
    return { valid: false, message: `Out of allowed range: ${outOfBounds.join(", ")}.` };
  }

  return { valid: true };
}

// Validates a submitted BoundsMap: ten required keys, integer 0-100 min/max,
// min <= max per key. No sum constraint — bounds aren't weights.
function validateBounds(bounds) {
  if (!isPlainObject(bounds)) {
    return { valid: false, message: "bounds must be an object." };
  }

  const submittedKeys = Object.keys(bounds);
  const unknownKeys = submittedKeys.filter((key) => !DIMENSION_KEYS.includes(key));
  if (unknownKeys.length) {
    return { valid: false, message: `Unknown bound key(s): ${unknownKeys.join(", ")}.` };
  }
  const missingKeys = DIMENSION_KEYS.filter((key) => !(key in bounds));
  if (missingKeys.length) {
    return { valid: false, message: `Missing bound key(s): ${missingKeys.join(", ")}.` };
  }

  for (const key of DIMENSION_KEYS) {
    const bound = bounds[key];
    if (!isPlainObject(bound) || !Number.isInteger(bound.min) || !Number.isInteger(bound.max)) {
      return { valid: false, message: `"${key}" must have integer min/max.` };
    }
    if (bound.min < 0 || bound.min > 100 || bound.max < 0 || bound.max > 100) {
      return { valid: false, message: `"${key}" min/max must be between 0 and 100.` };
    }
    if (bound.min > bound.max) {
      return { valid: false, message: `"${key}" minimum (${bound.min}%) can't exceed its maximum (${bound.max}%).` };
    }
  }

  // P0-05 — per-key min<=max passing doesn't mean a single weight vector can
  // satisfy every bound at once while still summing to 100. Ten minima of 20
  // each pass individually but require a total of >=200.
  const sumMin = DIMENSION_KEYS.reduce((sum, key) => sum + bounds[key].min, 0);
  const sumMax = DIMENSION_KEYS.reduce((sum, key) => sum + bounds[key].max, 0);
  if (sumMin > 100) {
    return {
      valid: false,
      message: `Minimums sum to ${sumMin}%, which is over 100% — no weight vector could satisfy every bound at once.`,
    };
  }
  if (sumMax < 100) {
    return {
      valid: false,
      message: `Maximums sum to ${sumMax}%, which is under 100% — no weight vector could satisfy every bound at once.`,
    };
  }

  return { valid: true };
}

module.exports = {
  DIMENSION_KEYS,
  CODE_FALLBACK_WEIGHTS,
  DEFAULT_BOUND,
  validateWeights,
  validateBounds,
};
