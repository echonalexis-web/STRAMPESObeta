import test from "node:test";
import assert from "node:assert/strict";
import { formatSpesDate, matchesTab, postingDocumentSlots, POSTING_TABS } from "./spesPostings.js";
import { requiredSlotsFor } from "./spesSlots.js";

test("tabs: open shows open postings; closed shows closed and results released; all shows everything", () => {
  const open = { displayStatus: "open" };
  const closed = { displayStatus: "closed" };
  const released = { displayStatus: "results_released" };
  assert.deepEqual(POSTING_TABS, ["open", "closed", "all"]);
  assert.equal(matchesTab("open", open), true);
  assert.equal(matchesTab("open", closed), false);
  assert.equal(matchesTab("closed", closed), true);
  assert.equal(matchesTab("closed", released), true);
  assert.equal(matchesTab("closed", open), false);
  for (const p of [open, closed, released]) assert.equal(matchesTab("all", p), true);
});

test("dates: empty and invalid values give an empty string; Filipino uses fil-PH", () => {
  assert.equal(formatSpesDate(null, "en"), "");
  assert.equal(formatSpesDate("not a date", "en"), "");
  assert.match(formatSpesDate("2026-12-01T00:00:00.000Z", "en"), /2026/);
  assert.match(formatSpesDate("2026-12-01T00:00:00.000Z", "fil"), /2026/);
});

test("documents list: student and OSY alternatives are both shown once", () => {
  const posting = { requiredSlots: [] };
  const list = postingDocumentSlots(requiredSlotsFor(posting, "student"), requiredSlotsFor(posting, "osy"));
  assert.deepEqual(list, ["form2", "proof_of_age", "proof_of_financial_status", "proof_of_academic_standing", "osy_certification"]);
  assert.equal(new Set(list).size, list.length);
});

test("a posting that narrows its documents is respected for both applicant types", () => {
  const posting = { requiredSlots: ["form2", "proof_of_age"] };
  assert.deepEqual(requiredSlotsFor(posting, "student"), ["form2", "proof_of_age"]);
  assert.deepEqual(requiredSlotsFor(posting, "osy"), ["form2", "proof_of_age"]);
});
