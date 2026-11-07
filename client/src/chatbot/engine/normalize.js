import { STOP_WORDS, FILIPINO_MARKERS, HOW_CUES } from './stopwords.js';
import { PHRASE_TO_CANONICAL, WORD_TO_CANONICAL, MAX_PHRASE_WORDS } from './synonyms.js';

export const MAX_CHARS = 200;
export const MAX_TOKENS = 24;

// Lowercase a-z and 0-9 survive; everything else (punctuation, hyphens,
// emoji, symbols, combining marks) becomes a space. One linear pass.
function fold(text) {
  const s = String(text).slice(0, MAX_CHARS).normalize('NFKD').toLowerCase();
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    const keep = (c >= 97 && c <= 122) || (c >= 48 && c <= 57);
    out += keep ? s[i] : ' ';
  }
  return out;
}

// Combining marks (e.g. the acute in "e" + U+0301) must vanish, not split
// the word, so strip them before folding.
function stripMarks(s) {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x300 || c > 0x36f) out += s[i];
  }
  return out;
}

function stem(word) {
  const n = word.length;
  if (n < 5) return word;
  if (word.endsWith('ing') && n - 3 >= 4) return word.slice(0, -3);
  if (word.endsWith('ed') && n - 2 >= 4) return word.slice(0, -2);
  if (word.endsWith('es') && n - 2 >= 4) {
    const base = word.slice(0, -2);
    if (base.endsWith('s') || base.endsWith('x') || base.endsWith('z')
      || base.endsWith('ch') || base.endsWith('sh')) return base;
  }
  if (word.endsWith('s') && !word.endsWith('ss') && n - 1 >= 4) return word.slice(0, -1);
  return word;
}

function canonicalize(word) {
  const direct = WORD_TO_CANONICAL.get(word);
  if (direct) return direct;
  const stemmed = stem(word);
  return WORD_TO_CANONICAL.get(stemmed) || stemmed;
}

export function normalize(text) {
  const raw = text == null ? [] : fold(stripMarksFirst(text)).split(' ').filter(Boolean);
  let filipinoMarkers = 0;
  let hasHowCue = false;
  for (const w of raw) {
    if (FILIPINO_MARKERS.has(w)) filipinoMarkers += 1;
    if (HOW_CUES.has(w)) hasHowCue = true;
  }

  // Phrase synonyms first, longest match first at each position.
  const merged = [];
  for (let i = 0; i < raw.length; ) {
    let hit = null;
    for (let n = Math.min(MAX_PHRASE_WORDS, raw.length - i); n >= 2; n -= 1) {
      const canonical = PHRASE_TO_CANONICAL.get(raw.slice(i, i + n).join(' '));
      if (canonical) { hit = { canonical, n }; break; }
    }
    if (hit) {
      merged.push({ w: hit.canonical, stop: false });
      i += hit.n;
    } else {
      merged.push({ w: raw[i], stop: STOP_WORDS.has(raw[i]) });
      i += 1;
    }
  }

  const tokens = [];
  const informative = [];
  for (const { w, stop } of merged.slice(0, MAX_TOKENS)) {
    if (stop) {
      tokens.push(w);
    } else {
      const c = canonicalize(w);
      tokens.push(c);
      informative.push(c);
    }
  }
  return { tokens, informative, hasHowCue, filipinoMarkers };
}

function stripMarksFirst(text) {
  return stripMarks(String(text).slice(0, MAX_CHARS).normalize('NFKD'));
}
