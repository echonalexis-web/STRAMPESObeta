import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// English and Filipino carry the same staff-invitation keys with the same
// placeholders, and no string is empty. (Filipino wording is flagged for native
// review in the build report; this checks structure only.)
const load = (lang) => {
  const text = fs.readFileSync(new URL(`../i18n/locales/${lang}.json`, import.meta.url), "utf8");
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
};
const flatten = (node, prefix = "") =>
  Object.entries(node).flatMap(([key, value]) =>
    value && typeof value === "object" ? flatten(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]]
  );

const en = Object.fromEntries(flatten(load("en")));
const fil = Object.fromEntries(flatten(load("fil")));

const NAMESPACES = [
  "staffInvite",
  "activation",
  "superadmin.users.pendingStaff",
  "superadmin.users.status.pending",
  "superadmin.users.status.expired",
  "errors.codes.INVITE_INVALID",
  "errors.codes.PASSWORD_MISMATCH",
  "errors.codes.EMAIL_EXISTS",
  "password.match",
  "password.requirementMet",
  "password.requirementOpen",
  "settings.system.inviteExpiryLabel",
  "settings.system.inviteExpirySuffix",
  "settings.system.inviteCooldownLabel",
  "settings.system.inviteCooldownSuffix",
];
const inScope = (key) => NAMESPACES.some((ns) => key === ns || key.startsWith(`${ns}.`));
const placeholders = (text) => [...String(text).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

test("every staff-invitation key exists in both languages", () => {
  const enKeys = Object.keys(en).filter(inScope);
  assert.ok(enKeys.length > 60, "the namespaces are not empty");
  assert.deepEqual(enKeys.filter((key) => !(key in fil)), [], "missing in Filipino");
  assert.deepEqual(Object.keys(fil).filter(inScope).filter((key) => !(key in en)), [], "missing in English");
});

test("placeholders match between English and Filipino", () => {
  for (const key of Object.keys(en).filter(inScope)) {
    assert.deepEqual(placeholders(fil[key]), placeholders(en[key]), key);
  }
});

test("no staff-invitation string is empty, and Filipino is not a copy of English where wording must differ", () => {
  const same = [];
  for (const key of Object.keys(en).filter(inScope)) {
    assert.ok(String(en[key]).trim(), `${key} (en) is empty`);
    assert.ok(String(fil[key]).trim(), `${key} (fil) is empty`);
    if (en[key] === fil[key]) same.push(key);
  }
  // Names, examples and the like may match; sentences must not.
  const allowed = new Set([
    "staffInvite.form.namePlaceholder",
    "staffInvite.form.emailPlaceholder",
    "staffInvite.form.positionPlaceholder",
    "staffInvite.form.roleStaff",
  ]);
  assert.deepEqual(same.filter((key) => !allowed.has(key)), []);
});
