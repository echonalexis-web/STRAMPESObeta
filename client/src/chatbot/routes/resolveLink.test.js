import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLink } from './resolveLink.js';

const base = {
  role: 'jobseeker', onboardingDone: true, mustChangePassword: false,
  verifiedEmployer: false, canViewJobs: true, canApplySpes: true, locale: 'en',
};
const ctx = (over) => ({ ...base, ...over });
const link = (routeId, path) => ({ kind: 'link', routeId, path });

test('public route is a link for everyone, including logged out', () => {
  assert.deepEqual(resolveLink('about', ctx({ role: 'public' })), link('about', '/about'));
  assert.deepEqual(resolveLink('login', ctx({ role: 'public' })), link('login', '/login'));
  assert.deepEqual(resolveLink('news', ctx({ role: 'jobseeker' })), link('news', '/news'));
});

test('logged out + auth route -> login', () => {
  assert.deepEqual(resolveLink('jobs', ctx({ role: 'public' })), { kind: 'login', path: '/login' });
  assert.deepEqual(resolveLink('settings', ctx({ role: 'public' })), { kind: 'login', path: '/login' });
});

test('mustChangePassword blocks auth routes, except change-password itself', () => {
  const c = ctx({ mustChangePassword: true });
  assert.deepEqual(resolveLink('jobs', c), {
    kind: 'blocked', reason: 'password', alternative: link('change-password', '/change-password'),
  });
  assert.deepEqual(resolveLink('change-password', c), link('change-password', '/change-password'));
});

test('jobseeker mid-onboarding: everything auth except /onboarding blocked', () => {
  const c = ctx({ onboardingDone: false });
  assert.deepEqual(resolveLink('dashboard', c), {
    kind: 'blocked', reason: 'onboarding', alternative: link('onboarding', '/onboarding'),
  });
  assert.equal(resolveLink('settings', c).reason, 'onboarding');
  assert.deepEqual(resolveLink('onboarding', c), link('onboarding', '/onboarding'));
  // public routes are not wrapped in ProtectedRoute
  assert.deepEqual(resolveLink('news', c), link('news', '/news'));
});

test('employer mid-onboarding: only employer dashboard and post-job blocked', () => {
  const c = ctx({ role: 'employer', onboardingDone: false, verifiedEmployer: true });
  const blocked = { kind: 'blocked', reason: 'onboarding', alternative: link('onboarding', '/onboarding') };
  assert.deepEqual(resolveLink('employer.dashboard', c), blocked);
  assert.deepEqual(resolveLink('post-job', c), blocked);
  assert.deepEqual(resolveLink('settings', c), link('settings', '/settings'));
  assert.deepEqual(resolveLink('messages', c), link('messages', '/messages'));
});

test('unverified employer + post-job -> verification, alt My Profile', () => {
  const c = ctx({ role: 'employer', verifiedEmployer: false });
  assert.deepEqual(resolveLink('post-job', c), {
    kind: 'blocked', reason: 'verification', alternative: link('profile', '/profile'),
  });
  assert.deepEqual(resolveLink('employer.dashboard', c), link('employer.dashboard', '/employer'));
});

test('verified employer can open post-job', () => {
  const c = ctx({ role: 'employer', verifiedEmployer: true });
  assert.deepEqual(resolveLink('post-job', c), link('post-job', '/post-job'));
});

test('jobseeker under 18: jobs and applications blocked age-min', () => {
  const young = ctx({ canViewJobs: false, canApplySpes: true });
  const expected = { kind: 'blocked', reason: 'age-min', alternative: link('spes.mine', '/spes/applications') };
  assert.deepEqual(resolveLink('jobs', young), expected);
  assert.deepEqual(resolveLink('applications', young), expected);
  const noSpes = ctx({ canViewJobs: false, canApplySpes: false });
  assert.deepEqual(resolveLink('jobs', noSpes), {
    kind: 'blocked', reason: 'age-min', alternative: link('news', '/news'),
  });
});

test('jobseeker over 30: SPES blocked age-max, alt jobs', () => {
  const old = ctx({ canViewJobs: true, canApplySpes: false });
  assert.deepEqual(resolveLink('spes.mine', old), {
    kind: 'blocked', reason: 'age-max', alternative: link('jobs', '/jobs'),
  });
  assert.deepEqual(resolveLink('jobs', old), link('jobs', '/jobs'));
});

test('eligible jobseeker opens jobs, applications, spes, dashboard', () => {
  assert.deepEqual(resolveLink('jobs', ctx()), link('jobs', '/jobs'));
  assert.deepEqual(resolveLink('applications', ctx()), link('applications', '/applications'));
  assert.deepEqual(resolveLink('spes.mine', ctx()), link('spes.mine', '/spes/applications'));
  assert.deepEqual(resolveLink('dashboard', ctx()), link('dashboard', '/dashboard'));
});

test('role mismatch -> hidden', () => {
  assert.deepEqual(resolveLink('dashboard', ctx({ role: 'employer' })), { kind: 'hidden' });
  assert.deepEqual(resolveLink('post-job', ctx({ role: 'jobseeker' })), { kind: 'hidden' });
  assert.deepEqual(resolveLink('profile.resume', ctx({ role: 'employer' })), { kind: 'hidden' });
  assert.deepEqual(resolveLink('jobs', ctx({ role: 'admin' })), { kind: 'hidden' });
});

test('any-role auth route is a link for employer', () => {
  assert.deepEqual(resolveLink('profile.edit', ctx({ role: 'employer' })), link('profile.edit', '/profile/edit'));
});

test('unknown route id -> hidden', () => {
  assert.deepEqual(resolveLink('nope', ctx()), { kind: 'hidden' });
});
