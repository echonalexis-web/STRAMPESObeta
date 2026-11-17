import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
const load = (lang) => {
  const text = read(`../i18n/locales/${lang}.json`);
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
};
const flatten = (node, prefix = "") =>
  Object.entries(node).flatMap(([key, value]) =>
    value && typeof value === "object" ? flatten(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]]
  );

const en = Object.fromEntries(flatten(load("en")));
const fil = Object.fromEntries(flatten(load("fil")));

const NAMESPACES = ["formErrors", "wizardErrors", "phoneInput", "langTable", "profileOptions", "wizardNav"];
const CODES = [
  "errors.codes.PHONE_PH_FORMAT",
  "errors.codes.PHONE_TOO_SHORT",
  "errors.codes.PHONE_TOO_LONG",
  "errors.codes.PHONE_BAD_CHARS",
  "errors.codes.PHONE_WEAK",
  "errors.codes.PHONE_COUNTRY_UNKNOWN",
  "errors.codes.ENUM_INVALID",
];

const inScope = (key) => NAMESPACES.some((ns) => key.startsWith(`${ns}.`)) || CODES.includes(key);

test("every new key exists in both locales and is a non-empty string", () => {
  const keys = Object.keys(en).filter(inScope);
  assert.ok(keys.length > 80, `expected many keys, found ${keys.length}`);
  for (const key of keys) {
    assert.equal(typeof fil[key], "string", `fil is missing ${key}`);
    assert.notEqual(fil[key].trim(), "", `fil ${key} is empty`);
    assert.notEqual(en[key].trim(), "", `en ${key} is empty`);
  }
  for (const key of Object.keys(fil).filter(inScope)) {
    assert.equal(typeof en[key], "string", `en is missing ${key}`);
  }
});

test("placeholders match between en and fil", () => {
  const placeholders = (text) => (String(text).match(/\{\{\w+\}\}/g) || []).sort().join(",");
  for (const key of Object.keys(en).filter(inScope)) {
    assert.equal(placeholders(fil[key]), placeholders(en[key]), key);
  }
});

test("every phone code the client maps has a message in both locales", () => {
  for (const key of [
    "phoneInput.errors.required", "phoneInput.errors.phFormat", "phoneInput.errors.tooShort",
    "phoneInput.errors.tooLong", "phoneInput.errors.badChars", "phoneInput.errors.weak", "phoneInput.errors.countryUnknown",
  ]) {
    assert.ok(en[key] && fil[key], key);
  }
});
