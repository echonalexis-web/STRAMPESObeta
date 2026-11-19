import test from "node:test";
import assert from "node:assert/strict";
import { normalizeIndustries, toggleIndustry, addPreferredIndustries } from "./industrySelection.js";

test("normalizeIndustries accepts arrays, a stale string and empties", () => {
  assert.deepEqual(normalizeIndustries(["A", "B"]), ["A", "B"]);
  assert.deepEqual(normalizeIndustries("A"), ["A"]);
  assert.deepEqual(normalizeIndustries(undefined), []);
  assert.deepEqual(normalizeIndustries(""), []);
});

test("toggleIndustry adds and removes without mutating", () => {
  const start = ["A"];
  assert.deepEqual(toggleIndustry(start, "B"), ["A", "B"]);
  assert.deepEqual(toggleIndustry(start, "A"), []);
  assert.deepEqual(start, ["A"]);
});

test("addPreferredIndustries unions without duplicates", () => {
  assert.deepEqual(addPreferredIndustries(["A"], ["A", "B"]), ["A", "B"]);
  assert.deepEqual(addPreferredIndustries([], undefined), []);
});
