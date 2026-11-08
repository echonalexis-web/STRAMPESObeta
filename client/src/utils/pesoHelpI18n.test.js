import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const load = (lang) => {
  const text = fs.readFileSync(new URL(`../i18n/locales/${lang}.json`, import.meta.url), "utf8");
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
};
const get = (obj, path) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), obj);

// Keys the PESO Help page, its Settings entry and the floating-button switch use.
const KEYS = [
  "chatbot.pref.heading",
  "chatbot.pref.label",
  "chatbot.pref.hint",
  "chatbot.page.back",
  "chatbot.page.prefLabel",
  "chatbot.routes.pesoHelp",
  "settings.sections.pesoHelp",
  "settings.pesoHelp.subtitle",
];

test("PESO Help page / toggle keys exist and are non-empty in en.json and fil.json", () => {
  for (const [name, locale] of [["en", load("en")], ["fil", load("fil")]]) {
    for (const key of KEYS) {
      const value = get(locale, key);
      assert.equal(typeof value, "string", `${name} missing ${key}`);
      assert.ok(value.trim().length > 0, `${name} ${key} is empty`);
    }
  }
});

test("the switch label matches the requested wording in English", () => {
  assert.equal(get(load("en"), "chatbot.pref.label"), "Show PESO Help floating button");
});
