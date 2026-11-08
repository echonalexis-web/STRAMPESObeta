// Age rules (utils/age.js): whole years in the Asia/Manila calendar from a
// date-only date of birth. Every case passes a fixed clock.

const {
  TIERS,
  getAgeFromDate,
  getAgeTier,
  isSpesEligibleAge,
  isJobVacancyEligibleAge,
  parseDateOnly,
  validateDobInput,
  dobRangeForTier,
} = require("../utils/age");

// 2026-11-08 12:00 in Manila (04:00 UTC).
const NOW = new Date("2026-11-08T04:00:00.000Z");
const dob = (s) => new Date(`${s}T00:00:00.000Z`);

describe("getAgeFromDate boundaries", () => {
  test.each([
    ["14 years 364 days (turns 15 tomorrow)", "2011-11-09", 14, TIERS.UNDER_15],
    ["the 15th birthday itself", "2011-11-08", 15, TIERS.MINOR],
    ["17 years 364 days (turns 18 tomorrow)", "2008-11-09", 17, TIERS.MINOR],
    ["the 18th birthday itself", "2008-11-08", 18, TIERS.ADULT],
    ["30 years 364 days (turns 31 tomorrow)", "1995-11-09", 30, TIERS.ADULT],
    ["exactly 30", "1996-11-08", 30, TIERS.ADULT],
    ["the 31st birthday itself", "1995-11-08", 31, TIERS.SENIOR],
  ])("%s", (_label, birth, age, tier) => {
    expect(getAgeFromDate(dob(birth), NOW)).toBe(age);
    expect(getAgeTier(dob(birth), NOW)).toBe(tier);
  });

  test("a 17-year-old unlocks on the 18th birthday with no other change", () => {
    const birth = dob("2008-11-09");
    expect(isJobVacancyEligibleAge(birth, NOW)).toBe(false);
    const nextDayManila = new Date("2026-11-08T16:00:00.000Z"); // 2026-11-09 00:00 Manila
    expect(isJobVacancyEligibleAge(birth, nextDayManila)).toBe(true);
  });

  test("Asia/Manila edge: the day changes at 16:00 UTC, not at 00:00 UTC", () => {
    const birth = dob("2011-11-09");
    expect(getAgeFromDate(birth, new Date("2026-11-08T15:59:59.000Z"))).toBe(14);
    expect(getAgeFromDate(birth, new Date("2026-11-08T16:00:00.000Z"))).toBe(15);
  });

  test("Feb 29 birthday counts on Mar 1 in a non-leap year", () => {
    const birth = dob("2008-02-29");
    expect(getAgeFromDate(birth, new Date("2026-02-28T04:00:00.000Z"))).toBe(17);
    expect(getAgeFromDate(birth, new Date("2026-03-01T04:00:00.000Z"))).toBe(18);
  });

  test("missing, invalid or future dates give null / unknown (fail closed)", () => {
    expect(getAgeFromDate(null, NOW)).toBeNull();
    expect(getAgeFromDate("not a date", NOW)).toBeNull();
    expect(getAgeFromDate(dob("2030-01-01"), NOW)).toBeNull();
    expect(getAgeTier(undefined, NOW)).toBe(TIERS.UNKNOWN);
    expect(isSpesEligibleAge(null, NOW)).toBe(false);
    expect(isJobVacancyEligibleAge(null, NOW)).toBe(false);
  });
});

describe("SPES range is 15 to 30", () => {
  test.each([
    ["2011-11-09", false], // 14
    ["2011-11-08", true], // 15
    ["1996-11-08", true], // 30
    ["1995-11-08", false], // 31
  ])("born %s -> eligible %s", (birth, expected) => {
    expect(isSpesEligibleAge(dob(birth), NOW)).toBe(expected);
  });
});

describe("parseDateOnly / validateDobInput", () => {
  test("accepts only real calendar dates", () => {
    expect(parseDateOnly("2000-02-29")).toEqual(dob("2000-02-29"));
    expect(parseDateOnly("2001-02-29")).toBeNull();
    expect(parseDateOnly("2023-02-30")).toBeNull();
    expect(parseDateOnly("01/02/2000")).toBeNull();
    expect(parseDateOnly(12345)).toBeNull();
  });

  test.each([
    [undefined, "DOB_REQUIRED"],
    ["", "DOB_REQUIRED"],
    ["garbage", "DOB_INVALID"],
    ["1899-12-31", "DOB_INVALID"],
    ["2030-01-01", "DOB_INVALID"],
    ["2011-11-09", "AGE_UNDER_MINIMUM"],
  ])("%p is rejected with %s", (value, code) => {
    expect(validateDobInput(value, NOW)).toEqual({ ok: false, code });
  });

  test("the 15th birthday passes and reports its tier", () => {
    const result = validateDobInput("2011-11-08", NOW);
    expect(result.ok).toBe(true);
    expect(result.tier).toBe(TIERS.MINOR);
    expect(result.date).toEqual(dob("2011-11-08"));
  });
});

describe("dobRangeForTier matches getAgeTier", () => {
  test("every tier's range contains its boundary dates and excludes the neighbours", () => {
    const inRange = (range, d) =>
      (range.$gt === undefined || d > range.$gt) && (range.$lte === undefined || d <= range.$lte);

    const cases = [
      [TIERS.UNDER_15, ["2011-11-09"], ["2011-11-08"]],
      [TIERS.MINOR, ["2011-11-08", "2008-11-09"], ["2011-11-09", "2008-11-08"]],
      [TIERS.ADULT, ["2008-11-08", "1995-11-09"], ["2008-11-09", "1995-11-08"]],
      [TIERS.SENIOR, ["1995-11-08", "1950-01-01"], ["1995-11-09"]],
    ];
    for (const [tier, inside, outside] of cases) {
      const range = dobRangeForTier(tier, NOW);
      inside.forEach((d) => expect([tier, d, inRange(range, dob(d))]).toEqual([tier, d, true]));
      outside.forEach((d) => expect([tier, d, inRange(range, dob(d))]).toEqual([tier, d, false]));
      inside.forEach((d) => expect(getAgeTier(dob(d), NOW)).toBe(tier));
    }
    expect(dobRangeForTier(TIERS.UNKNOWN, NOW)).toBeNull();
  });
});
