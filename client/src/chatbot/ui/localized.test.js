import test from 'node:test';
import assert from 'node:assert/strict';
import { pickText, pickSteps, paragraphs, isVisibleTo } from './localized.js';

test('pickText: uses the locale text', () => {
  assert.deepEqual(pickText({ en: 'a', fil: 'b' }, 'fil'), { text: 'b', english: false });
});
test('pickText: empty Filipino falls back to tagged English', () => {
  assert.deepEqual(pickText({ en: 'a', fil: '  ' }, 'fil'), { text: 'a', english: true });
  assert.deepEqual(pickText({ en: 'a' }, 'en'), { text: 'a', english: false });
});
test('pickSteps: falls back to English when Filipino list is empty', () => {
  assert.deepEqual(pickSteps({ en: ['x'], fil: [] }, 'fil'), { items: ['x'], english: true });
  assert.deepEqual(pickSteps(undefined, 'fil'), { items: [], english: false });
});
test('paragraphs: splits on blank lines', () => {
  assert.deepEqual(paragraphs('a\n\nb\n\n\nc'), ['a', 'b', 'c']);
  assert.deepEqual(paragraphs(''), []);
});
test('isVisibleTo: wildcard and role', () => {
  assert.equal(isVisibleTo({ roles: ['*'] }, 'public'), true);
  assert.equal(isVisibleTo({ roles: ['employer'] }, 'jobseeker'), false);
  assert.equal(isVisibleTo(undefined, 'public'), false);
});
