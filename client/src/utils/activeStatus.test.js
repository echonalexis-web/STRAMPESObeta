// Run with: npm test   (node's built-in test runner; no extra dependency)
//
// Covers every row of the active-status label table, in English and Filipino,
// using the real i18next and the real locale files.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import i18next from "i18next";
import { ACTIVE_STATUS, getActiveStatusLabel } from "./activeStatus.js";

const require = createRequire(import.meta.url);
const resources = {
  en: { translation: require("../i18n/locales/en.json") },
  fil: { translation: require("../i18n/locales/fil.json") },
};

const translators = {};
for (const lng of ["en", "fil"]) {
  const instance = i18next.createInstance();
  await instance.init({ resources, lng, fallbackLng: "en", interpolation: { escapeValue: false } });
  translators[lng] = instance.t.bind(instance);
}

const NOW = Date.parse("2026-11-08T12:00:00.000Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const ago = (ms) => new Date(NOW - ms).toISOString();
const inactive = (ms) => ({ state: "inactive", lastActiveAt: ago(ms) });

// [description, status, expected English, expected Filipino, expected kind, dot]
const rows = [
  ["active now", { state: "active", lastActiveAt: ago(0) }, "Active now", "Aktibo ngayon", "active", true],
  ["under 1 minute (30 seconds)", inactive(30 * 1000), "Active just now", "Kakaaktibo lang", "recent", false],
  ["0 seconds", inactive(0), "Active just now", "Kakaaktibo lang", "recent", false],
  ["59 seconds", inactive(59 * 1000), "Active just now", "Kakaaktibo lang", "recent", false],
  ["1 minute", inactive(1 * MIN), "Active 1 minute ago", "Aktibo 1 minuto ang nakalipas", "recent", false],
  ["1 minute 59 seconds", inactive(MIN + 59 * 1000), "Active 1 minute ago", "Aktibo 1 minuto ang nakalipas", "recent", false],
  ["2 minutes", inactive(2 * MIN), "Active 2 minutes ago", "Aktibo 2 minuto ang nakalipas", "recent", false],
  ["15 minutes", inactive(15 * MIN), "Active 15 minutes ago", "Aktibo 15 minuto ang nakalipas", "recent", false],
  ["59 minutes", inactive(59 * MIN), "Active 59 minutes ago", "Aktibo 59 minuto ang nakalipas", "recent", false],
  ["1 hour", inactive(1 * HOUR), "Active 1 hour ago", "Aktibo 1 oras ang nakalipas", "recent", false],
  ["1 hour 59 minutes", inactive(HOUR + 59 * MIN), "Active 1 hour ago", "Aktibo 1 oras ang nakalipas", "recent", false],
  ["2 hours", inactive(2 * HOUR), "Active 2 hours ago", "Aktibo 2 oras ang nakalipas", "recent", false],
  ["3 hours", inactive(3 * HOUR), "Active 3 hours ago", "Aktibo 3 oras ang nakalipas", "recent", false],
  ["23 hours", inactive(23 * HOUR), "Active 23 hours ago", "Aktibo 23 oras ang nakalipas", "recent", false],
  ["24 hours (yesterday)", inactive(24 * HOUR), "Active yesterday", "Aktibo kahapon", "recent", false],
  ["47 hours (yesterday)", inactive(47 * HOUR), "Active yesterday", "Aktibo kahapon", "recent", false],
  ["48 hours (inactive)", inactive(48 * HOUR), "Inactive", "Hindi aktibo", "inactive", false],
  ["10 days (inactive)", inactive(10 * 24 * HOUR), "Inactive", "Hindi aktibo", "inactive", false],
  ["never active (lastActiveAt null)", { state: "inactive", lastActiveAt: null }, "Inactive", "Hindi aktibo", "inactive", false],
  ["unparseable lastActiveAt", { state: "inactive", lastActiveAt: "not a date" }, "Inactive", "Hindi aktibo", "inactive", false],
  ["a timestamp slightly in the future (clock skew)", { state: "inactive", lastActiveAt: new Date(NOW + 5 * MIN).toISOString() }, "Active just now", "Kakaaktibo lang", "recent", false],
];

for (const [description, status, en, fil, kind, dot] of rows) {
  test(`English: ${description}`, () => {
    const label = getActiveStatusLabel(status, NOW, translators.en);
    assert.equal(label.text, en);
    assert.equal(label.kind, kind);
    assert.equal(label.showDot, dot);
  });
  test(`Filipino: ${description}`, () => {
    const label = getActiveStatusLabel(status, NOW, translators.fil);
    assert.equal(label.text, fil);
    assert.equal(label.kind, kind);
    assert.equal(label.showDot, dot);
  });
}

for (const lng of ["en", "fil"]) {
  test(`${lng}: a hidden user shows nothing (no dot, no text, not even "Inactive")`, () => {
    for (const status of [{ state: "hidden", lastActiveAt: null }, null, undefined]) {
      const label = getActiveStatusLabel(status, NOW, translators[lng]);
      assert.deepEqual({ ...label }, { kind: "hidden", text: "", showDot: false });
    }
  });
}

test("only 'Active now' shows the green dot; every other state has none", () => {
  for (const [, status, , , , dot] of rows) {
    assert.equal(getActiveStatusLabel(status, NOW, translators.en).showDot, dot);
  }
});

test("English singular and plural are correct for every minute and hour count", () => {
  for (let m = 1; m <= 59; m++) {
    const text = getActiveStatusLabel(inactive(m * MIN), NOW, translators.en).text;
    assert.equal(text, m === 1 ? "Active 1 minute ago" : `Active ${m} minutes ago`);
  }
  for (let h = 1; h <= 23; h++) {
    const text = getActiveStatusLabel(inactive(h * HOUR), NOW, translators.en).text;
    assert.equal(text, h === 1 ? "Active 1 hour ago" : `Active ${h} hours ago`);
  }
});

test("Filipino reads correctly for every count (its plural categories differ from English)", () => {
  for (let m = 1; m <= 59; m++) {
    assert.equal(getActiveStatusLabel(inactive(m * MIN), NOW, translators.fil).text, `Aktibo ${m} minuto ang nakalipas`);
  }
  for (let h = 1; h <= 23; h++) {
    assert.equal(getActiveStatusLabel(inactive(h * HOUR), NOW, translators.fil).text, `Aktibo ${h} oras ang nakalipas`);
  }
});

test("the cutoffs are named constants, so changing one changes the label", () => {
  assert.equal(ACTIVE_STATUS.JUST_NOW_UNDER_MS, 60 * 1000);
  assert.equal(ACTIVE_STATUS.YESTERDAY_UNDER_MS, 48 * HOUR);
  // A 90-second-old status is "1 minute ago" with the defaults ...
  assert.equal(getActiveStatusLabel(inactive(90 * 1000), NOW, translators.en).text, "Active 1 minute ago");
});
