import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEntries } from './validate.js';

const NOW = new Date('2026-11-08T00:00:00Z');
const good = (o = {}) => ({
  id: 'jobseeker.test.one', category: 'profile', kind: 'nav', roles: ['jobseeker'],
  q: { en: 'How do I edit my profile?', fil: 'Paano baguhin ang profile?' },
  a: { en: 'Open Edit Profile.', fil: 'Buksan ang Edit Profile.' },
  keywords: { en: ['edit profile', 'update profile'], fil: ['baguhin profile', 'palitan profile'] },
  target: 'profile.edit', followUps: [], contact: false,
  status: 'approved', policy: null, reviewedAt: '2026-11-08',
  reviewedBy: 'draft-by-claude-pending-PESO-review', priority: 0,
  ...o,
});
const run = (entries) => validateEntries(entries, { now: NOW });
const rejects = (entry, re, others = []) => {
  const problems = run([entry, ...others]);
  assert.ok(problems.some((p) => re.test(p)), `expected /${re}/ in ${JSON.stringify(problems)}`);
};

test('a good entry has no problems', () => {
  assert.deepEqual(run([good()]), []);
});
test('duplicate id', () => rejects(good(), /duplicate id/i, [good()]));
test('bad category', () => rejects(good({ category: 'nope' }), /category/));
test('bad kind', () => rejects(good({ kind: 'x' }), /kind/));
test('empty roles', () => rejects(good({ roles: [] }), /roles/));
test('unknown role', () => rejects(good({ roles: ['guest'] }), /roles/));
test('missing fil question', () => rejects(good({ q: { en: 'x y' } }), /q\.fil/));
test('missing fil answer', () => rejects(good({ a: { en: 'x', fil: '' } }), /a\.fil/));
test('fewer than 2 keywords', () => rejects(good({ keywords: { en: ['one'], fil: ['a', 'b'] } }), /keywords\.en/));
test('steps length mismatch', () => rejects(good({ steps: { en: ['a', 'b'], fil: ['a'] } }), /steps/));
test('unknown route id', () => rejects(good({ target: 'no.such.route' }), /target/));
test('unknown extra target', () => rejects(good({ targets: ['no.such.route'] }), /targets/));
test('too many targets', () => rejects(good({ targets: ['jobs', 'applications', 'messages'] }), /targets/));
test('role cannot reach target (jobseeker -> employer page)', () => rejects(good({ target: 'post-job' }), /reach/));
test('public cannot reach login-only target', () => rejects(good({ roles: ['public'], target: 'profile.edit' }), /reach/));
test('wildcard entry needs a target every role can reach', () => rejects(good({ roles: ['*'], target: 'jobs' }), /reach/));
test('unknown follow-up', () => rejects(good({ followUps: ['nope.nope.nope'] }), /followUps/));
test('follow-up not visible to all roles of the entry', () => {
  const other = good({ id: 'employer.test.two', roles: ['employer'], target: 'post-job' });
  rejects(good({ followUps: ['employer.test.two'] }), /followUps/, [other]);
});
test('follow-up that is a draft', () => {
  const draft = good({ id: 'jobseeker.test.draft', status: 'draft', policy: 'POL-01', reviewedAt: undefined, reviewedBy: undefined });
  rejects(good({ followUps: ['jobseeker.test.draft'] }), /followUps/, [draft]);
});
test('too many follow-ups', () => {
  const ids = ['a', 'b', 'c', 'd'].map((s) => `jobseeker.test.${s}`);
  const others = ids.map((id) => good({ id }));
  rejects(good({ followUps: ids }), /followUps/, others);
});
test('approved with a policy id', () => rejects(good({ policy: 'POL-03' }), /policy/));
test('draft without a policy id', () => rejects(good({ status: 'draft', policy: null }), /policy/));
test('bad status', () => rejects(good({ status: 'maybe' }), /status/));
test('approved without reviewedAt', () => rejects(good({ reviewedAt: undefined }), /reviewedAt/));
test('approved without reviewedBy', () => rejects(good({ reviewedBy: '' }), /reviewedBy/));
test('reviewedBy that is an email', () => rejects(good({ reviewedBy: 'a@b.com' }), /reviewedBy/));
test('stale reviewedAt (> 365 days)', () => rejects(good({ reviewedAt: '2025-01-01' }), /stale|older/i));
test('future reviewedAt', () => rejects(good({ reviewedAt: '2027-01-01' }), /future/i));
test('malformed reviewedAt', () => rejects(good({ reviewedAt: '11/08/2026' }), /reviewedAt/));
test('"<" in text', () => rejects(good({ a: { en: 'a <b>x</b>', fil: 'ok' } }), /forbidden text/));
test('"{{" in text', () => rejects(good({ q: { en: 'Hi {{x}}', fil: 'ok' } }), /forbidden text/));
test('raw http URL in text', () => rejects(good({ a: { en: 'See http://x.test', fil: 'ok' } }), /forbidden text/));
test('forbidden text in keywords and steps', () => {
  rejects(good({ keywords: { en: ['a<b', 'c d'], fil: ['e f', 'g h'] } }), /forbidden text/);
  rejects(good({ steps: { en: ['go to http://x'], fil: ['ok'] } }), /forbidden text/);
});
test('q over 120 chars', () => rejects(good({ q: { en: 'x'.repeat(121), fil: 'ok' } }), /too long/));
test('a over 600 chars', () => rejects(good({ a: { en: 'x'.repeat(601), fil: 'ok' } }), /too long/));
test('step over 160 chars', () => rejects(good({ steps: { en: ['x'.repeat(161)], fil: ['ok'] } }), /too long/));
test('draft entries still get text rules', () => {
  rejects(good({ status: 'draft', policy: 'POL-01', a: { en: 'bad <', fil: 'ok' } }), /forbidden text/);
});
test('valid draft passes', () => {
  assert.deepEqual(run([good({ status: 'draft', policy: 'POL-01', reviewedAt: undefined, reviewedBy: undefined })]), []);
});
