// Seeded pseudo-random helpers for the sample-data generator. Pure: no I/O, no Math.random.

const hashString = (text) => {
  // FNV-1a, 32 bit.
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

// mulberry32: small, fast, good enough for sample data.
const createRng = (seedNumber) => {
  let a = (Number(seedNumber) >>> 0) || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min, max) => min + Math.floor(next() * (max - min + 1)); // inclusive
  const chance = (p) => next() < p;
  const pick = (list) => list[Math.floor(next() * list.length)];
  const weighted = (items, weights) => {
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = next() * total;
    for (let i = 0; i < items.length; i += 1) {
      roll -= weights[i];
      if (roll < 0) return items[i];
    }
    return items[items.length - 1];
  };
  const shuffle = (list) => {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const sample = (list, count) => shuffle(list).slice(0, count);

  return { next, int, chance, pick, weighted, shuffle, sample };
};

// Largest-remainder split of `total` by `weights`. With minOne, every bucket gets at least 1
// (only when total >= number of buckets).
const allocate = (total, weights, { minOne = false } = {}) => {
  const sum = weights.reduce((s, w) => s + w, 0);
  const raw = weights.map((w) => (total * w) / sum);
  const counts = raw.map((r) => Math.floor(r));
  if (minOne && total >= weights.length) {
    for (let i = 0; i < counts.length; i += 1) if (counts[i] < 1) counts[i] = 1;
  }
  let assigned = counts.reduce((s, c) => s + c, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((x, y) => y.frac - x.frac || x.i - y.i);
  let cursor = 0;
  while (assigned < total) {
    counts[order[cursor % order.length].i] += 1;
    assigned += 1;
    cursor += 1;
  }
  // minOne bumps can overshoot: take back from the largest buckets that stay >= 1.
  while (assigned > total) {
    let best = -1;
    for (let i = 0; i < counts.length; i += 1) {
      if (counts[i] > (minOne ? 1 : 0) && (best === -1 || counts[i] > counts[best])) best = i;
    }
    if (best === -1) break;
    counts[best] -= 1;
    assigned -= 1;
  }
  return counts;
};

// Deterministic 24-hex ObjectId strings from a separate stream (seed + batch).
const createIdFactory = (seedNumber, batch) => {
  const rng = createRng(hashString(`${seedNumber}:${batch}`));
  const used = new Set();
  return () => {
    for (;;) {
      let hex = "";
      for (let i = 0; i < 12; i += 1) hex += Math.floor(rng.next() * 256).toString(16).padStart(2, "0");
      if (!used.has(hex)) {
        used.add(hex);
        return hex;
      }
    }
  };
};

module.exports = { hashString, createRng, allocate, createIdFactory };
