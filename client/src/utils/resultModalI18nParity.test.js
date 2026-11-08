import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const load = (lang) => {
  const text = fs.readFileSync(new URL(`../i18n/locales/${lang}.json`, import.meta.url), "utf8");
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
};

function flatten(node, prefix = "") {
  return Object.entries(node).flatMap(([key, value]) =>
    value && typeof value === "object" ? flatten(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]]
  );
}

const en = Object.fromEntries(flatten(load("en").resultModal ?? {}));
const fil = Object.fromEntries(flatten(load("fil").resultModal ?? {}));

test("resultModal.* exists in both locales", () => {
  assert.ok(Object.keys(en).length > 0);
  assert.ok(Object.keys(fil).length > 0);
});

test("resultModal.* keys match between en.json and fil.json", () => {
  assert.deepEqual(Object.keys(fil).sort(), Object.keys(en).sort());
});

test("resultModal.* strings are non-empty and keep the same {{placeholders}}", () => {
  const placeholders = (s) => (String(s).match(/\{\{\s*\w+\s*\}\}/g) || []).sort().join(",");
  for (const key of Object.keys(en)) {
    assert.ok(String(en[key]).trim(), `en ${key} is empty`);
    assert.ok(String(fil[key]).trim(), `fil ${key} is empty`);
    assert.equal(placeholders(fil[key]), placeholders(en[key]), `placeholder mismatch in ${key}`);
  }
});

test("every kind has the same set of keys", () => {
  const kinds = ["recoveryEmail", "emailChange", "emailVerification"];
  const sets = kinds.map((kind) =>
    Object.keys(en)
      .filter((key) => key.startsWith(`${kind}.`))
      .map((key) => key.split(".").pop())
      .sort()
      .join(",")
  );
  assert.equal(new Set(sets).size, 1);
  assert.ok(sets[0].length > 0);
});

test("accountInactive.* (session-expired wording) matches between en.json and fil.json", () => {
  const a = Object.fromEntries(flatten(load("en").accountInactive ?? {}));
  const b = Object.fromEntries(flatten(load("fil").accountInactive ?? {}));
  assert.ok(Object.keys(a).length > 0);
  assert.deepEqual(Object.keys(b).sort(), Object.keys(a).sort());
  for (const key of Object.keys(a)) assert.ok(String(b[key]).trim(), `fil ${key} is empty`);
});
