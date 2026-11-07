import test from 'node:test';
import assert from 'node:assert/strict';
import KB from './__fixtures__/kb.fixture.js';
import { buildIndex, ask, rank } from './index.js';

const index = buildIndex(KB);
const ROLES = ['public', 'jobseeker', 'employer', 'admin', 'superadmin'];

function visible(role) {
  return KB.filter((e) => e.status === 'approved' && (e.roles.includes('*') || e.roles.includes(role))).map((e) => e.id);
}

test('rank only ever contains entries visible to the role', () => {
  const queries = ['profile', 'post job', 'audit log', 'approve employer', 'contact peso', 'apply job', 'log in', 'resume'];
  for (const role of ROLES) {
    const ok = new Set(visible(role));
    for (const q of queries) {
      for (const r of rank(index, q, { role })) assert.ok(ok.has(r.id), `${role}/${q}/${r.id}`);
      const res = ask(index, q, { role });
      const ids = res.type === 'answer' ? [res.entryId] : res.entryIds || [];
      for (const id of ids) assert.ok(ok.has(id), `${role}/${q}/${id}`);
    }
  }
});

test('"*" entries match everyone including public', () => {
  for (const role of ROLES) {
    const r = ask(index, 'how do I contact peso', { role });
    assert.deepEqual(r, { type: 'answer', entryId: 'general.contact.peso' }, role);
  }
});

test('employer-only entry answers employers, not jobseekers or public', () => {
  assert.deepEqual(ask(index, 'how do I post a job', { role: 'employer' }), { type: 'answer', entryId: 'employer.job.post' });
  for (const role of ['jobseeker', 'public']) {
    const r = ask(index, 'how do I post a job', { role });
    const ids = r.type === 'answer' ? [r.entryId] : r.entryIds || [];
    assert.ok(!ids.some((id) => id.startsWith('employer.')), role);
  }
});

test('public visitor gets login entry, jobseeker does not', () => {
  assert.equal(ask(index, 'how do I log in to my account', { role: 'public' }).entryId, 'public.account.login');
  const js = ask(index, 'how do I log in to my account', { role: 'jobseeker' });
  assert.ok(js.type !== 'answer');
});

test('admin entries are visible to staff only', () => {
  assert.equal(ask(index, 'where is the audit log', { role: 'admin' }).entryId, 'admin.audit.log');
  assert.equal(ask(index, 'where is the audit log', { role: 'superadmin' }).entryId, 'admin.audit.log');
});

test('unknown role is treated as public', () => {
  assert.equal(ask(index, 'how do I log in to my account', { role: 'weird' }).entryId, 'public.account.login');
  assert.equal(ask(index, 'how do I log in to my account', {}).entryId, 'public.account.login');
});

test('idf is computed over visible entries only (no leak from hidden ones)', () => {
  const a = buildIndex(KB).view('jobseeker').idf;
  const b = buildIndex(KB.filter((e) => !e.roles.includes('employer') && !e.roles.includes('admin'))).view('jobseeker').idf;
  assert.deepEqual([...a.entries()], [...b.entries()]);
});
