// Matching engine: index + ask(). Pure JS, no React/network/storage.
// Design: plan D.2 (scoring, thresholds, tie-break) and D.5 (scope).
import { normalize } from './normalize.js';
import { correct } from './fuzzy.js';
import { classify } from './scope.js';

export const ANSWER_MIN = 0.70;
export const SUGGEST_MIN = 0.40;
export const MARGIN_MIN = 0.10;
export const MAX_SUGGESTIONS = 3;

// Starting values from the plan; pinned by tests.
export const scoreWeights = Object.freeze({ question: 0.85, typo: 0.9, phrase: 0.15, hint: 0.05 });

const EPS = 1e-9;
const ROLES = new Set(['public', 'jobseeker', 'employer', 'admin', 'superadmin']);

/**
 * @typedef {{type:'answer', entryId:string}
 *  | {type:'suggest', entryIds:string[]}
 *  | {type:'fallback'}
 *  | {type:'empty'}
 *  | {type:'refusal', reason:'account-data'|'action'|'recommendation'|'legal'|'general'|'people'|'probe'}
 *  | {type:'repeat'}} AskResult
 * 'repeat' is produced by the Task 6 reducer, never by ask().
 */

function tokensOf(phrase) {
  return normalize(phrase).informative;
}

function prepare(entry) {
  const kwSet = new Set();
  const phrases = [];
  const kw = entry.keywords || {};
  for (const lang of ['en', 'fil']) {
    for (const phrase of kw[lang] || []) {
      const toks = tokensOf(phrase);
      for (const t of toks) kwSet.add(t);
      if (toks.length >= 2) phrases.push(toks);
    }
  }
  const qSet = new Set();
  for (const lang of ['en', 'fil']) {
    for (const t of tokensOf((entry.q && entry.q[lang]) || '')) qSet.add(t);
  }
  const all = new Set([...kwSet, ...qSet]);
  return {
    entry,
    id: entry.id,
    kwSet,
    qSet,
    all,
    phrases,
    size: all.size,
    priority: entry.priority || 0,
    nav: entry.kind === 'nav' || entry.kind === 'nav+faq',
  };
}

function isVisible(entry, role) {
  const roles = entry.roles || [];
  return roles.includes('*') || roles.includes(role);
}

export function buildIndex(entries) {
  const prepared = (entries || []).filter((e) => e && e.status !== 'draft').map(prepare);
  const views = new Map();

  // Role filter, idf and vocabulary are all derived from the visible entries
  // only, so hidden entries leak nothing into ranking or typo correction.
  function view(role) {
    const r = ROLES.has(role) ? role : 'public';
    let v = views.get(r);
    if (!v) {
      const visible = prepared.filter((p) => isVisible(p.entry, r));
      const df = new Map();
      for (const p of visible) for (const t of p.all) df.set(t, (df.get(t) || 0) + 1);
      const n = visible.length;
      const idf = new Map();
      for (const [t, d] of df) idf.set(t, Math.log(1 + n / d));
      v = { role: r, entries: visible, idf, vocab: new Set(df.keys()), n };
      views.set(r, v);
    }
    return v;
  }
  return { view };
}

function containsRun(seq, run) {
  for (let i = 0; i + run.length <= seq.length; i += 1) {
    let j = 0;
    while (j < run.length && seq[i + j] === run[j]) j += 1;
    if (j === run.length) return true;
  }
  return false;
}

// Query tokens after dedupe and typo correction.
function prepareQuery(text, v) {
  const norm = normalize(text);
  const seen = new Set();
  const uniq = [];
  const seq = [];
  for (const raw of norm.informative) {
    const c = v.vocab.has(raw) ? { token: raw, corrected: false } : correct(raw, v.vocab);
    seq.push(c.token);
    if (!seen.has(c.token)) {
      seen.add(c.token);
      uniq.push(c);
    }
  }
  return { uniq, seq, hasHowCue: norm.hasHowCue, informativeCount: uniq.length };
}

function scoreEntry(p, q, v) {
  let num = 0;
  let den = 0;
  for (const { token, corrected } of q.uniq) {
    // Tokens unknown to every visible entry still weigh as the rarest known term.
    const w = v.idf.get(token) ?? Math.log(1 + v.n);
    den += w;
    let m = 0;
    if (p.kwSet.has(token)) m = 1;
    else if (p.qSet.has(token)) m = scoreWeights.question;
    if (corrected) m *= scoreWeights.typo;
    num += w * m;
  }
  if (num === 0 || den === 0) return 0;
  let score = num / den;
  if (p.phrases.some((ph) => containsRun(q.seq, ph))) score += scoreWeights.phrase;
  if (q.hasHowCue && p.nav) score += scoreWeights.hint;
  return Math.min(1, score);
}

function compare(a, b) {
  if (Math.abs(a.score - b.score) > EPS) return b.score - a.score;
  if (a.size !== b.size) return a.size - b.size;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Ranked [{id, score}] over entries visible to ctx.role. Exposed for tests. */
export function rank(index, text, ctx) {
  const v = index.view(ctx && ctx.role);
  const q = prepareQuery(text, v);
  return rankPrepared(v, q);
}

function rankPrepared(v, q) {
  return v.entries
    .map((p) => ({ id: p.id, score: scoreEntry(p, q, v), size: p.size, priority: p.priority }))
    .filter((r) => r.score > 0)
    .sort(compare)
    .map(({ id, score, size, priority }) => ({ id, score, size, priority }));
}

/** Threshold table from D.2. ranked is sorted; n is the informative token count. */
export function decide(ranked, n) {
  if (!ranked.length) return { type: 'fallback' };
  const best = ranked[0];
  const runnerUp = ranked.length > 1 ? ranked[1].score : 0;
  if (best.score >= ANSWER_MIN - EPS && best.score - runnerUp >= MARGIN_MIN - EPS && n >= 2) {
    return { type: 'answer', entryId: best.id };
  }
  if (best.score >= SUGGEST_MIN - EPS) {
    const entryIds = ranked
      .filter((r) => r.score >= SUGGEST_MIN - EPS)
      .slice(0, MAX_SUGGESTIONS)
      .map((r) => r.id);
    return { type: 'suggest', entryIds };
  }
  return { type: 'fallback' };
}

/** @returns {AskResult} */
export function ask(index, text, ctx) {
  if (typeof text !== 'string') return { type: 'empty' };
  const role = ctx && ctx.role;
  const v = index.view(role);
  const q = prepareQuery(text, v);
  if (q.informativeCount === 0) return { type: 'empty' };
  const reason = classify(text, { role: v.role });
  if (reason) return { type: 'refusal', reason };
  return decide(rankPrepared(v, q), q.informativeCount);
}
