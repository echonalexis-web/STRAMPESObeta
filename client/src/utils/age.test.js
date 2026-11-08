// The client age helpers mirror the server's (display only). Same boundary
// table as server/tests/age.test.js, with a fixed clock.
import test from "node:test";
import assert from "node:assert/strict";
import {
  AGE_TIERS,
  canViewJobs,
  checkDobInput,
  getAgeFromDate,
  getAgeTier,
  getManilaTodayISO,
  isJobVacancyEligibleAge,
  isSpesEligibleAge,
  meetsMinimumAccountAge,
} from "./age.js";

// 2026-11-08 12:00 in Manila.
const NOW = new Date("2026-11-08T04:00:00.000Z");

const TABLE = [
  ["14 years 364 days", "2011-11-09", 14, AGE_TIERS.UNDER_15],
  ["the 15th birthday", "2011-11-08", 15, AGE_TIERS.MINOR],
  ["17 years 364 days", "2008-11-09", 17, AGE_TIERS.MINOR],
  ["the 18th birthday", "2008-11-08", 18, AGE_TIERS.ADULT],
  ["30 years 364 days", "1995-11-09", 30, AGE_TIERS.ADULT],
  ["the 31st birthday", "1995-11-08", 31, AGE_TIERS.SENIOR],
];

for (const [label, dob, age, tier] of TABLE) {
  test(`age: ${label}`, () => {
    assert.equal(getAgeFromDate(dob, NOW), age);
    assert.equal(getAgeTier(dob, NOW), tier);
  });
}

test("age: reads both date-only text and a server Date at UTC midnight the same way", () => {
  assert.equal(getAgeFromDate("2008-11-08", NOW), getAgeFromDate(new Date("2008-11-08T00:00:00.000Z"), NOW));
});

test("age: Asia/Manila edge flips at 16:00 UTC", () => {
  assert.equal(getAgeFromDate("2011-11-09", new Date("2026-11-08T15:59:59.000Z")), 14);
  assert.equal(getAgeFromDate("2011-11-09", new Date("2026-11-08T16:00:00.000Z")), 15);
});

test("age: Feb 29 birthdays count on Mar 1 in non-leap years", () => {
  assert.equal(getAgeFromDate("2008-02-29", new Date("2026-02-28T04:00:00.000Z")), 17);
  assert.equal(getAgeFromDate("2008-02-29", new Date("2026-03-01T04:00:00.000Z")), 18);
});

test("bands: 15-17 can view jobs but not apply; 18+ can apply; SPES is 15-30", () => {
  assert.equal(canViewJobs("2011-11-08", NOW), true);
  assert.equal(isJobVacancyEligibleAge("2011-11-08", NOW), false);
  assert.equal(isJobVacancyEligibleAge("2008-11-08", NOW), true);
  assert.equal(isSpesEligibleAge("2011-11-09", NOW), false);
  assert.equal(isSpesEligibleAge("2011-11-08", NOW), true);
  assert.equal(isSpesEligibleAge("1996-11-08", NOW), true);
  assert.equal(isSpesEligibleAge("1995-11-08", NOW), false);
  assert.equal(meetsMinimumAccountAge("2011-11-09", NOW), false);
});

test("bands: a missing or invalid date of birth fails closed", () => {
  for (const dob of [null, undefined, "", "nope"]) {
    assert.equal(canViewJobs(dob, NOW), false);
    assert.equal(isJobVacancyEligibleAge(dob, NOW), false);
    assert.equal(isSpesEligibleAge(dob, NOW), false);
    assert.equal(getAgeTier(dob, NOW), AGE_TIERS.UNKNOWN);
  }
});

test("form pre-check returns the same codes as the server", () => {
  assert.equal(checkDobInput("", NOW), "DOB_REQUIRED");
  assert.equal(checkDobInput("2000-02-30", NOW), "DOB_INVALID");
  assert.equal(checkDobInput("1899-01-01", NOW), "DOB_INVALID");
  assert.equal(checkDobInput("2030-01-01", NOW), "DOB_INVALID");
  assert.equal(checkDobInput("2011-11-09", NOW), "AGE_UNDER_MINIMUM");
  assert.equal(checkDobInput("2011-11-08", NOW), null);
});

test("the date input max is today's date in Manila", () => {
  assert.equal(getManilaTodayISO(new Date("2026-11-08T16:00:00.000Z")), "2026-11-09");
  assert.equal(getManilaTodayISO(new Date("2026-11-08T15:59:59.000Z")), "2026-11-08");
});
