import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FLOATING_HELP_KEY,
  readFloatingHelp,
  resetFloatingHelpMemory,
  writeFloatingHelp,
} from './floatingHelpPref.js';

const fakeStorage = (initial = {}) => {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data,
  };
};
const brokenStorage = () => ({
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
});

test.beforeEach(() => resetFloatingHelpMemory());

test('default is ON when nothing is stored', () => {
  assert.equal(readFloatingHelp(fakeStorage()), true);
});

test('set OFF then ON, and read it back', () => {
  const s = fakeStorage();
  writeFloatingHelp(false, s);
  assert.equal(s.data[FLOATING_HELP_KEY], 'off');
  assert.equal(readFloatingHelp(s), false);
  writeFloatingHelp(true, s);
  assert.equal(readFloatingHelp(s), true);
});

test('unknown stored values fall back to ON', () => {
  assert.equal(readFloatingHelp(fakeStorage({ [FLOATING_HELP_KEY]: 'banana' })), true);
});

test('storage that throws falls back to ON', () => {
  assert.equal(readFloatingHelp(brokenStorage()), true);
});

test('missing storage (null) falls back to ON', () => {
  assert.equal(readFloatingHelp(null), true);
});

test('when storage is blocked the choice still works in memory for this page', () => {
  const s = brokenStorage();
  writeFloatingHelp(false, s);
  assert.equal(readFloatingHelp(s), false);
  writeFloatingHelp(true, s);
  assert.equal(readFloatingHelp(s), true);
});

test('a successful write clears any earlier in-memory fallback', () => {
  writeFloatingHelp(false, brokenStorage());
  const good = fakeStorage();
  writeFloatingHelp(true, good);
  assert.equal(readFloatingHelp(fakeStorage()), true);
});
