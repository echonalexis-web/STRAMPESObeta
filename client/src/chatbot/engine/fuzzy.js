import { normalize } from './normalize.js';

// Optimal-string-alignment Damerau-Levenshtein distance.
export function distance(a, b) {
  const n = a.length;
  const m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;
  const d = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i += 1) d[i][0] = i;
  for (let j = 0; j <= m; j += 1) d[0][j] = j;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[n][m];
}

export function buildVocabulary(phrases) {
  const vocab = new Set();
  for (const p of phrases || []) {
    for (const t of normalize(p).informative) vocab.add(t);
  }
  return vocab;
}

// Correct only when: length >= 4 (1 edit) or >= 8 (2 edits), same first
// letter, and the best candidate is unique.
export function correct(token, vocab) {
  const same = { token, corrected: false };
  if (!token || vocab.has(token) || token.length < 4) return same;
  const maxEdits = token.length >= 8 ? 2 : 1;
  let best = Infinity;
  let winner = null;
  let tie = false;
  for (const v of vocab) {
    if (v[0] !== token[0] || Math.abs(v.length - token.length) > maxEdits) continue;
    const dist = distance(token, v);
    if (dist > maxEdits) continue;
    if (dist < best) {
      best = dist; winner = v; tie = false;
    } else if (dist === best) {
      tie = true;
    }
  }
  if (!winner || tie) return same;
  return { token: winner, corrected: true };
}
