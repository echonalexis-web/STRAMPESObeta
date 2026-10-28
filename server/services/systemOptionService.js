// Resolves the admin-maintainable catalogs (server/models/SystemOption.js)
// backing three dropdown lists: industry, jobType, governmentIdType (item 11,
// markdowns/MOCK_DEFENSE_REVISION_STATUS.md). A short in-process cache avoids
// a DB round-trip on every single write across the several call sites that
// validate against these categories — a newly-added admin option becomes
// enforceable within CACHE_TTL_MS, not immediately, which is an acceptable
// trade for not hitting the DB on every job posting / profile save.
const SystemOption = require("../models/SystemOption");

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map(); // category -> { values: Set<string>, expiresAt: number }

async function getActiveValues(category) {
  const cached = cache.get(category);
  if (cached && cached.expiresAt > Date.now()) return cached.values;

  const rows = await SystemOption.find({ category, isActive: true }).select("value").lean();
  const values = new Set(rows.map((row) => row.value));
  cache.set(category, { values, expiresAt: Date.now() + CACHE_TTL_MS });
  return values;
}

async function isValidOption(category, value) {
  const values = await getActiveValues(category);
  return values.has(value);
}

// Call after any write to SystemOption (create/update/delete) so the admin's
// change is reflected immediately instead of waiting out the TTL.
function invalidateCache(category) {
  if (category) cache.delete(category);
  else cache.clear();
}

module.exports = { getActiveValues, isValidOption, invalidateCache, CACHE_TTL_MS };
