import test from 'node:test';
import assert from 'node:assert/strict';
import { STARTERS, startersFor } from './starters.js';
import { ALL_ENTRIES } from '../kb/index.js';

const byId = new Map(ALL_ENTRIES.map((e) => [e.id, e]));

for (const [role, ids] of Object.entries(STARTERS)) {
  test(`starters: ${role} has 3 approved ids visible to the role`, () => {
    assert.equal(ids.length, 3);
    assert.equal(new Set(ids).size, 3);
    for (const id of ids) {
      const e = byId.get(id);
      assert.ok(e, `${id} missing from ALL_ENTRIES`);
      assert.equal(e.status, 'approved', `${id} not approved`);
      assert.ok(e.roles.includes('*') || e.roles.includes(role), `${id} not visible to ${role}`);
    }
  });
}

test('starters: unknown role falls back to public', () => {
  assert.equal(startersFor('admin'), STARTERS.public);
});
