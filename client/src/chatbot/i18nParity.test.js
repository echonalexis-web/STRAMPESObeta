import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ROUTES } from './routes/registry.js';

const load = (l) =>
  JSON.parse(fs.readFileSync(new URL(`../i18n/locales/${l}.json`, import.meta.url), 'utf8'));
const en = load('en');
const fil = load('fil');

function flat(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') Object.assign(out, flat(v, key));
    else out[key] = v;
  }
  return out;
}
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

test('i18n: chatbot.* keys match between en and fil', () => {
  assert.ok(en.chatbot && fil.chatbot, 'chatbot block missing');
  const a = Object.keys(flat(en.chatbot)).sort();
  const b = Object.keys(flat(fil.chatbot)).sort();
  assert.deepEqual(b, a);
});

test('i18n: every chatbot string is a non-empty string', () => {
  for (const [name, loc] of [['en', en], ['fil', fil]]) {
    for (const [k, v] of Object.entries(flat(loc.chatbot))) {
      assert.equal(typeof v, 'string', `${name} ${k}`);
      assert.ok(v.trim().length > 0, `${name} ${k} empty`);
    }
  }
});

test('i18n: every registry labelKey resolves in both locales', () => {
  for (const r of ROUTES) {
    for (const [name, loc] of [['en', en], ['fil', fil]]) {
      const v = get(loc, r.labelKey);
      assert.equal(typeof v, 'string', `${name} missing ${r.labelKey} (${r.id})`);
      if (r.labelKey.startsWith('chatbot.routes.')) assert.ok(v.length > 0);
    }
  }
});

test('i18n: blocked reasons and refusal reasons all have copy', () => {
  for (const k of ['onboarding', 'password', 'verification', 'age-min', 'age-max']) {
    assert.ok(en.chatbot.blocked[k] && fil.chatbot.blocked[k], k);
  }
  for (const k of ['account-data', 'action', 'recommendation', 'legal', 'general', 'people', 'probe']) {
    assert.ok(en.chatbot.refusal[k] && fil.chatbot.refusal[k], k);
  }
});
