// Self-match, collision, scope-clash and visibility checks over the shipped KB.
// Each test collects every problem so one run lists all of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_ENTRIES } from './index.js';
import { buildIndex, ask, rank, MARGIN_MIN } from '../engine/index.js';
import { classify } from '../engine/scope.js';
import { ROLE_NAMES } from './categories.js';

const ROLES = ['public', 'jobseeker', 'employer'];
const approved = ALL_ENTRIES.filter((e) => e.status === 'approved');
const index = buildIndex(ALL_ENTRIES);
const sees = (e, role) => e.roles.includes('*') || e.roles.includes(role);
const visible = (role) => approved.filter((e) => sees(e, role));
const EPS = 1e-9;

test('every audience has entries', () => {
  for (const role of ROLES) assert.ok(visible(role).length >= 8, role);
});

test('own q.en and q.fil resolve to the entry as an answer, for every role that sees it', () => {
  const bad = [];
  for (const role of ROLES) {
    for (const e of visible(role)) {
      for (const lang of ['en', 'fil']) {
        const r = ask(index, e.q[lang], { role });
        if (r.type !== 'answer' || r.entryId !== e.id) {
          bad.push(`[${role}] ${e.id} q.${lang} "${e.q[lang]}" -> ${JSON.stringify(r)}`);
        }
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('every keyword phrase ranks its own entry strictly first', () => {
  const bad = [];
  for (const role of ROLES) {
    for (const e of visible(role)) {
      for (const lang of ['en', 'fil']) {
        for (const kw of e.keywords[lang]) {
          const [top, second] = rank(index, kw, { role });
          if (!top || top.id !== e.id) {
            bad.push(`[${role}] ${e.id} keyword "${kw}" ranked ${top ? top.id : 'nothing'} first`);
          } else if (second && top.score + top.hint <= second.score + second.hint + EPS) {
            bad.push(`[${role}] ${e.id} keyword "${kw}" ties with ${second.id}`);
          }
        }
      }
    }
  }
  assert.deepEqual(bad, []);
});

test("collision rule: no two visible entries score within the margin on each other's q", () => {
  const bad = [];
  for (const role of ROLES) {
    for (const a of visible(role)) {
      for (const lang of ['en', 'fil']) {
        const ranked = rank(index, a.q[lang], { role });
        const self = ranked.find((r) => r.id === a.id);
        if (!self) { bad.push(`[${role}] ${a.id} q.${lang} does not match itself`); continue; }
        for (const r of ranked) {
          if (r.id === a.id) continue;
          if (self.score - r.score < MARGIN_MIN - EPS) {
            bad.push(`[${role}] ${a.id} q.${lang} is within ${MARGIN_MIN} of ${r.id} (${self.score.toFixed(2)} vs ${r.score.toFixed(2)})`);
          }
        }
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('no approved q or keyword trips a scope refusal (classify returns null)', () => {
  const bad = [];
  for (const role of ROLES) {
    for (const e of visible(role)) {
      const texts = [e.q.en, e.q.fil, ...e.keywords.en, ...e.keywords.fil];
      for (const t of texts) {
        const c = classify(t, { role });
        if (c !== null) bad.push(`[${role}] ${e.id} "${t}" would be refused as ${c}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('role visibility: public sees no jobseeker/employer-only entry, and vice versa', () => {
  const pubIds = new Set(visible('public').map((e) => e.id));
  const jsIds = new Set(visible('jobseeker').map((e) => e.id));
  const empIds = new Set(visible('employer').map((e) => e.id));
  for (const e of approved) {
    const only = e.roles.length === 1 ? e.roles[0] : null;
    if (e.roles.every((r) => r !== '*' && r !== 'public')) assert.ok(!pubIds.has(e.id), `${e.id} leaks to public`);
    if (only === 'employer') assert.ok(!jsIds.has(e.id) && !pubIds.has(e.id), `${e.id} leaks`);
    if (only === 'jobseeker') assert.ok(!empIds.has(e.id) && !pubIds.has(e.id), `${e.id} leaks`);
    if (only === 'public') assert.ok(!jsIds.has(e.id) && !empIds.has(e.id), `${e.id} public-only entry leaks to logged-in roles`);
  }
  assert.ok(approved.some((e) => e.roles.length === 1 && e.roles[0] === 'public'));
  assert.ok(approved.some((e) => e.roles.length === 1 && e.roles[0] === 'jobseeker'));
  assert.ok(approved.some((e) => e.roles.length === 1 && e.roles[0] === 'employer'));
  // Engine level: role-gated questions never get their gated answer from the wrong view.
  const r = ask(index, 'How do I edit my profile?', { role: 'public' });
  assert.notEqual(r.type, 'answer');
  const r2 = ask(index, 'How do I post a job vacancy?', { role: 'jobseeker' });
  assert.ok(r2.type !== 'answer' || r2.entryId !== 'employer.post.how');
  const r3 = ask(index, 'How do I register as a jobseeker?', { role: 'employer' });
  assert.ok(r3.type !== 'answer' || r3.entryId !== 'public.register.jobseeker');
});

test('drafts never match, for any role', () => {
  const drafts = ALL_ENTRIES.filter((e) => e.status === 'draft');
  assert.ok(drafts.length >= 10);
  for (const d of drafts) {
    for (const role of ROLES) {
      for (const text of [d.q.en, d.q.fil, ...d.keywords.en, ...d.keywords.fil]) {
        assert.ok(!rank(index, text, { role }).some((r) => r.id === d.id), `${d.id} matched "${text}"`);
        const r = ask(index, text, { role });
        assert.ok(!(r.type === 'answer' && r.entryId === d.id));
        if (r.type === 'suggest') assert.ok(!r.entryIds.includes(d.id));
      }
    }
  }
});

test('ROLE_NAMES stays in sync with the engine roles', () => {
  assert.deepEqual([...ROLE_NAMES].sort(), ['admin', 'employer', 'jobseeker', 'public', 'superadmin']);
});
