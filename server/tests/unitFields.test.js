// [mock-defense item 3] JobseekerProfile gained heightUnit/weightUnit so the
// explicit cm/ft_in and kg/lb selector in EditProfile.jsx (and onboarding)
// round-trips on reload instead of always resetting to the metric default.
// normalizeHeightUnit/normalizeWeightUnit (server/utils/unitFields.js) are
// the shared coercion rule authController.updateProfile and
// userController.completeOnboarding both use when persisting the incoming
// unit token. They're pure functions (no DB access), so no Mongoose model
// mocking is needed here — same reasoning as tests/canPersonalize.test.js.
const { normalizeHeightUnit, normalizeWeightUnit } = require("../utils/unitFields");

describe("normalizeHeightUnit", () => {
  test("passes through a valid 'cm' value", () => {
    expect(normalizeHeightUnit("cm")).toBe("cm");
  });

  test("passes through a valid 'ft_in' value", () => {
    expect(normalizeHeightUnit("ft_in")).toBe("ft_in");
  });

  test("defaults to 'cm' when undefined (existing record with no stored unit)", () => {
    expect(normalizeHeightUnit(undefined)).toBe("cm");
  });

  test("defaults to 'cm' for an empty string", () => {
    expect(normalizeHeightUnit("")).toBe("cm");
  });

  test("defaults to 'cm' for an unrecognized/garbage value", () => {
    expect(normalizeHeightUnit("feet")).toBe("cm");
    expect(normalizeHeightUnit("ftin")).toBe("cm");
    expect(normalizeHeightUnit(null)).toBe("cm");
  });
});

describe("normalizeWeightUnit", () => {
  test("passes through a valid 'kg' value", () => {
    expect(normalizeWeightUnit("kg")).toBe("kg");
  });

  test("passes through a valid 'lb' value", () => {
    expect(normalizeWeightUnit("lb")).toBe("lb");
  });

  test("defaults to 'kg' when undefined (existing record with no stored unit)", () => {
    expect(normalizeWeightUnit(undefined)).toBe("kg");
  });

  test("defaults to 'kg' for an empty string", () => {
    expect(normalizeWeightUnit("")).toBe("kg");
  });

  test("defaults to 'kg' for an unrecognized/garbage value", () => {
    expect(normalizeWeightUnit("pounds")).toBe("kg");
    expect(normalizeWeightUnit(null)).toBe("kg");
  });
});
