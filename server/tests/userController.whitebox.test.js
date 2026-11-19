// White-box branch coverage for server/controllers/userController.js.
// Tests tagged KNOWN-ISSUE pin CURRENT behaviour that looks like a defect (see
// docs/WHITE_BOX_TEST_REPORT.md).

jest.mock("bcryptjs", () => ({ compare: jest.fn(), genSalt: jest.fn(), hash: jest.fn() }));
jest.mock("../models/User", () => ({ findById: jest.fn(), findByIdAndUpdate: jest.fn(), updateOne: jest.fn(), normalizeCompanySize: jest.fn() }));
jest.mock("../models/JobseekerProfile", () => ({ findOne: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock("../models/EmployerProfile", () => ({ findOne: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock("../controllers/authController", () => ({ updateProfile: jest.fn() }));
jest.mock("../services/systemOptionService", () => ({ getActiveValues: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn() }));
jest.mock("../utils/age", () => ({ validateDobInput: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const bcrypt = require("bcryptjs");
const User = require("../models/User");
const JobseekerProfile = require("../models/JobseekerProfile");
const EmployerProfile = require("../models/EmployerProfile");
const authController = require("../controllers/authController");
const { getActiveValues } = require("../services/systemOptionService");
const { logAuditEvent } = require("../services/auditService");
const { validateDobInput } = require("../utils/age");
const ctl = require("../controllers/userController");
const { makeReq, query, failingQuery, call } = require("../testUtils/httpMocks");

const U = "u1";
const dbError = () => new Error("secret db internals");
const ureq = (o = {}) => makeReq({ user: { id: U, _id: U, role: "jobseeker" }, ...o });
const expect500 = (r) => {
  expect(r.status).toBe(500);
  expect(r.body).toEqual({ message: "Something went wrong" });
};

beforeEach(() => {
  jest.resetAllMocks();
  logAuditEvent.mockResolvedValue();
  getActiveValues.mockResolvedValue(new Set());
  validateDobInput.mockReturnValue({ ok: true, date: new Date("2000-01-01"), tier: "adult" });
  User.normalizeCompanySize.mockImplementation((v) => v);
  User.findByIdAndUpdate.mockImplementation(() => query({}));
});

// ---------------------------------------------------------------------------
describe("getProfile", () => {
  test("WB-USR-01 unknown 404", async () => {
    User.findById.mockReturnValue(query(null));
    expect((await call(ctl.getProfile, ureq())).status).toBe(404);
  });

  test.each([["jobseeker", JobseekerProfile, EmployerProfile, "J"], ["employer", EmployerProfile, JobseekerProfile, "E"], ["admin", null, null, null]])(
    "WB-USR-02 %s gets the matching profile (or none); secrets are excluded from the query", async (role, Used, Unused, expected) => {
      const q = query({ _id: U, role });
      User.findById.mockReturnValue(q);
      JobseekerProfile.findOne.mockResolvedValue("J");
      EmployerProfile.findOne.mockResolvedValue("E");
      const { body } = await call(ctl.getProfile, ureq());
      expect(q.select).toHaveBeenCalledWith("-password -backupCodes -recoveryEmailToken -governmentIdOcr.rawText");
      expect(body.profile).toBe(expected);
      if (Unused) expect(Unused.findOne).not.toHaveBeenCalled();
    }
  );

  test("WB-USR-03 failure is a generic 500", async () => {
    User.findById.mockReturnValue(failingQuery(dbError()));
    expect500(await call(ctl.getProfile, ureq()));
  });
});

// ---------------------------------------------------------------------------
describe("completeOnboarding", () => {
  const user = (o = {}) => ({ _id: U, role: "jobseeker", dateOfBirth: new Date("2000-01-01"), ...o });
  const wire = (u) => {
    let n = 0;
    User.findById.mockImplementation(() => query(n++ === 0 ? u : { _id: U, updated: true }));
    JobseekerProfile.findOneAndUpdate.mockResolvedValue({ p: "J" });
    EmployerProfile.findOneAndUpdate.mockResolvedValue({ p: "E" });
  };
  const run = (body = {}, over = {}) => call(ctl.completeOnboarding, ureq({ body, ...over }));
  const userSet = () => User.findByIdAndUpdate.mock.calls[0][1];
  const profileSet = (M = JobseekerProfile) => M.findOneAndUpdate.mock.calls[0][1].$set;

  test("WB-USR-04 unknown user 404", async () => {
    User.findById.mockReturnValue(query(null));
    expect((await run()).status).toBe(404);
  });

  describe("date of birth", () => {
    test("WB-USR-05 a legacy jobseeker/admin with no DOB must supply a valid one (nothing is written otherwise)", async () => {
      wire(user({ dateOfBirth: undefined }));
      validateDobInput.mockReturnValue({ ok: false, code: "DOB_REQUIRED" });
      const r = await run({});
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("DOB_REQUIRED");
      expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
      wire(user({ dateOfBirth: undefined, role: "admin" }));
      expect((await run({})).status).toBe(400);
    });

    test("WB-USR-06 a valid DOB is stored once, locked and sourced; an existing DOB is never overwritten; employers never store one", async () => {
      wire(user({ dateOfBirth: undefined }));
      await run({ dateOfBirth: "2000-01-01" });
      expect(userSet()).toMatchObject({ dateOfBirth: expect.any(Date), dobLockedAt: expect.any(Date), dobSource: "onboarding" });
      User.findByIdAndUpdate.mockClear();
      wire(user());
      await run({ dateOfBirth: "1990-05-05" });
      expect(userSet()).not.toHaveProperty("dateOfBirth");
      expect(validateDobInput).toHaveBeenCalledTimes(1);
      User.findByIdAndUpdate.mockClear();
      wire(user({ role: "employer", dateOfBirth: undefined }));
      await run({ dateOfBirth: "1990-05-05" });
      expect(userSet()).not.toHaveProperty("dateOfBirth");
    });
  });

  describe("jobseeker user fields", () => {
    test("WB-USR-07 completion flags always set; career fields stored (blank becomes null); skills parsed from JSON", async () => {
      wire(user());
      await run({ name: "Ann", desiredJobTitle: "Welder", workExperience: "", educationalAttainment: "College", availabilityStatus: "now", gender: "F", skills: JSON.stringify(["a", "b"]) });
      expect(userSet()).toMatchObject({
        name: "Ann", hasCompletedOnboarding: true, onboardingComplete: true, gender: "F", desiredJobTitle: "Welder",
        workExperience: null, educationalAttainment: "College", availabilityStatus: "now", skills: ["a", "b"],
      });
    });

    test("WB-USR-08 skills: arrays pass through; invalid JSON or non-arrays are ignored; absent is untouched", async () => {
      wire(user());
      await run({ skills: ["x"] });
      expect(userSet().skills).toEqual(["x"]);
      User.findByIdAndUpdate.mockClear();
      wire(user());
      await run({ skills: JSON.stringify({ a: 1 }) });
      expect(userSet()).not.toHaveProperty("skills");
    });

    test("WB-USR-08b KNOWN-ISSUE: invalid JSON in `skills` falls back to [] and is then STORED, wiping the user's skills instead of ignoring the bad value", async () => {
      wire(user());
      await run({ skills: "{bad" });
      expect(userSet().skills).toEqual([]);
    });

    test("WB-USR-09 KNOWN-ISSUE: onboarding has no 'already completed' guard and overwrites career fields and the whole NSRP profile with null/empty defaults for anything not re-sent (a repeat or partial call wipes saved data)", async () => {
      wire(user({ hasCompletedOnboarding: true }));
      const r = await run({});
      expect(r.status).toBe(200);
      expect(userSet()).toMatchObject({ gender: null, desiredJobTitle: null, workExperience: null, educationalAttainment: null, availabilityStatus: null });
      expect(profileSet()).toMatchObject({ civilStatus: null, placeOfBirth: null, citizenship: null, height: null, weight: null, landline: null, preferredIndustries: [] });
    });

    describe("industry preferences", () => {
      test("WB-USR-10 unrestricted when the catalogue is empty; level defaults to flexible and accepts strict/flexible only", async () => {
        wire(user());
        await run({ preferredIndustries: JSON.stringify(["IT", "BPO"]), industryPreferenceLevel: "strict" });
        expect(userSet()).toMatchObject({ preferredIndustries: ["IT", "BPO"], industryPreferenceLevel: "strict" });
        User.findByIdAndUpdate.mockClear();
        wire(user());
        await run({ preferredIndustries: ["IT"], industryPreferenceLevel: "whatever" });
        expect(userSet().industryPreferenceLevel).toBe("flexible");
        User.findByIdAndUpdate.mockClear();
        wire(user());
        await run({ preferredIndustries: ["IT"], industryPreferenceLevel: "flexible" });
        expect(userSet().industryPreferenceLevel).toBe("flexible");
      });

      test("WB-USR-11 filtered to the active catalogue; when NOTHING valid remains the request is 400", async () => {
        getActiveValues.mockResolvedValue(new Set(["IT"]));
        wire(user());
        await run({ preferredIndustries: ["IT", "Nope"] });
        expect(userSet().preferredIndustries).toEqual(["IT"]);
        User.findByIdAndUpdate.mockClear();
        wire(user());
        const r = await run({ preferredIndustries: ["Nope"] });
        expect(r.status).toBe(400);
        expect(r.body.message).toBe("Please select at least one valid industry.");
        expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
      });

      test("WB-USR-12 an explicit empty list clears preferences; invalid JSON (parsed as []) also clears", async () => {
        wire(user());
        await run({ preferredIndustries: "[]" });
        expect(userSet().preferredIndustries).toEqual([]);
        User.findByIdAndUpdate.mockClear();
        wire(user());
        await run({ preferredIndustries: "{bad" });
        expect(userSet().preferredIndustries).toEqual([]);
      });

      test("WB-USR-13 a non-array JSON value (object) neither clears nor sets", async () => {
        wire(user());
        await run({ preferredIndustries: JSON.stringify({ a: 1 }) });
        expect(userSet()).not.toHaveProperty("preferredIndustries");
      });
    });
  });

  describe("employer user fields", () => {
    const emp = () => user({ role: "employer", dateOfBirth: undefined });

    test("WB-USR-14 company fields stored when present; career fields ignored; companySize normalised", async () => {
      wire(emp());
      User.normalizeCompanySize.mockReturnValue("small");
      await run({ companyName: "Acme", industry: "IT", website: "w", companyDescription: "d", businessAddress: "b", companySize: "11-50", desiredJobTitle: "x", skills: "[]" });
      expect(userSet()).toMatchObject({ companyName: "Acme", industry: "IT", website: "w", companyDescription: "d", businessAddress: "b", companySize: "small" });
      expect(userSet()).not.toHaveProperty("desiredJobTitle");
      expect(userSet()).not.toHaveProperty("skills");
    });

    test("WB-USR-15 `name` mirrors the trimmed companyName; blank leaves the submitted name", async () => {
      wire(emp());
      await run({ name: "Personal", companyName: "  Acme  " });
      expect(userSet().name).toBe("Acme");
      User.findByIdAndUpdate.mockClear();
      wire(emp());
      await run({ name: "Personal", companyName: "  " });
      expect(userSet().name).toBe("Personal");
    });
  });

  describe("role profile data", () => {
    test("WB-USR-16 jobseeker NSRP profile: values, boolean strings, unit normalisation, JSON fallbacks", async () => {
      wire(user());
      await run({
        civilStatus: "Single", placeOfBirth: "Boac", citizenship: "Filipino", height: "170.5", weight: "65", landline: "123", mobileSecondary: "09",
        presentAddress: JSON.stringify({ street: "1" }), permanentAddress: { street: "2" }, disability: JSON.stringify(["Visual"]),
        is4psBeneficiary: "true", isOfw: "false", isRepatriated: "true", _4psHouseholdId: "h", repatriationIntent: "r", employmentStatus: "employed",
        employmentType: "wage", unemploymentReason: "x", laidoffCountry: "c", preferredJobTypes: JSON.stringify(["full-time"]),
        preferredWorkNature: ["remote"], industrySelectionStep: "true",
      });
      expect(profileSet()).toMatchObject({
        civilStatus: "Single", civilStatusOther: null, placeOfBirth: "Boac", citizenship: "Filipino", height: 170.5, weight: 65, landline: "123", mobileSecondary: "09",
        presentAddress: { street: "1" }, permanentAddress: { street: "2" }, disability: ["Visual"], is4psBeneficiary: true, isOfw: false, isRepatriated: true,
        _4psHouseholdId: "h", repatriationIntent: "r", employmentStatus: "employed", employmentType: "wage", unemploymentReason: "x", laidoffCountry: "c",
        preferredJobTypes: ["full-time"], preferredWorkNature: ["remote"], industrySelectionStep: true,
      });
    });

    test("WB-USR-17 civilStatusOther is kept only when civilStatus is 'Other'; industrySelectionStep accepts boolean true; invalid JSON falls back", async () => {
      wire(user());
      await run({ civilStatus: "Other", civilStatusOther: "Annulled", industrySelectionStep: true, presentAddress: "{bad", disability: "{bad", preferredJobTypes: "{bad" });
      expect(profileSet()).toMatchObject({
        civilStatusOther: "Annulled", industrySelectionStep: true, disability: [], preferredJobTypes: [], preferredWorkNature: [],
        presentAddress: { street: "", barangay: "", municipality: "", province: "", region: "" },
      });
      JobseekerProfile.findOneAndUpdate.mockClear();
      wire(user());
      await run({ civilStatus: "Other" });
      expect(profileSet().civilStatusOther).toBeNull();
      JobseekerProfile.findOneAndUpdate.mockClear();
      wire(user());
      await run({ industrySelectionStep: "no" });
      expect(profileSet().industrySelectionStep).toBe(false);
    });

    test("WB-USR-18 KNOWN-ISSUE: boolean flags only count as true for the STRING 'true' (a JSON boolean true is stored false)", async () => {
      wire(user());
      await run({ is4psBeneficiary: true, isOfw: true, isRepatriated: true });
      expect(profileSet()).toMatchObject({ is4psBeneficiary: false, isOfw: false, isRepatriated: false });
    });

    test("WB-USR-19 the jobseeker profile mirrors the validated industry list", async () => {
      wire(user());
      await run({ preferredIndustries: ["IT"] });
      expect(profileSet().preferredIndustries).toEqual(["IT"]);
    });

    test("WB-USR-20 employer profile: values and parsed JSON with fallbacks, into the EMPLOYER collection only", async () => {
      wire(user({ role: "employer", dateOfBirth: undefined }));
      await run({
        tradeName: "T", acronym: "A", tin: "123", officeType: "main", employerClassification: JSON.stringify({ type: "private", subtype: "Direct Hire" }),
        totalWorkforceSize: "small", businessAddressStructured: JSON.stringify({ street: "s" }), ownerName: "O", contactPersonName: "C", contactPersonPosition: "P", fax: "1",
      });
      expect(profileSet(EmployerProfile)).toMatchObject({
        tradeName: "T", tin: "123", employerClassification: { type: "private", subtype: "Direct Hire" }, businessAddress: { street: "s" }, fax: "1",
      });
      expect(JobseekerProfile.findOneAndUpdate).not.toHaveBeenCalled();
      EmployerProfile.findOneAndUpdate.mockClear();
      wire(user({ role: "employer", dateOfBirth: undefined }));
      await run({ employerClassification: "{bad", businessAddressStructured: "{bad" });
      expect(profileSet(EmployerProfile)).toMatchObject({
        tradeName: null, employerClassification: { type: null, subtype: null }, businessAddress: { street: "", barangay: "", municipality: "", province: "", region: "" },
      });
    });

    test("WB-USR-21 other roles (admin) get no role profile at all; the response carries the updated user and profile; audit written", async () => {
      wire(user({ role: "admin" }));
      const r = await run({});
      expect(JobseekerProfile.findOneAndUpdate).not.toHaveBeenCalled();
      expect(EmployerProfile.findOneAndUpdate).not.toHaveBeenCalled();
      expect(r.body).toEqual({ message: "Onboarding completed", user: { _id: U, updated: true }, profile: null });
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "user.profile.onboarding_completed" }));
      wire(user());
      expect((await run({})).body.profile).toEqual({ p: "J" });
    });
  });

  test("WB-USR-22 user id falls back to req.user.id; failure is a generic 500", async () => {
    wire(user());
    await call(ctl.completeOnboarding, makeReq({ user: { id: "only-id" }, body: {} }));
    expect(User.findById.mock.calls[0][0]).toBe("only-id");
    User.findById.mockReturnValue(failingQuery(dbError()));
    expect500(await run());
  });
});

// ---------------------------------------------------------------------------
describe("updateProfile re-export", () => {
  test("WB-USR-23 userController.updateProfile is authController.updateProfile (single implementation)", () => {
    expect(ctl.updateProfile).toBe(authController.updateProfile);
  });
});

// ---------------------------------------------------------------------------
describe("uploads", () => {
  test.each([["uploadProfileImage", "profileImage", "user.profile_image.uploaded", "imageUrl"], ["uploadResume", "resumeFile", "user.resume.uploaded", "resume"]])(
    "WB-USR-24 %s: no stored file is 400; success updates only that column, audits, returns the URL", async (name, column, action) => {
      expect((await call(ctl[name], ureq({ file: undefined }))).status).toBe(400);
      expect((await call(ctl[name], ureq({ file: {} }))).status).toBe(400);
      expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
      const q = query({ _id: U });
      User.findByIdAndUpdate.mockReturnValue(q);
      const r = await call(ctl[name], ureq({ file: { storedValue: "f.png" } }));
      expect(User.findByIdAndUpdate).toHaveBeenCalledWith(U, { [column]: "f.png" }, { new: true });
      expect(q.select).toHaveBeenCalledWith("-password -backupCodes -recoveryEmailToken -governmentIdOcr.rawText");
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action }));
      expect(r.status).toBe(200);
      User.findByIdAndUpdate.mockReturnValue(failingQuery(dbError()));
      expect500(await call(ctl[name], ureq({ file: { storedValue: "f.png" } })));
    }
  );
});

// ---------------------------------------------------------------------------
describe("changePassword (legacy controller)", () => {
  const run = (body) => call(ctl.changePassword, ureq({ body }));
  const doc = (o = {}) => ({ password: "h:old", tokenVersion: 1, save: jest.fn().mockResolvedValue(), ...o });

  test("WB-USR-25 unknown user 404; Google-only account (no password) 400", async () => {
    User.findById.mockResolvedValue(null);
    expect((await run({ currentPassword: "a", newPassword: "b" })).status).toBe(404);
    User.findById.mockResolvedValue(doc({ password: undefined }));
    expect((await run({ currentPassword: "a", newPassword: "b" })).status).toBe(400);
  });

  test("WB-USR-26 wrong current password is 401", async () => {
    User.findById.mockResolvedValue(doc());
    bcrypt.compare.mockResolvedValue(false);
    const r = await run({ currentPassword: "bad", newPassword: "NewPass1!" });
    expect(r.status).toBe(401);
    expect(r.body.message).toBe("Current password is incorrect");
  });

  test("WB-USR-27 success: new hash, tokenVersion bumped (from 0 when unset)", async () => {
    const d = doc({ tokenVersion: undefined });
    User.findById.mockResolvedValue(d);
    bcrypt.compare.mockResolvedValue(true);
    bcrypt.genSalt.mockResolvedValue("salt");
    bcrypt.hash.mockResolvedValue("hashed");
    const r = await run({ currentPassword: "old", newPassword: "NewPass1!" });
    expect(bcrypt.hash).toHaveBeenCalledWith("NewPass1!", "salt");
    expect(d).toMatchObject({ password: "hashed", tokenVersion: 1 });
    expect(d.save).toHaveBeenCalledWith({ validateModifiedOnly: true });
    expect(r.body.message).toBe("Password changed successfully");
  });

  test("WB-USR-28 KNOWN-ISSUE: this older implementation has no lockout (a wrong guess is just a 401 with no failure counter), no password-policy check, no 'must differ from the current password' check, no notification email and returns no fresh token, unlike authController.changePassword", async () => {
    const d = doc({ password: "h:old" });
    User.findById.mockResolvedValue(d);
    bcrypt.compare.mockResolvedValue(true);
    bcrypt.genSalt.mockResolvedValue("s");
    bcrypt.hash.mockResolvedValue("h");
    const same = await run({ currentPassword: "old", newPassword: "old" });
    expect(same.status).toBe(200);
    expect(same.body).toEqual({ message: "Password changed successfully" });
    const weak = await run({ currentPassword: "old", newPassword: "a" });
    expect(weak.status).toBe(200);
  });

  test("WB-USR-29 a missing new password fails inside bcrypt and is a generic 500", async () => {
    User.findById.mockResolvedValue(doc());
    bcrypt.compare.mockResolvedValue(true);
    bcrypt.genSalt.mockResolvedValue("s");
    bcrypt.hash.mockRejectedValue(new Error("Illegal arguments: undefined, string"));
    expect500(await run({ currentPassword: "old" }));
  });
});

// ---------------------------------------------------------------------------
describe("setMyDateOfBirth", () => {
  const run = (body = { dateOfBirth: "2000-01-01" }) => call(ctl.setMyDateOfBirth, ureq({ body }));
  const wire = (u) => User.findById.mockReturnValue(query(u));

  test("WB-USR-30 unknown 404; employer 400 DOB_NOT_APPLICABLE; an existing DOB is locked (409)", async () => {
    wire(null);
    expect((await run()).status).toBe(404);
    wire({ role: "employer" });
    expect((await run()).body.code).toBe("DOB_NOT_APPLICABLE");
    wire({ role: "jobseeker", dateOfBirth: new Date() });
    const r = await run();
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("DOB_LOCKED");
    expect(User.updateOne).not.toHaveBeenCalled();
  });

  test("WB-USR-31 an UNDER-MINIMUM-AGE date is not stored: the account is flagged for admin review (nothing deleted), audited as a warning, and the answer is 403", async () => {
    wire({ role: "jobseeker" });
    validateDobInput.mockReturnValue({ ok: false, code: "AGE_UNDER_MINIMUM" });
    User.updateOne.mockResolvedValue();
    const r = await run();
    expect(r.status).toBe(403);
    expect(User.updateOne).toHaveBeenCalledWith({ _id: U }, { $set: { ageReviewRequired: true } });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "user.age_review.flagged", severity: "warning", metadata: { tier: "under15", source: "legacy_prompt" } }));
    expect(JSON.stringify(logAuditEvent.mock.calls[0][0].metadata)).not.toContain("2000");
  });

  test("WB-USR-32 any other invalid date is a plain 400 with no flag and no audit", async () => {
    wire({ role: "jobseeker" });
    validateDobInput.mockReturnValue({ ok: false, code: "DOB_INVALID" });
    const r = await run();
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("DOB_INVALID");
    expect(User.updateOne).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  test("WB-USR-33 a valid date is stored locked, clears the age-review flag, and returns only the age tier", async () => {
    wire({ role: "jobseeker", ageReviewRequired: true });
    User.updateOne.mockResolvedValue();
    const r = await run();
    expect(User.updateOne).toHaveBeenCalledWith({ _id: U }, { $set: { dateOfBirth: expect.any(Date), dobLockedAt: expect.any(Date), dobSource: "legacy_prompt", ageReviewRequired: false } });
    expect(r.body).toEqual({ message: "Date of birth saved.", ageTier: "adult" });
  });

  test("WB-USR-34 user id falls back to req.user.id; failure is a generic 500", async () => {
    wire({ role: "jobseeker" });
    User.updateOne.mockResolvedValue();
    await call(ctl.setMyDateOfBirth, makeReq({ user: { id: "only-id" }, body: {} }));
    expect(User.findById).toHaveBeenCalledWith("only-id");
    User.findById.mockReturnValue(failingQuery(dbError()));
    expect500(await run());
  });
});
