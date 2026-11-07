// Bounded FIFO memoization for deterministic string computations. Long values
// are still computed normally, but never retained as process-lifetime keys.
const memoizeString = (compute, { maxEntries, maxKeyLength }) => {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 ||
      !Number.isSafeInteger(maxKeyLength) || maxKeyLength < 0) {
    throw new RangeError("String cache bounds must be finite nonnegative integers with at least one entry");
  }
  const cache = new Map();
  return (value) => {
    const key = String(value ?? "");
    if (key.length > maxKeyLength) return compute(key);
    if (cache.has(key)) return cache.get(key);
    const result = compute(key);
    if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
    cache.set(key, result);
    return result;
  };
};

module.exports = { memoizeString };
