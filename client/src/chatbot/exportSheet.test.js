import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSheet } from '../../scripts/lib/renderKbSheet.mjs';
import { ALL_ENTRIES } from './kb/index.js';
import { ROUTES } from './routes/registry.js';
import { CATEGORIES } from './kb/categories.js';
import { CONTACT } from './contact.js';

const opts = { date: '2026-01-01', contact: CONTACT, categories: CATEGORIES, label: (k) => `L:${k}` };
const out = renderSheet(ALL_ENTRIES, ROUTES, opts);

test('every entry id appears exactly once as a row', () => {
  for (const e of ALL_ENTRIES) {
    const n = out.split(`| \`${e.id}\` |`).length - 1;
    assert.equal(n, 1, e.id);
  }
});

test('drafts are marked with their policy id', () => {
  const drafts = ALL_ENTRIES.filter((e) => e.status === 'draft');
  assert.ok(drafts.length > 0);
  for (const d of drafts) assert.ok(out.includes(`DRAFT - needs PESO decision ${d.policy}`), d.id);
});

test('pipes and newlines are escaped in cells', () => {
  const fake = [{
    id: 'x.y.z', category: 'profile', roles: ['jobseeker'], status: 'approved', policy: null,
    reviewedAt: '2026-01-01', q: { en: 'a|b', fil: 'c' }, a: { en: 'l1\n\nl2', fil: 'd|e' },
    steps: { en: ['s|1'], fil: ['t'] }, keywords: { en: ['k|1', 'k2'], fil: ['f1', 'f2'] },
  }];
  const s = renderSheet(fake, ROUTES, opts);
  const row = s.split('\n').find((l) => l.includes('`x.y.z`'));
  assert.ok(row.includes('a\\|b') && row.includes('d\\|e') && row.includes('s\\|1'));
  assert.equal(row.replace(/\\\|/g, '').split('|').length, 14);
});

test('output is deterministic and input order independent', () => {
  assert.equal(renderSheet(ALL_ENTRIES, ROUTES, opts), out);
  assert.equal(renderSheet([...ALL_ENTRIES].reverse(), ROUTES, opts), out);
});
