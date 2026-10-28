const { computeProfileCompleteness } = require("../utils/profileCompleteness");

describe("computeProfileCompleteness", () => {
  test("an entirely empty profile is 0%", () => {
    const result = computeProfileCompleteness({}, {});
    expect(result.percent).toBe(0);
    expect(result.filled).toBe(0);
    expect(result.total).toBeGreaterThan(0);
  });

  test("a fully filled profile is 100%", () => {
    const user = {
      dateOfBirth: "2000-01-01",
      gender: "Male",
      phone: "0912345678",
      address: "Boac, Marinduque",
      educationalAttainment: "College Graduate",
      desiredJobTitle: "Encoder",
      skills: ["encoding"],
      resumeFile: "cloudinary:abc",
      validIdFile: "cloudinary:def",
    };
    const profile = {
      civilStatus: "Single",
      presentAddress: { municipality: "Boac", province: "Marinduque" },
      expectedSalaryMin: 15000,
      expectedSalaryMax: 20000,
      preferredIndustries: ["Information Technology (IT)"],
      preferredJobTypes: ["Full-time"],
      workHistory: [{ companyName: "Acme", position: "Clerk" }],
      languageProficiency: {
        English: { read: true, write: true, speak: true, understand: true },
        Filipino: { read: false, write: false, speak: false, understand: false },
        Others: { read: false, write: false, speak: false, understand: false },
      },
    };
    const result = computeProfileCompleteness(user, profile);
    expect(result.percent).toBe(100);
    expect(result.filled).toBe(result.total);
  });

  test("a languageProficiency sub-document with every flag false does not count as filled", () => {
    // Mongoose populates this sub-document with default `false` flags even
    // when the applicant never touched it — Object.keys().length alone would
    // wrongly read as "filled".
    const profile = {
      languageProficiency: {
        English: { read: false, write: false, speak: false, understand: false },
        Filipino: { read: false, write: false, speak: false, understand: false },
        Others: { read: false, write: false, speak: false, understand: false },
      },
    };
    const result = computeProfileCompleteness({}, profile);
    expect(result.filled).toBe(0);
  });

  test("a partially filled profile matches the expected fraction", () => {
    // Exactly 2 of the 16 checked fields present.
    const user = { gender: "Female", skills: ["cooking"] };
    const result = computeProfileCompleteness(user, {});
    expect(result.filled).toBe(2);
    expect(result.percent).toBe(Math.round((2 / result.total) * 100));
  });
});
