import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ROUTES, EXCLUDED, getRoute } from './registry.js';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const appSrc = read('../../App.jsx');

// Linear scan: one <Route ... /> per line in App.jsx.
function parseAppRoutes(src) {
  const out = [];
  for (const line of src.split('\n')) {
    const p = /<Route\s+path="([^"]+)"/.exec(line);
    if (!p) continue;
    const r = /requiredRole=(?:"([a-z]+)"|\{\[([^\]]*)\]\})/.exec(line);
    let roles = null;
    if (r) roles = r[1] ? [r[1]] : r[2].split(',').map((s) => s.trim().replace(/"/g, '')).filter(Boolean);
    out.push({ path: p[1], roles, line });
  }
  return out;
}

const appRoutes = parseAppRoutes(appSrc);
const isStatic = (p) => !p.includes(':') && !p.includes('*');
const sorted = (a) => (a ? [...a].sort() : null);

// navbar.* keys must exist in both locales. chatbot.routes.* keys are added to
// the locale files by Task 7, so they are allow-listed here until then.
const PENDING_CHATBOT_LABEL_KEYS = [
  'chatbot.routes.login', 'chatbot.routes.register', 'chatbot.routes.registerEmployer',
  'chatbot.routes.forgotPassword', 'chatbot.routes.about', 'chatbot.routes.privacy',
  'chatbot.routes.terms', 'chatbot.routes.cookies', 'chatbot.routes.accountRecovery',
  'chatbot.routes.changePassword', 'chatbot.routes.onboarding',
  'chatbot.routes.profileFavorites', 'chatbot.routes.profileLikes',
  'chatbot.routes.profileFollowers', 'chatbot.routes.profileDocuments',
  'chatbot.routes.profileEdit', 'chatbot.routes.profileResume',
];

test('app parser finds routes', () => {
  assert.ok(appRoutes.length > 40);
  assert.ok(appRoutes.some((r) => r.path === '/post-job' && r.roles?.[0] === 'employer'));
  assert.deepEqual(appRoutes.find((r) => r.path === '/admin').roles, ['admin', 'superadmin']);
});

test('registry ids unique, getRoute works', () => {
  const ids = ROUTES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(getRoute('jobs').path, '/jobs');
  assert.equal(getRoute('missing'), undefined);
});

test('every registry path exists in App.jsx', () => {
  const paths = new Set(appRoutes.map((r) => r.path));
  for (const r of ROUTES) assert.ok(paths.has(r.path), `${r.id} -> ${r.path} not in App.jsx`);
});

test('registry required roles match App.jsx', () => {
  for (const r of ROUTES) {
    const app = appRoutes.find((a) => a.path === r.path);
    assert.deepEqual(sorted(r.roles), sorted(app.roles), `${r.id} roles drifted`);
  }
});

test('registry access matches App.jsx protection', () => {
  for (const r of ROUTES) {
    const app = appRoutes.find((a) => a.path === r.path);
    assert.equal(app.line.includes('<ProtectedRoute'), r.access === 'auth', `${r.id} access drifted`);
  }
});

test('every static App.jsx route is in registry or EXCLUDED', () => {
  const known = new Set([...ROUTES.map((r) => r.path), ...EXCLUDED]);
  const missing = appRoutes.filter((r) => isStatic(r.path) && !known.has(r.path)).map((r) => r.path);
  assert.deepEqual(missing, []);
});

test('registry and EXCLUDED do not overlap; EXCLUDED paths exist', () => {
  const reg = new Set(ROUTES.map((r) => r.path));
  const paths = new Set(appRoutes.map((r) => r.path));
  for (const p of EXCLUDED) {
    assert.ok(!reg.has(p), `${p} in both`);
    assert.ok(paths.has(p), `EXCLUDED ${p} not in App.jsx (stale)`);
  }
});

test('label keys: navbar.* exist in both locales, chatbot.routes.* allow-listed', () => {
  const en = JSON.parse(read('../../i18n/locales/en.json'));
  const fil = JSON.parse(read('../../i18n/locales/fil.json'));
  const get = (o, k) => k.split('.').reduce((a, p) => (a == null ? a : a[p]), o);
  for (const r of ROUTES) {
    if (r.labelKey.startsWith('chatbot.routes.')) {
      assert.ok(PENDING_CHATBOT_LABEL_KEYS.includes(r.labelKey), `${r.labelKey} not allow-listed`);
    } else {
      assert.match(r.labelKey, /^navbar\./);
      assert.equal(typeof get(en, r.labelKey), 'string', `en missing ${r.labelKey}`);
      assert.equal(typeof get(fil, r.labelKey), 'string', `fil missing ${r.labelKey}`);
    }
  }
});

test('allow-list has no stale entries', () => {
  const used = new Set(ROUTES.map((r) => r.labelKey));
  for (const k of PENDING_CHATBOT_LABEL_KEYS) assert.ok(used.has(k), `${k} unused`);
});
