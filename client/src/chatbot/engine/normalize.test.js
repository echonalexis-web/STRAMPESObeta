import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from './normalize.js';

test('folds accents and punctuation', () => {
  assert.deepEqual(normalize('Résumé!!!').informative, ['resume']);
});

test('hyphenated Filipino verb prefix', () => {
  assert.deepEqual(normalize('mag-apply').informative, ['apply']);
});

test('phrase synonyms collapse to canonical tokens', () => {
  assert.deepEqual(normalize('curriculum vitae').informative, ['resume']);
  assert.deepEqual(normalize('bio data').informative, ['resume']);
  assert.deepEqual(normalize('how to log in').informative, ['login']);
  assert.deepEqual(normalize('sign up').informative, ['register']);
});

test('worked example 1: Taglish edit profile', () => {
  const r = normalize('Paano mag-edit ng profile ko??');
  assert.deepEqual(r.informative, ['edit', 'profile']);
  assert.equal(r.hasHowCue, true);
  assert.ok(r.filipinoMarkers >= 3);
});

test('word synonyms and stemming', () => {
  assert.deepEqual(normalize('update my profiles').informative, ['edit', 'profile']);
  assert.deepEqual(normalize('applying for vacancies').informative, ['apply', 'job']);
  assert.deepEqual(normalize('applications').informative, ['apply']);
  assert.deepEqual(normalize('trabaho').informative, ['job']);
});

test('short words are not stemmed below 4 letters', () => {
  assert.deepEqual(normalize('bus').informative, ['bus']);
  assert.deepEqual(normalize('access').informative, ['access']);
});

test('tokens keep stop words, informative drops them', () => {
  const r = normalize('how do I apply');
  assert.ok(r.tokens.includes('how'));
  assert.deepEqual(r.informative, ['apply']);
  assert.equal(r.hasHowCue, true);
  assert.equal(normalize('apply').hasHowCue, false);
  assert.equal(normalize('saan ang jobs').hasHowCue, true);
});

test('empty, symbols, emoji', () => {
  assert.deepEqual(normalize('').informative, []);
  assert.deepEqual(normalize('😀😀 !!!').informative, []);
  assert.deepEqual(normalize('the a is').informative, []);
  assert.deepEqual(normalize(null).tokens, []);
  assert.deepEqual(normalize(undefined).tokens, []);
});

test('long input is bounded', () => {
  const t0 = Date.now();
  const r = normalize('resume '.repeat(1000) + 'a'.repeat(5000));
  assert.ok(Date.now() - t0 < 200);
  assert.ok(r.tokens.length <= 24);
  const many = normalize(Array.from({ length: 100 }, (_, i) => 'w' + i).join(' '));
  assert.ok(many.tokens.length <= 24);
});

test('cut at 200 chars', () => {
  const r = normalize('x'.repeat(199) + ' resume');
  assert.deepEqual(r.informative, ['x'.repeat(199)]);
});

test('can\'t splits', () => {
  assert.deepEqual(normalize("can't login").informative, ['login']);
});

test('deterministic and idempotent on canonical output', () => {
  const a = normalize('Paano mag-post ng job?');
  assert.deepEqual(a, normalize('Paano mag-post ng job?'));
  assert.deepEqual(normalize(a.informative.join(' ')).informative, a.informative);
});
