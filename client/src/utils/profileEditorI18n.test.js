import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => JSON.parse(readFileSync(new URL(`../i18n/locales/${name}.json`, import.meta.url), "utf8"));

const flatten = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === "object" ? flatten(value, `${prefix}${key}.`) : [`${prefix}${key}`]
  );

test("profileEditor strings exist in en and fil with the same keys and no empty values", () => {
  const en = read("en").profileEditor;
  const fil = read("fil").profileEditor;
  assert.ok(en && fil, "profileEditor missing in en or fil");
  assert.deepEqual(flatten(en).sort(), flatten(fil).sort());
  for (const key of flatten(fil)) {
    const value = key.split(".").reduce((o, k) => o[k], fil);
    assert.ok(String(value).trim(), `fil.${key} is empty`);
  }
});

test("every section id the editor can show has a help line", () => {
  const help = read("en").profileEditor.help;
  for (const id of ["profile", "employerProfile", "career", "training", "nsrp", "documents"]) {
    assert.ok(help[id], `help.${id} missing`);
  }
});
