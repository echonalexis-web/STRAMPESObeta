import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapUserToChatContext, ctxKeyOf } from './ui/chatContextFromUser.js';

const yearsAgo = (n) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  d.setDate(d.getDate() - 2);
  return d.toISOString();
};

test('null user gives public with safe defaults', () => {
  const c = mapUserToChatContext(null, 'en');
  assert.equal(c.role, 'public');
  assert.equal(c.onboardingDone, true);
  assert.equal(c.mustChangePassword, false);
  assert.equal(c.verifiedEmployer, false);
  assert.equal(c.canViewJobs, false);
  assert.equal(c.canApplySpes, false);
});

test('role mapping and unknown gives public', () => {
  for (const r of ['jobseeker', 'employer', 'admin', 'superadmin'])
    assert.equal(mapUserToChatContext({ role: r }, 'en').role, r);
  assert.equal(mapUserToChatContext({ role: 'wizard' }, 'en').role, 'public');
  assert.equal(mapUserToChatContext({}, 'en').role, 'public');
  assert.equal(mapUserToChatContext({ role: 42 }, 'en').role, 'public');
});

test('verifiedEmployer only for verified employer', () => {
  assert.equal(mapUserToChatContext({ role: 'employer', verificationStatus: 'verified' }, 'en').verifiedEmployer, true);
  assert.equal(mapUserToChatContext({ role: 'employer', verificationStatus: 'pending' }, 'en').verifiedEmployer, false);
  assert.equal(mapUserToChatContext({ role: 'jobseeker', verificationStatus: 'verified' }, 'en').verifiedEmployer, false);
});

test('onboarding flag variants', () => {
  const f = (u) => mapUserToChatContext({ role: 'jobseeker', ...u }, 'en').onboardingDone;
  assert.equal(f({}), true);
  assert.equal(f({ hasCompletedOnboarding: false }), false);
  assert.equal(f({ hasCompletedOnboarding: true }), true);
  assert.equal(f({ onboardingComplete: false }), false);
  assert.equal(f({ onboardingComplete: true }), true);
  assert.equal(f({ hasCompletedOnboarding: true, onboardingComplete: false }), true);
  assert.equal(f({ hasCompletedOnboarding: false, onboardingComplete: true }), false);
});

test('mustChangePassword strict true', () => {
  assert.equal(mapUserToChatContext({ role: 'admin', mustChangePassword: true }, 'en').mustChangePassword, true);
  assert.equal(mapUserToChatContext({ role: 'admin', mustChangePassword: 'yes' }, 'en').mustChangePassword, false);
});

test('age flags from dateOfBirth', () => {
  const f = (n) => mapUserToChatContext({ role: 'jobseeker', dateOfBirth: yearsAgo(n) }, 'en');
  assert.deepEqual([f(16).canViewJobs, f(16).canApplySpes], [false, true]);
  assert.deepEqual([f(25).canViewJobs, f(25).canApplySpes], [true, true]);
  assert.deepEqual([f(40).canViewJobs, f(40).canApplySpes], [true, false]);
  assert.equal(mapUserToChatContext({ role: 'jobseeker' }, 'en').canViewJobs, false);
});

test('locale mapping', () => {
  const l = (x) => mapUserToChatContext(null, x).locale;
  assert.equal(l('fil'), 'fil');
  assert.equal(l('fil-PH'), 'fil');
  assert.equal(l('tl'), 'fil');
  assert.equal(l('en-US'), 'en');
  assert.equal(l(undefined), 'en');
  assert.equal(l('de'), 'en');
});

test('ctxKey changes with role/verification/locale, stable otherwise', () => {
  const k = (u, lang = 'en') => ctxKeyOf(mapUserToChatContext(u, lang));
  const base = { role: 'employer', verificationStatus: 'pending' };
  assert.equal(k(base), k({ ...base, name: 'other', extra: 1 }));
  assert.notEqual(k(base), k({ ...base, verificationStatus: 'verified' }));
  assert.notEqual(k(base), k({ ...base, role: 'jobseeker' }));
  assert.notEqual(k(base), k(base, 'fil'));
});

test('user object and extra fields never returned', () => {
  const user = { role: 'jobseeker', email: 'a@b.c', token: 'secret', dateOfBirth: yearsAgo(25) };
  const c = mapUserToChatContext(user, 'en');
  assert.deepEqual(Object.keys(c).sort(), ['canApplySpes', 'canViewJobs', 'locale', 'mustChangePassword', 'onboardingDone', 'role', 'verifiedEmployer']);
  assert.ok(!JSON.stringify(c).includes('secret'));
  assert.ok(!Object.values(c).includes(user));
});
