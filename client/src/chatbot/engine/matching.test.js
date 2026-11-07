import test from 'node:test';
import assert from 'node:assert/strict';
import KB from './__fixtures__/kb.fixture.js';
import {
  buildIndex, ask, rank, decide, scoreWeights,
  ANSWER_MIN, SUGGEST_MIN, MARGIN_MIN,
} from './index.js';

const index = buildIndex(KB);
const js = { role: 'jobseeker' };

test('threshold constants are pinned', () => {
  assert.equal(ANSWER_MIN, 0.70);
  assert.equal(SUGGEST_MIN, 0.40);
  assert.equal(MARGIN_MIN, 0.10);
});

test('scoring weights are pinned', () => {
  assert.deepEqual(scoreWeights, { question: 0.85, typo: 0.9, phrase: 0.15, hint: 0.05 });
});

test('worked example 1 (Taglish): answer profile.edit with formula-exact runner-up', () => {
  const text = 'Paano mag-edit ng profile ko??';
  assert.deepEqual(ask(index, text, js), { type: 'answer', entryId: 'jobseeker.profile.edit' });
  const ranked = rank(index, text, js);
  assert.equal(ranked[0].id, 'jobseeker.profile.edit');
  assert.equal(ranked[0].score, 1);
  const { idf } = index.view('jobseeker');
  const photo = ranked.find((r) => r.id === 'jobseeker.photo.change');
  // edit matches only via question text (0.85), profile not at all; hint is separate (0.05)
  const expected = (0.85 * idf.get('edit')) / (idf.get('edit') + idf.get('profile'));
  assert.equal(photo.hint, 0.05);
  assert.ok(Math.abs(photo.score - expected) < 1e-9, `${photo.score} vs ${expected}`);
  assert.ok(ranked[0].score - ranked[1].score >= MARGIN_MIN);
});

test('worked example 2 (typo): "how do i aply for a job" answers apply.how', () => {
  assert.deepEqual(ask(index, 'how do i aply for a job', js), { type: 'answer', entryId: 'jobseeker.apply.how' });
});

test('typo-corrected token counts at 0.9 strength', () => {
  const exact = rank(index, 'edit profile', js).find((r) => r.id === 'jobseeker.profile.privacy');
  const typo = rank(index, 'edit profle', js).find((r) => r.id === 'jobseeker.profile.privacy');
  const { idf } = index.view('jobseeker');
  // privacy: only "profile" matches (keyword) -> exact 1.0 vs typo 0.9
  const d = idf.get('profile') / (idf.get('edit') + idf.get('profile'));
  assert.ok(Math.abs(exact.score - d) < 1e-9);
  assert.ok(Math.abs(typo.score - 0.9 * d) < 1e-9);
  assert.equal(ask(index, 'edit profle', js).entryId, 'jobseeker.profile.edit');
});

test('decide: exactly 0.70 with margin >= 0.10 and 2 tokens is answer', () => {
  const r = decide([{ id: 'a', score: 0.70 }, { id: 'b', score: 0.60 }], 2);
  assert.deepEqual(r, { type: 'answer', entryId: 'a' });
});

test('decide: 0.69 is only suggest', () => {
  const r = decide([{ id: 'a', score: 0.69 }, { id: 'b', score: 0.30 }], 2);
  assert.equal(r.type, 'suggest');
  assert.deepEqual(r.entryIds, ['a']);
});

test('decide: margin 0.10 passes, 0.09 becomes suggest with both chips', () => {
  assert.equal(decide([{ id: 'a', score: 0.9 }, { id: 'b', score: 0.8 }], 2).type, 'answer');
  const r = decide([{ id: 'a', score: 0.9 }, { id: 'b', score: 0.81 }], 2);
  assert.deepEqual(r, { type: 'suggest', entryIds: ['a', 'b'] });
});

test('decide: one informative token never answers; below 0.40 is fallback', () => {
  assert.equal(decide([{ id: 'a', score: 1 }], 1).type, 'suggest');
  assert.deepEqual(decide([{ id: 'a', score: 0.39 }], 3), { type: 'fallback' });
  assert.equal(decide([{ id: 'a', score: 0.40 }], 3).type, 'suggest');
  assert.deepEqual(decide([], 3), { type: 'fallback' });
});

test('decide: suggest caps at 3 chips', () => {
  const ranked = ['a', 'b', 'c', 'd'].map((id) => ({ id, score: 0.95 }));
  assert.equal(decide(ranked, 2).entryIds.length, 3);
});

test('tie-break: score, then smaller entry, then priority, then id', () => {
  const mk = (id, extra = {}) => ({
    id, category: 'profile', kind: 'faq', roles: ['*'], status: 'approved', priority: 0,
    q: { en: 'Zebra question', fil: 'Zebra tanong' }, a: { en: 'x', fil: 'x' },
    keywords: { en: ['zebra stripes', 'zebra'], fil: ['zebra guhit', 'zebra'] }, ...extra,
  });
  const ids = (entries) => rank(buildIndex(entries), 'zebra', { role: 'public' }).map((r) => r.id);
  assert.deepEqual(ids([mk('b'), mk('a')]), ['a', 'b']);
  assert.deepEqual(ids([mk('a'), mk('b', { priority: 2 })]), ['b', 'a']);
  // smaller index size (fewer distinct tokens) wins
  const small = mk('z', { q: { en: 'Zebra', fil: 'Zebra' }, keywords: { en: ['zebra', 'zebra'], fil: ['zebra', 'zebra'] } });
  assert.deepEqual(ids([mk('a'), small]), ['z', 'a']);
});

test('phrase bonus applies for contiguous multi-token keyword phrase', () => {
  const ranked = rank(index, 'upload resume', js);
  assert.equal(ranked[0].id, 'jobseeker.resume.upload');
  assert.equal(ranked[0].score, 1); // coverage 1 + 0.15 capped
  const delta = rank(index, 'resume upload', js).find((r) => r.id === 'jobseeker.resume.delete');
  assert.ok(delta.score < 1);
});

test('single word "profile" returns suggest, not answer', () => {
  const r = ask(index, 'profile', js);
  assert.equal(r.type, 'suggest');
  assert.ok(r.entryIds.includes('jobseeker.profile.edit'));
});

test('empty, symbol-only and emoji-only input is empty', () => {
  for (const t of ['', '   ', '???', '\u{1F600}\u{1F600}\u{1F600}', 'the a how do i']) {
    assert.deepEqual(ask(index, t, js), { type: 'empty' }, t);
  }
  assert.deepEqual(ask(index, null, js), { type: 'empty' });
});

test('gibberish and non-Latin text fall back', () => {
  assert.deepEqual(ask(index, 'asdfghjkl', js), { type: 'fallback' });
  assert.ok(['fallback', 'empty'].includes(ask(index, 'مرحبا', js).type));
});

test('resume and CV give the same result (synonym)', () => {
  const a = ask(index, 'resume', js);
  const b = ask(index, 'CV', js);
  assert.deepEqual(a, b);
  assert.equal(a.type, 'suggest');
});

test('how-to check application status answers applications.status', () => {
  assert.deepEqual(ask(index, 'how do I check my application status', js),
    { type: 'answer', entryId: 'jobseeker.applications.status' });
});

test('Taglish variants hit the same entry as the English question', () => {
  const top = (r) => (r.type === 'answer' ? r.entryId : r.entryIds[0]);
  const ref = top(ask(index, 'how do i apply for a job', js));
  assert.equal(ref, 'jobseeker.apply.how');
  for (const t of ['paano mag apply', 'paano mag-apply', 'paanu mag aply']) {
    assert.equal(top(ask(index, t, js)), ref, t);
  }
});

test('casing and accents normalize equally', () => {
  const r = ask(index, 'RESUME!!!', js);
  assert.deepEqual(ask(index, 'rEsUmE', js), r);
  assert.deepEqual(ask(index, 'résumé', js), r);
});

test('draft entry never matches its own question', () => {
  for (const t of ['How do I redeem loyalty stars?', 'loyalty stars', 'Paano i-redeem ang loyalty stars?']) {
    const r = ask(index, t, js);
    const ids = r.type === 'answer' ? [r.entryId] : r.entryIds || [];
    assert.ok(!ids.includes('jobseeker.draft.stars'), t);
    assert.ok(!rank(index, t, js).some((x) => x.id === 'jobseeker.draft.stars'));
  }
});

test('5,000-char input finishes fast and falls back', () => {
  const t0 = performance.now();
  const r = ask(index, 'a'.repeat(5000), js);
  const r2 = ask(index, 'profile '.repeat(700), js);
  assert.ok(performance.now() - t0 < 200);
  assert.deepEqual(r, { type: 'fallback' });
  assert.ok(['suggest', 'fallback'].includes(r2.type));
});

test('markup input does not throw and gets a plain result', () => {
  const r = ask(index, '<script>alert(1)</script>', js);
  assert.equal(r.type, 'fallback');
});

test('hint cannot rescue: base 0.667 stays suggest, base 0.365 stays fallback', () => {
  const t1 = 'how profile resume edit';
  const r1 = rank(index, t1, js)[0];
  assert.ok(r1.score > 0.65 && r1.score < ANSWER_MIN && r1.score + r1.hint >= ANSWER_MIN);
  assert.equal(ask(index, t1, js).type, 'suggest');
  const t2 = 'how profile upload blorp';
  const r2 = rank(index, t2, js)[0];
  assert.ok(r2.score > 0.35 && r2.score < SUGGEST_MIN && r2.score + r2.hint >= SUGGEST_MIN);
  assert.deepEqual(ask(index, t2, js), { type: 'fallback' });
});

test('hint does not enter the margin, only ordering', () => {
  const r = rank(index, 'how profile resume edit', js);
  assert.ok(r.every((x) => x.hint === 0 || x.hint === 0.05));
  const noHint = rank(index, 'profile resume edit', js);
  assert.equal(r[0].score, noHint[0].score);
});
