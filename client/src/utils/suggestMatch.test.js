import test from "node:test";
import assert from "node:assert/strict";
import { canonicalOption, collapseSpaces, foldText, matchSuggestions } from "./suggestMatch.js";

const OPTIONS = ["Filipino", "American", "Australian", "Spanish", "Panamanian", "Mexican", "Japanese", "Filipino-American"];

test("foldText lowercases, strips accents and collapses spaces", () => {
  assert.equal(foldText("  Ñoño   CAFÉ "), "nono cafe");
  assert.equal(foldText(null), "");
});

test("match is case-insensitive, accent-insensitive and ignores extra spaces", () => {
  assert.deepEqual(matchSuggestions("  FILI  ", OPTIONS), ["Filipino", "Filipino-American"]);
  assert.deepEqual(matchSuggestions("spánish", OPTIONS), ["Spanish"]);
});

test("matches anywhere in the label, not only at the start", () => {
  assert.deepEqual(matchSuggestions("pan", OPTIONS), ["Panamanian", "Spanish", "Japanese"]);
});

test("prefix first: a prefix hit outranks an earlier inside hit", () => {
  const options = ["Registered Nurse", "Nurse Aide", "Licensed Practical Nurse"];
  assert.deepEqual(matchSuggestions("nurse", options), ["Nurse Aide", "Registered Nurse", "Licensed Practical Nurse"]);
});

test("at most 8 results; empty query and no match give an empty list", () => {
  const many = Array.from({ length: 20 }, (_, i) => `Option ${i}`);
  assert.equal(matchSuggestions("option", many).length, 8);
  assert.equal(matchSuggestions("option", many, 3).length, 3);
  assert.deepEqual(matchSuggestions("", OPTIONS), []);
  assert.deepEqual(matchSuggestions("zzz", OPTIONS), []);
});

test("duplicates that differ only by case or spacing appear once", () => {
  assert.deepEqual(matchSuggestions("a", ["Alpha", "alpha", " ALPHA ", "Beta a"]), ["Alpha", "Beta a"]);
});

test("canonicalOption returns the list's own label, free text stays null", () => {
  assert.equal(canonicalOption("  filipino ", OPTIONS), "Filipino");
  assert.equal(canonicalOption("Atlantean", OPTIONS), null);
});

test("collapseSpaces keeps casing and accents", () => {
  assert.equal(collapseSpaces("  Doña   Maria  "), "Doña Maria");
});

test("suggest strings exist in en and fil with the same keys and no empty values", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (name) => JSON.parse(readFileSync(new URL(`../i18n/locales/${name}.json`, import.meta.url), "utf8"));
  const en = read("en").suggest;
  const fil = read("fil").suggest;
  assert.ok(en && fil, "suggest missing in en or fil");
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fil).sort());
  for (const key of Object.keys(fil)) assert.ok(String(fil[key]).trim(), `fil.suggest.${key} empty`);
});
