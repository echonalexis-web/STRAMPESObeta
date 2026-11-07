import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVocabulary, correct, distance } from './fuzzy.js';

const vocab = buildVocabulary([
  'apply for a job', 'edit profile', 'verification of employer', 'upload resume',
  'application', 'applet',
]);

test('buildVocabulary uses normalized informative tokens', () => {
  assert.ok(vocab instanceof Set);
  assert.ok(vocab.has('apply'));
  assert.ok(vocab.has('resume'));
  assert.ok(!vocab.has('for'));
});

test('distance is Damerau (transposition = 1)', () => {
  assert.equal(distance('abcd', 'abdc'), 1);
  assert.equal(distance('kitten', 'sitting'), 3);
  assert.equal(distance('', 'abc'), 3);
});

test('corrects 1 edit at length 4', () => {
  assert.deepEqual(correct('aply', vocab), { token: 'apply', corrected: true });
});

test('in-vocab and short tokens unchanged', () => {
  assert.deepEqual(correct('job', vocab), { token: 'job', corrected: false });
  assert.deepEqual(correct('apply', vocab), { token: 'apply', corrected: false });
  assert.deepEqual(correct('jbo', vocab), { token: 'jbo', corrected: false });
});

test('ties rejected', () => {
  const tied = buildVocabulary(['apply', 'apple']);
  assert.deepEqual(correct('appl', tied), { token: 'appl', corrected: false });
  assert.deepEqual(correct('appl', vocab), { token: 'apply', corrected: true });
});

test('first letter must match', () => {
  assert.deepEqual(correct('pply', vocab), { token: 'pply', corrected: false });
});

test('2 edits only at length 8+', () => {
  assert.deepEqual(correct('emplyoar', buildVocabulary(['employer'])), { token: 'employer', corrected: true });
  assert.deepEqual(correct('resme', vocab), { token: 'resume', corrected: true });
  assert.deepEqual(correct('uplxxd', vocab), { token: 'uplxxd', corrected: false });
  assert.deepEqual(correct('profxxle', buildVocabulary(['profile'])), { token: 'profile', corrected: true });
});

test('empty vocab', () => {
  assert.deepEqual(correct('aply', new Set()), { token: 'aply', corrected: false });
});
