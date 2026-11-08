import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isHiddenPath } from './hiddenPaths.js';

test('hiddenPaths: hides required pages, tolerates case and trailing slash', () => {
  for (const p of ['/messages', '/profile/edit', '/onboarding', '/change-password', '/account-suspended', '/Messages/', '/login']) {
    assert.equal(isHiddenPath(p), true, p);
  }
});

test('hiddenPaths: hides the full-page PESO Help so there is only one chat', () => {
  assert.equal(isHiddenPath('/settings/peso-help'), true);
  assert.equal(isHiddenPath('/settings/peso-help/'), true);
  assert.equal(isHiddenPath('/settings'), false);
});

test('hiddenPaths: shows normal pages', () => {
  for (const p of ['/', '/dashboard', '/jobs', '/profile', '/news/12', '/about', '/employer']) {
    assert.equal(isHiddenPath(p), false, p);
  }
});

test('hiddenPaths: covers every BARE_ROUTES path in App.jsx', () => {
  const src = fs.readFileSync(new URL('../../App.jsx', import.meta.url), 'utf8');
  const m = src.match(/BARE_ROUTES\s*=\s*new Set\(\[([^\]]*)\]/);
  assert.ok(m, 'BARE_ROUTES not found');
  const paths = [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
  assert.ok(paths.length >= 3);
  for (const p of paths) assert.equal(isHiddenPath(p), true, p);
});
