import test from "node:test";
import assert from "node:assert/strict";
import {
  SALARY_CHIPS,
  cleanSalaryInput,
  salaryValue,
  isSalaryRangeInvalid,
  hasSalaryFilter,
  activeSalaryChip,
  salarySummaryParts,
} from "./salaryRange.js";

test("cleanSalaryInput keeps digits only and caps at 7", () => {
  assert.equal(cleanSalaryInput("₱15,000"), "15000");
  assert.equal(cleanSalaryInput("12345678901"), "1234567");
  assert.equal(cleanSalaryInput("abc"), "");
  assert.equal(cleanSalaryInput(undefined), "");
});

test("empty min or max means no bound", () => {
  assert.equal(salaryValue(""), "");
  assert.equal(salaryValue(undefined), "");
  assert.equal(hasSalaryFilter("", ""), false);
  assert.equal(hasSalaryFilter("15000", ""), true);
  assert.equal(hasSalaryFilter("", 50000), true);
  assert.equal(isSalaryRangeInvalid("", "5000"), false);
  assert.equal(isSalaryRangeInvalid("5000", ""), false);
});

test("min greater than max is invalid; equal is valid", () => {
  assert.equal(isSalaryRangeInvalid("50000", "15000"), true);
  assert.equal(isSalaryRangeInvalid("15000", "15000"), false);
  assert.equal(isSalaryRangeInvalid(30000, 50000), false);
});

test("each chip is pressed only for its exact values", () => {
  for (const chip of SALARY_CHIPS) {
    assert.equal(activeSalaryChip(chip.min, chip.max), chip.id);
  }
  assert.equal(activeSalaryChip("15000", "31000"), null);
  assert.equal(activeSalaryChip("", "15000"), "under15");
  assert.equal(activeSalaryChip("50000", ""), "over50");
});

test("chips fill the documented ranges", () => {
  const byId = Object.fromEntries(SALARY_CHIPS.map((c) => [c.id, [c.min, c.max]]));
  assert.deepEqual(byId.any, ["", ""]);
  assert.deepEqual(byId.under15, ["", "15000"]);
  assert.deepEqual(byId["15to30"], ["15000", "30000"]);
  assert.deepEqual(byId["30to50"], ["30000", "50000"]);
  assert.deepEqual(byId.over50, ["50000", ""]);
});

test("summary parts cover any / from / up to / between", () => {
  assert.deepEqual(salarySummaryParts("", ""), { kind: "any" });
  assert.deepEqual(salarySummaryParts("15000", ""), { kind: "from", min: 15000 });
  assert.deepEqual(salarySummaryParts("", "50000"), { kind: "upTo", max: 50000 });
  assert.deepEqual(salarySummaryParts("15000", "50000"), { kind: "between", min: 15000, max: 50000 });
});
