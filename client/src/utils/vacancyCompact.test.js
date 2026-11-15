import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compactCardModel, clampPercent } from "./vacancyCompact.js";

const checklist = (over = {}) => ({ percent: 57, tier: "Partial", metMustHaves: 2, totalMustHaves: 4, missingRequired: [{ type: "skill", value: "SQL" }], ...over });

test("must-haves count is shown when the job has must-haves", () => {
  const m = compactCardModel({ checklist: checklist(), tier: "mid" });
  assert.equal(m.toggleKind, "mustHaves");
  assert.equal(m.met, 2);
  assert.equal(m.total, 4);
  assert.equal(m.missing.length, 1);
  assert.equal(m.showMatch, true);
});

test("a match with no must-haves says so instead of '0 of 0'", () => {
  const m = compactCardModel({ checklist: checklist({ totalMustHaves: 0, metMustHaves: 0, missingRequired: [] }), tier: "high" });
  assert.equal(m.toggleKind, "noMustHaves");
  assert.deepEqual(m.missing, []);
});

test("no match available falls back to a details toggle", () => {
  assert.equal(compactCardModel({ checklist: null, matchAvailable: false, tier: "na" }).toggleKind, "details");
  assert.equal(compactCardModel({ checklist: checklist(), matchAvailable: false, tier: "na" }).showMatch, false);
});

test("estimated fit (no checklist) still shows the match pill", () => {
  const m = compactCardModel({ checklist: null, matchAvailable: true, tier: "mid" });
  assert.equal(m.showMatch, true);
  assert.equal(m.hasChecklist, false);
  assert.equal(m.toggleKind, "noMustHaves");
});

test("blocked state: applied beats age, age shows when not allowed to apply", () => {
  assert.equal(compactCardModel({ applied: true, canApply: false }).blocked, "applied");
  assert.equal(compactCardModel({ applied: false, canApply: false }).blocked, "age");
  assert.equal(compactCardModel({ applied: false, canApply: true }).blocked, null);
});

test("clampPercent stays inside 0..100", () => {
  assert.equal(clampPercent(-4), 0);
  assert.equal(clampPercent(140), 100);
  assert.equal(clampPercent("57.4"), 57);
  assert.equal(clampPercent(undefined), 0);
});

test("vacancy.compact strings exist in en and fil with the same keys", () => {
  const read = (name) => JSON.parse(readFileSync(new URL(`../i18n/locales/${name}.json`, import.meta.url), "utf8"));
  const en = read("en").vacancy?.compact;
  const fil = read("fil").vacancy?.compact;
  assert.ok(en && fil, "vacancy.compact missing in en or fil");
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fil).sort());
  for (const key of Object.keys(en)) assert.ok(String(fil[key]).trim(), `fil.${key} empty`);
});
