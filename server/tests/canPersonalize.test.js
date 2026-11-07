const { canPersonalizeRecommendations } = require("../utils/personalizationEligibility");

// P0-03 (markdowns/MATCHMAKING_DEPLOYMENT_CHECKLIST.md): recommendationController.js's
// `canPersonalize` only checked skills/preferredIndustries/preferredOccupations/
// workHistory/educationalAttainment/desiredJobTitle, so a profile containing ONLY
// licenses, language, salary preference, location, or employment-type data fell into
// the non-personalized ("requirements met" checklist) branch. These tests exercise the
// extracted eligibility helper directly, one supported signal at a time, plus the
// fully-empty case that must still resolve to "not personalizable".
describe("canPersonalizeRecommendations", () => {
  test("a completely empty profile is not personalizable", () => {
    expect(canPersonalizeRecommendations({})).toBe(false);
    expect(canPersonalizeRecommendations()).toBe(false);
  });

  test("license-only profile (professionalLicenses) is personalizable", () => {
    const result = canPersonalizeRecommendations({
      professionalLicenses: [{ name: "Registered Nurse", validUntil: "2030" }],
    });
    expect(result).toBe(true);
  });

  test("license-only profile (eligibilities) is personalizable", () => {
    const result = canPersonalizeRecommendations({
      eligibilities: [{ name: "Civil Service Eligibility", rating: "Passed" }],
    });
    expect(result).toBe(true);
  });

  test("license-only profile (vocationalTrainings) is personalizable", () => {
    const result = canPersonalizeRecommendations({
      vocationalTrainings: [{ course: "Welding NC II", institution: "TESDA" }],
    });
    expect(result).toBe(true);
  });

  test("language-only profile is personalizable", () => {
    const result = canPersonalizeRecommendations({
      languageProficiency: {
        English: { read: true, write: false, speak: true, understand: true },
        Filipino: { read: false, write: false, speak: false, understand: false },
        Others: { read: false, write: false, speak: false, understand: false },
      },
    });
    expect(result).toBe(true);
  });

  test("a languageProficiency sub-document with every flag false is NOT treated as a signal", () => {
    // Mongoose populates this sub-document with default `false` flags even when the
    // applicant never touched it (mirrors profileCompleteness.test.js's equivalent case).
    const result = canPersonalizeRecommendations({
      languageProficiency: {
        English: { read: false, write: false, speak: false, understand: false },
        Filipino: { read: false, write: false, speak: false, understand: false },
        Others: { read: false, write: false, speak: false, understand: false },
      },
    });
    expect(result).toBe(false);
  });

  test("salary-only profile (expectedSalaryMin) is personalizable", () => {
    expect(canPersonalizeRecommendations({ expectedSalaryMin: 15000 })).toBe(true);
  });

  test("salary-only profile (expectedSalaryMax) is personalizable", () => {
    expect(canPersonalizeRecommendations({ expectedSalaryMax: 25000 })).toBe(true);
  });

  test("location-only profile (preferredWorkLocationLocal) is personalizable", () => {
    const result = canPersonalizeRecommendations({
      preferredWorkLocationLocal: ["Boac, Marinduque"],
    });
    expect(result).toBe(true);
  });

  test("location-only profile (presentAddress) is personalizable", () => {
    const result = canPersonalizeRecommendations({
      presentAddress: { street: "", barangay: "", municipality: "Boac", province: "Marinduque", region: "" },
    });
    expect(result).toBe(true);
  });

  test("a presentAddress sub-document with every field blank is NOT treated as a signal", () => {
    // Mongoose default-fills every leaf of presentAddress with "" even when the
    // applicant never filled in their address — an empty-string address must not
    // count as "has location data".
    const result = canPersonalizeRecommendations({
      presentAddress: { street: "", barangay: "", municipality: "", province: "", region: "" },
    });
    expect(result).toBe(false);
  });

  test("employment-type-only profile (preferredJobTypes) is personalizable", () => {
    expect(canPersonalizeRecommendations({ preferredJobTypes: ["Full-time"] })).toBe(true);
  });

  test("employment-type-only profile (preferredWorkNature) is personalizable", () => {
    expect(canPersonalizeRecommendations({ preferredWorkNature: ["Remote"] })).toBe(true);
  });

  test("pre-existing signals (skills, industries, occupations, work history, education, desired title) still personalize", () => {
    expect(canPersonalizeRecommendations({ hasSkills: true })).toBe(true);
    expect(canPersonalizeRecommendations({ preferredIndustries: ["Information Technology (IT)"] })).toBe(true);
    expect(canPersonalizeRecommendations({ preferredOccupations: ["Encoder"] })).toBe(true);
    expect(canPersonalizeRecommendations({ workHistory: [{ companyName: "Acme", position: "Clerk" }] })).toBe(true);
    expect(canPersonalizeRecommendations({ educationalAttainment: "College Graduate" })).toBe(true);
    expect(canPersonalizeRecommendations({ desiredJobTitle: "Encoder" })).toBe(true);
  });
});
