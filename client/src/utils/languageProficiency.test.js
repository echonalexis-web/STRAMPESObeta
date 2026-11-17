import test from "node:test";
import assert from "node:assert/strict";
import {
  LANGUAGE_ROWS,
  emptyLanguageRow,
  rowState,
  setRow,
  toggleSkill,
  nextAllChecked,
} from "./languageProficiency.js";

const empty = () => ({ English: emptyLanguageRow(), Filipino: emptyLanguageRow(), Others: emptyLanguageRow() });

test("defaults are all unticked and the stored shape has the three rows", () => {
  assert.deepEqual(LANGUAGE_ROWS, ["English", "Filipino", "Others"]);
  assert.deepEqual(emptyLanguageRow(), { read: false, write: false, speak: false, understand: false });
});

test("rowState: none, some, all", () => {
  assert.equal(rowState(emptyLanguageRow()), "none");
  assert.equal(rowState({ read: true, write: false, speak: false, understand: false }), "some");
  assert.equal(rowState({ read: true, write: true, speak: true, understand: false }), "some");
  assert.equal(rowState({ read: true, write: true, speak: true, understand: true }), "all");
  assert.equal(rowState(undefined), "none");
});

test("setRow ticks or clears all four skills of one language only", () => {
  const ticked = setRow(empty(), "English", true);
  assert.deepEqual(ticked.English, { read: true, write: true, speak: true, understand: true });
  assert.deepEqual(ticked.Filipino, emptyLanguageRow());
  const cleared = setRow(ticked, "English", false);
  assert.deepEqual(cleared.English, emptyLanguageRow());
});

test("toggleSkill flips one box and keeps the rest", () => {
  const once = toggleSkill(empty(), "Filipino", "speak");
  assert.deepEqual(once.Filipino, { read: false, write: false, speak: true, understand: false });
  const twice = toggleSkill(once, "Filipino", "speak");
  assert.deepEqual(twice.Filipino, emptyLanguageRow());
});

test("clicking All: none and some tick everything, all clears everything", () => {
  assert.equal(nextAllChecked(emptyLanguageRow()), true);
  assert.equal(nextAllChecked({ read: true, write: false, speak: false, understand: false }), true);
  assert.equal(nextAllChecked({ read: true, write: true, speak: true, understand: true }), false);
});

test("a row that was ticked through All is stored as ordinary flags (shape unchanged)", () => {
  const value = setRow(empty(), "Others", true);
  assert.deepEqual(Object.keys(value), ["English", "Filipino", "Others"]);
  assert.deepEqual(Object.keys(value.Others).sort(), ["read", "speak", "understand", "write"]);
});
