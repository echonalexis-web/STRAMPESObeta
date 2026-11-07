import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_ENTRIES } from './index.js';
import { validateEntries } from './validate.js';
import { CONTACT, telHref, mailtoHref, facebookHref } from '../contact.js';

test('the shipped KB passes the validator', () => {
  assert.deepEqual(validateEntries(ALL_ENTRIES), []);
});

test('no admin or superadmin entry ships in the MVP KB', () => {
  for (const e of ALL_ENTRIES) {
    assert.ok(!e.roles.includes('admin') && !e.roles.includes('superadmin'), e.id);
  }
});

test('policy topics are drafts and carry a policy id; approved entries carry none', () => {
  const drafts = ALL_ENTRIES.filter((e) => e.status === 'draft');
  const policies = new Set(drafts.map((e) => e.policy));
  for (const n of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']) {
    assert.ok(policies.has(`POL-${n}`), `missing draft for POL-${n}`);
  }
  assert.ok(ALL_ENTRIES.filter((e) => e.status === 'approved').every((e) => e.policy === null));
});

test('contact constants and link helpers', () => {
  assert.deepEqual({ ...CONTACT }, { phone: '+63 956 784 4364', email: 'lmdpeso@yahoo.com', facebook: 'LMDPESOMarinduqueOfficial' });
  assert.equal(telHref(), 'tel:+639567844364');
  assert.equal(mailtoHref(), 'mailto:lmdpeso@yahoo.com');
  assert.equal(facebookHref(), 'https://www.facebook.com/LMDPESOMarinduqueOfficial');
});
