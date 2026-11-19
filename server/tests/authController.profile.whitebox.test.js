// White-box branch coverage for authController.updateProfile.
// Tests tagged KNOWN-ISSUE pin CURRENT behaviour that looks like a defect (see
// docs/WHITE_BOX_TEST_REPORT.md).

jest.mock("../models/User", () => require("../testUtils/authMocks").User);
jest.mock("../models/JobseekerProfile", () => require("../testUtils/authMocks").JobseekerProfile);
jest.mock("../models/EmployerProfile", () => require("../testUtils/authMocks").EmployerProfile);
jest.mock("../models/SystemSettings", () => require("../testUtils/authMocks").SystemSettings);
jest.mock("../models/ReservedUsername", () => require("../testUtils/authMocks").ReservedUsername);
jest.mock("bcryptjs", () => require("../testUtils/authMocks").bcrypt);
jest.mock("../services/systemOptionService", () => require("../testUtils/authMocks").systemOptionService);
jest.mock("../services/bannerTemplateService", () => require("../testUtils/authMocks").bannerTemplateService);
jest.mock("../services/avatarPresetService", () => require("../testUtils/authMocks").avatarPresetService);
jest.mock("../services/storageService", () => require("../testUtils/authMocks").storageService);
jest.mock("../services/auditService", () => require("../testUtils/authMocks").auditService);
jest.mock("../services/notificationService", () => require("../testUtils/authMocks").notificationService);
jest.mock("../services/sessionService", () => require("../testUtils/authMocks").sessionService);
jest.mock("../services/mailService", () => require("../testUtils/authMocks").mailService);
jest.mock("../services/loginLockService", () => require("../testUtils/authMocks").loginLock);
jest.mock("../services/accountAlertService", () => require("../testUtils/authMocks").accountAlerts);
jest.mock("../services/idOcrService", () => require("../testUtils/authMocks").idOcr);
jest.mock("../utils/logger", () => require("../testUtils/authMocks").logger);
jest.mock("../utils/passwordPolicy", () => require("../testUtils/authMocks").passwordPolicy);
jest.mock("../utils/phone", () => require("../testUtils/authMocks").phone);
jest.mock("../utils/username", () => require("../testUtils/authMocks").usernameUtil);
jest.mock("../utils/usernameSignup", () => require("../testUtils/authMocks").usernameSignup);
jest.mock("../utils/sessionUser", () => require("../testUtils/authMocks").sessionUser);
jest.mock("../utils/age", () => require("../testUtils/authMocks").age);
jest.mock("../utils/clientUrl", () => require("../testUtils/authMocks").clientUrl);
jest.mock("google-auth-library", () => require("../testUtils/authMocks").google);

const jwt = require("jsonwebtoken");
const mocks = require("../testUtils/authMocks");
const { User, JobseekerProfile, EmployerProfile, bcrypt, mailService, accountAlerts, passwordPolicy, usernameSignup, age, phone,
  auditService, systemOptionService, idOcr } = mocks;
const { GOVERNMENT_ID_TYPE_OTHER } = require("../data/governmentIdTypes");
const ctl = require("../controllers/authController");
const { makeReq, query, failingQuery, call } = require("../testUtils/httpMocks");

const flush = () => new Promise((r) => setImmediate(r));
const STRONG = "Str0ng!Pass";
const OLD_PW = "Current!Pass1";

const mkCurrent = (o = {}) => ({ _id: "u1", role: "jobseeker", email: "a@x.com", name: "Ann", password: `h:${OLD_PW}`, verificationStatus: "unverified", ...o });
const run = (body, over = {}) => call(ctl.updateProfile, makeReq({ user: { id: "u1", _id: "u1", role: "jobseeker" }, body, ...over }));
// First findById is the current user, the second (after the writes) the updated user.
const setup = (current = mkCurrent(), updated = { _id: "u1", role: current && current.role }) => {
  let calls = 0;
  User.findById.mockImplementation(() => query(calls++ === 0 ? current : updated));
};
const userUpdate = () => User.findByIdAndUpdate.mock.calls[0][1];
const profileSet = (model = JobseekerProfile) => model.findOneAndUpdate.mock.calls[0][1].$set;

let errSpy;
beforeEach(() => {
  jest.resetAllMocks();
  mocks.resetAuthMocks();
  errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errSpy.mockRestore());

// ---------------------------------------------------------------------------
describe("updateProfile: basics", () => {
  test("WB-PROF-01 unknown user is 404 and nothing is written", async () => {
    User.findById.mockReturnValue(query(null));
    expect((await run({ name: "X" })).status).toBe(404);
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("WB-PROF-02 `email` in the payload is always ignored (changing it goes through the verified flow)", async () => {
    setup();
    const req = makeReq({ user: { id: "u1" }, body: { email: "evil@x.com", name: "New" } });
    await call(ctl.updateProfile, req);
    expect(req.body.email).toBeUndefined();
    expect(userUpdate()).not.toHaveProperty("email");
    expect(userUpdate().name).toBe("New");
  });

  test("WB-PROF-03 an empty payload writes nothing (no user update, no profile upsert) but still returns the current state; uploadsCommitted stays unset", async () => {
    setup();
    const req = makeReq({ user: { id: "u1" }, body: {} });
    const { body } = await call(ctl.updateProfile, req);
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(JobseekerProfile.findOneAndUpdate).not.toHaveBeenCalled();
    expect(req.uploadsCommitted).toBeUndefined();
    expect(body.message).toBe("Profile updated successfully");
    expect(body.profile).toBeNull();
  });

  test("WB-PROF-04 updates run with validators on the query; undefined fields are dropped; uploadsCommitted is set", async () => {
    setup();
    const req = makeReq({ user: { id: "u1" }, body: { name: "New", phone: "09171234567", about: "hi" } });
    await call(ctl.updateProfile, req);
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith("u1", { name: "New", phone: "+639171234567", about: "hi" }, { runValidators: true, context: "query" });
    expect(req.uploadsCommitted).toBe(true);
  });

  test("WB-PROF-05 user id falls back to req.user.id when _id is absent", async () => {
    setup();
    await call(ctl.updateProfile, makeReq({ user: { id: "only-id" }, body: { name: "N" } }));
    expect(User.findByIdAndUpdate.mock.calls[0][0]).toBe("only-id");
  });

  test("WB-PROF-06 name parts compose the display name and null the blank parts; the composed name wins over `name`", async () => {
    setup();
    await run({ name: "Ignored", firstName: "Ann", surname: "Cruz" });
    expect(userUpdate()).toMatchObject({ surname: "Cruz", firstName: "Ann", middleName: null, suffix: null, name: "Ann Cruz" });
  });

  test("WB-PROF-07 gender: value stored, blank becomes null", async () => {
    setup();
    await run({ gender: "Female" });
    expect(userUpdate().gender).toBe("Female");
    User.findByIdAndUpdate.mockClear();
    setup();
    await run({ gender: "" });
    expect(userUpdate().gender).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("updateProfile: staff password change", () => {
  const staff = (o = {}) => mkCurrent({ role: "admin", ...o });
  const staffRun = (body, over) => run(body, { user: { id: "u1", role: "admin" }, ...over });

  test("WB-PROF-08 wrong current password is 400; password reuse and weak/short passwords are refused", async () => {
    setup(staff());
    let r = await staffRun({ newPassword: STRONG, currentPassword: "wrong" });
    expect(r.body.message).toBe("Current password is incorrect");
    setup(staff());
    r = await staffRun({ newPassword: "short", currentPassword: OLD_PW });
    expect(r.body.message).toMatch(/at least 8/);
    setup(staff());
    passwordPolicy.enforce.mockReturnValue({ ok: false, code: "PASSWORD_COMMON", message: "weak" });
    r = await staffRun({ newPassword: STRONG, currentPassword: OLD_PW });
    expect(r.body).toEqual({ code: "PASSWORD_COMMON", message: "weak" });
    passwordPolicy.enforce.mockReturnValue({ ok: true });
    setup(staff({ password: `h:${STRONG}` }));
    r = await staffRun({ newPassword: STRONG, currentPassword: `${STRONG}` });
    expect(r.body.message).toMatch(/must be different/);
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("WB-PROF-09 a missing/blank current password never matches; a staff user with no stored password cannot change it", async () => {
    setup(staff());
    expect((await staffRun({ newPassword: STRONG })).status).toBe(400);
    setup(staff({ password: undefined }));
    expect((await staffRun({ newPassword: STRONG, currentPassword: "" })).status).toBe(400);
  });

  test("WB-PROF-10 success: hashed, tokenVersion incremented atomically, fresh token returned, notices sent, audited", async () => {
    setup(staff());
    User.findByIdAndUpdate.mockImplementation(() => query({ _id: "u1", role: "admin", tokenVersion: 7 }));
    const r = await staffRun({ newPassword: STRONG, currentPassword: OLD_PW });
    const rotateCall = User.findByIdAndUpdate.mock.calls.find((c) => c[1].$set);
    expect(rotateCall[1]).toEqual({ $set: { password: `h:${STRONG}`, mustChangePassword: false }, $inc: { tokenVersion: 1 } });
    expect(jwt.verify(r.body.token, "test-secret")).toMatchObject({ id: "u1", role: "admin", tokenVersion: 7 });
    expect(mailService.sendPasswordChangedEmail).toHaveBeenCalled();
    expect(accountAlerts.notifyPasswordChanged).toHaveBeenCalled();
    expect(auditService.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "user.password.changed" }));
  });

  test("WB-PROF-11 rotation returning no document gives no token; no stored email means no notice mail; failing mail is only logged; failing audit is non-fatal", async () => {
    setup(staff({ email: undefined }));
    User.findByIdAndUpdate.mockImplementation(() => query(null));
    let r = await staffRun({ newPassword: STRONG, currentPassword: OLD_PW });
    expect(r.body.token).toBeUndefined();
    expect(mailService.sendPasswordChangedEmail).not.toHaveBeenCalled();
    setup(staff());
    User.findByIdAndUpdate.mockImplementation(() => query({ _id: "u1", role: "admin", tokenVersion: 1 }));
    mailService.sendPasswordChangedEmail.mockRejectedValue(new Error("smtp"));
    auditService.logAuditEvent.mockRejectedValue(new Error("x"));
    r = await staffRun({ newPassword: STRONG, currentPassword: OLD_PW });
    await flush();
    expect(r.status).toBe(200);
    expect(mocks.logger.error).toHaveBeenCalledWith(expect.stringContaining("password-changed"), expect.anything());
  });

  test("WB-PROF-12 `newPassword` from a NON-staff user is ignored entirely", async () => {
    setup(mkCurrent({ role: "jobseeker" }));
    const r = await run({ newPassword: STRONG, currentPassword: "wrong", name: "N" });
    expect(r.status).toBe(200);
    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(User.findByIdAndUpdate.mock.calls.every((c) => !c[1].$set)).toBe(true);
    expect(userUpdate()).not.toHaveProperty("password");
  });

  test("WB-PROF-13 superadmin may change its own password too", async () => {
    setup(staff({ role: "superadmin" }));
    User.findByIdAndUpdate.mockImplementation(() => query({ _id: "u1", role: "superadmin", tokenVersion: 1 }));
    expect((await staffRun({ newPassword: STRONG, currentPassword: OLD_PW })).body.token).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
describe("updateProfile: date of birth lock", () => {
  test("WB-PROF-14 employers never store a DOB (field ignored); absent field is skipped", async () => {
    setup(mkCurrent({ role: "employer" }));
    await run({ dateOfBirth: "2000-01-01", name: "N" });
    expect(userUpdate()).not.toHaveProperty("dateOfBirth");
    expect(age.validateDobInput).not.toHaveBeenCalled();
  });

  test("WB-PROF-15 once set, the DOB is locked: an unchanged value is ignored, a different (or unparseable) one is 403 DOB_LOCKED", async () => {
    setup(mkCurrent({ dateOfBirth: "2000-01-01" }));
    await run({ dateOfBirth: "2000-01-01", name: "N" });
    expect(userUpdate()).not.toHaveProperty("dateOfBirth");
    setup(mkCurrent({ dateOfBirth: "2000-01-01" }));
    let r = await run({ dateOfBirth: "2001-02-02" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("DOB_LOCKED");
    setup(mkCurrent({ dateOfBirth: "2000-01-01" }));
    age.parseDateOnly.mockImplementation((v) => (v === "garbage" ? null : new Date(v)));
    r = await run({ dateOfBirth: "garbage" });
    expect(r.status).toBe(403);
  });

  test("WB-PROF-16 a legacy account with no DOB can set it once, validated, locked and sourced", async () => {
    setup(mkCurrent({ dateOfBirth: undefined }));
    await run({ dateOfBirth: "2000-01-01" });
    expect(userUpdate()).toMatchObject({ dateOfBirth: expect.any(Date), dobLockedAt: expect.any(Date), dobSource: "legacy_prompt" });
    setup(mkCurrent({ dateOfBirth: undefined }));
    age.validateDobInput.mockReturnValue({ ok: false, code: "DOB_UNDER_MINIMUM_AGE" });
    const r = await run({ dateOfBirth: "2020-01-01" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("DOB_UNDER_MINIMUM_AGE");
  });
});

// ---------------------------------------------------------------------------
describe("updateProfile: government ID fields", () => {
  test("WB-PROF-17 a blank type clears the type AND its 'other' text", async () => {
    setup();
    await run({ governmentIdType: "" });
    expect(userUpdate()).toMatchObject({ governmentIdType: null, governmentIdTypeOther: null });
  });

  test("WB-PROF-18 type accepted when the catalogue is empty or contains it; 'Other' keeps the free text, anything else clears it; unknown types are silently ignored", async () => {
    setup();
    await run({ governmentIdType: "Passport", governmentIdTypeOther: "stale" });
    expect(userUpdate()).toMatchObject({ governmentIdType: "Passport", governmentIdTypeOther: null });
    User.findByIdAndUpdate.mockClear();
    systemOptionService.getActiveValues.mockResolvedValue(new Set(["Passport", GOVERNMENT_ID_TYPE_OTHER]));
    setup();
    await run({ governmentIdType: GOVERNMENT_ID_TYPE_OTHER, governmentIdTypeOther: "My ID" });
    expect(userUpdate()).toMatchObject({ governmentIdType: GOVERNMENT_ID_TYPE_OTHER, governmentIdTypeOther: "My ID" });
    User.findByIdAndUpdate.mockClear();
    setup();
    await run({ governmentIdType: "Library Card", name: "N" });
    expect(userUpdate()).not.toHaveProperty("governmentIdType");
  });

  test("WB-PROF-19 number stored or nulled; 'other' text on its own is stored (null when blank)", async () => {
    setup();
    await run({ governmentIdNumber: "123", governmentIdTypeOther: "Free text" });
    expect(userUpdate()).toMatchObject({ governmentIdNumber: "123", governmentIdTypeOther: "Free text" });
    User.findByIdAndUpdate.mockClear();
    setup();
    await run({ governmentIdNumber: "", governmentIdTypeOther: "" });
    expect(userUpdate()).toMatchObject({ governmentIdNumber: null, governmentIdTypeOther: null });
  });
});

// ---------------------------------------------------------------------------
describe("updateProfile: role-specific user fields", () => {
  describe("jobseeker", () => {
    test("WB-PROF-20 career fields stored; blank becomes null; absent fields untouched", async () => {
      setup();
      await run({ desiredJobTitle: "Welder", workExperience: "", educationalAttainment: "College", availabilityStatus: "Immediate" });
      expect(userUpdate()).toMatchObject({ desiredJobTitle: "Welder", workExperience: null, educationalAttainment: "College", availabilityStatus: "Immediate" });
    });

    test("WB-PROF-21 desiredJobTitle follows the first preferred occupation (string JSON, array, empty, invalid)", async () => {
      setup();
      await run({ desiredJobTitle: "Old", preferredOccupations: JSON.stringify(["Cook", "Chef"]) });
      expect(userUpdate().desiredJobTitle).toBe("Cook");
      User.findByIdAndUpdate.mockClear();
      setup();
      await run({ desiredJobTitle: "Old", preferredOccupations: ["Baker"] });
      expect(userUpdate().desiredJobTitle).toBe("Baker");
      User.findByIdAndUpdate.mockClear();
      setup();
      await run({ desiredJobTitle: "Old", preferredOccupations: "[]" });
      expect(userUpdate().desiredJobTitle).toBe("Old");
      User.findByIdAndUpdate.mockClear();
      setup();
      await run({ desiredJobTitle: "Old", preferredOccupations: "{not json" });
      expect(userUpdate().desiredJobTitle).toBe("Old");
    });

    test("WB-PROF-22 industry preferences: unrestricted when the catalogue is empty; filtered to active values otherwise; nothing valid means no update", async () => {
      setup();
      await run({ preferredIndustries: JSON.stringify(["IT", "Anything"]) });
      expect(userUpdate().preferredIndustries).toEqual(["IT", "Anything"]);
      User.findByIdAndUpdate.mockClear();
      systemOptionService.getActiveValues.mockResolvedValue(new Set(["IT"]));
      setup();
      await run({ preferredIndustries: ["IT", "Nope"] });
      expect(userUpdate().preferredIndustries).toEqual(["IT"]);
      User.findByIdAndUpdate.mockClear();
      setup();
      await run({ preferredIndustries: ["Nope"], name: "N" });
      expect(userUpdate()).not.toHaveProperty("preferredIndustries");
      User.findByIdAndUpdate.mockClear();
      setup();
      await run({ preferredIndustries: "[]", name: "N" });
      expect(userUpdate()).not.toHaveProperty("preferredIndustries");
    });

    test.each([["strict", true], ["flexible", true], ["maybe", false], ["", false]])("WB-PROF-23 industryPreferenceLevel %p stored=%p", async (level, stored) => {
      setup();
      await run({ industryPreferenceLevel: level, name: "N" });
      expect("industryPreferenceLevel" in userUpdate()).toBe(stored);
    });

    test("WB-PROF-24 employer-only fields are ignored for jobseekers", async () => {
      setup();
      await run({ companyName: "Evil Co", name: "N" });
      expect(userUpdate()).not.toHaveProperty("companyName");
    });
  });

  describe("employer", () => {
    const emp = () => mkCurrent({ role: "employer" });

    test("WB-PROF-25 company fields stored when present; companySize normalised; career fields ignored", async () => {
      setup(emp());
      User.normalizeCompanySize.mockReturnValue("small");
      await run({ companyName: "Acme", industry: "IT", website: "w", companyDescription: "d", businessAddress: "b", companySize: "11-50", desiredJobTitle: "x" });
      expect(userUpdate()).toMatchObject({ companyName: "Acme", industry: "IT", website: "w", companyDescription: "d", businessAddress: "b", companySize: "small" });
      expect(userUpdate()).not.toHaveProperty("desiredJobTitle");
      expect(User.normalizeCompanySize).toHaveBeenCalledWith("11-50");
    });

    test("WB-PROF-26 `name` mirrors the trimmed companyName; a blank companyName leaves `name` alone", async () => {
      setup(emp());
      await run({ name: "Personal", companyName: "  Acme  " });
      expect(userUpdate().name).toBe("Acme");
      User.findByIdAndUpdate.mockClear();
      setup(emp());
      await run({ name: "Personal", companyName: "   " });
      expect(userUpdate().name).toBe("Personal");
    });
  });
});

// ---------------------------------------------------------------------------
describe("updateProfile: files and removals", () => {
  const files = (o) => ({ files: o });
  const f = (v) => [{ storedValue: v }];

  test("WB-PROF-27 resumeFile and validIdFile uploads are stored; the ID upload stamps governmentIdSubmittedAt", async () => {
    setup();
    await run({}, files({ resumeFile: f("r.pdf"), validIdFile: f("id.png") }));
    expect(userUpdate()).toMatchObject({ resumeFile: "r.pdf", validIdFile: "id.png", governmentIdSubmittedAt: expect.any(Date) });
  });

  test("WB-PROF-28 alternate field names `resume` and `supportingDocument` map to the same columns", async () => {
    setup();
    await run({}, files({ resume: f("r2.pdf"), supportingDocument: f("id2.png") }));
    expect(userUpdate()).toMatchObject({ resumeFile: "r2.pdf", validIdFile: "id2.png", governmentIdSubmittedAt: expect.any(Date) });
  });

  test("WB-PROF-29 uploads without a storedValue are ignored", async () => {
    setup();
    await run({ name: "N" }, files({ resumeFile: [{}], validIdFile: [], businessPermit: [{}] }));
    expect(userUpdate()).toEqual({ name: "N" });
  });

  test.each([["unverified", true], ["rejected", true], [undefined, true], ["pending", false], ["verified", false]])(
    "WB-PROF-30 verification documents with status %s can be replaced=%p", async (status, allowed) => {
      setup(mkCurrent({ role: "employer", verificationStatus: status }));
      await run({ name: "N" }, files({ businessPermit: f("bp.pdf"), registrationDoc: f("reg.pdf") }));
      expect("businessPermitUrl" in userUpdate()).toBe(allowed);
      expect("registrationDocUrl" in userUpdate()).toBe(allowed);
    }
  );

  test("WB-PROF-31 explicit clears: sentinel values null the column; non-sentinel values do not", async () => {
    setup();
    await run({ resumeFile: "remove", businessPermit: "keep.pdf" });
    expect(userUpdate().resumeFile).toBeNull();
    expect(userUpdate()).not.toHaveProperty("businessPermitUrl");
  });

  test("WB-PROF-32 while verification is pending/verified, clearing the permit or registration doc is blocked", async () => {
    setup(mkCurrent({ role: "employer", verificationStatus: "pending" }));
    await run({ businessPermit: "clear", registrationDoc: "clear", name: "N" });
    expect(userUpdate()).toEqual({ name: "N" });
    User.findByIdAndUpdate.mockClear();
    setup(mkCurrent({ role: "employer", verificationStatus: "unverified" }));
    await run({ businessPermit: "clear", registrationDoc: "clear" });
    expect(userUpdate()).toMatchObject({ businessPermitUrl: null, registrationDocUrl: null });
  });

  test("WB-PROF-33 clearing the ID file also clears what it described (type, number, other, OCR, submitted-at)", async () => {
    setup();
    await run({ validIdFile: "" });
    expect(userUpdate()).toMatchObject({
      validIdFile: null, governmentIdOcr: { status: "none" }, governmentIdType: null, governmentIdNumber: null,
      governmentIdTypeOther: null, governmentIdSubmittedAt: null,
    });
  });

  test("WB-PROF-34 a jobseeker ID upload queues OCR with a run id and schedules it after the write; employers and cancelled requests do not", async () => {
    setup();
    const req = makeReq({ user: { id: "u1" }, body: {}, files: { validIdFile: f("id.png") }, releaseOcrSlot: jest.fn() });
    await call(ctl.updateProfile, req);
    const queued = userUpdate().governmentIdOcr;
    expect(queued.status).toBe("queued");
    expect(queued.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(req.ocrScheduled).toBe(true);
    expect(idOcr.scheduleIdOcr).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", runId: queued.runId, release: req.releaseOcrSlot }));
    idOcr.scheduleIdOcr.mockClear();
    User.findByIdAndUpdate.mockClear();
    setup();
    const cancelled = makeReq({ user: { id: "u1" }, body: {}, files: { validIdFile: f("id.png") }, ocrCancelled: true });
    await call(ctl.updateProfile, cancelled);
    expect(idOcr.scheduleIdOcr).not.toHaveBeenCalled();
    User.findByIdAndUpdate.mockClear();
    setup(mkCurrent({ role: "employer" }));
    await run({}, files({ validIdFile: f("id.png") }));
    expect(userUpdate()).not.toHaveProperty("governmentIdOcr");
    expect(idOcr.scheduleIdOcr).not.toHaveBeenCalled();
  });

  test("WB-PROF-35 supportingDocument is preferred as the OCR source file; an upload with no storedValue is not OCR'd", async () => {
    setup();
    const req = makeReq({ user: { id: "u1" }, body: {}, files: { supportingDocument: f("a.png"), validIdFile: f("b.png") } });
    await call(ctl.updateProfile, req);
    expect(idOcr.scheduleIdOcr.mock.calls[0][0].file).toEqual({ storedValue: "a.png" });
  });
});

// ---------------------------------------------------------------------------
describe("updateProfile: onboarding completion", () => {
  test.each([[true], ["true"]])("WB-PROF-36 onboardingComplete=%p sets both completion flags", async (v) => {
    setup();
    await run({ onboardingComplete: v });
    expect(userUpdate()).toMatchObject({ hasCompletedOnboarding: true, onboardingComplete: true });
  });

  test.each([[false], ["false"], ["1"], [undefined]])("WB-PROF-37 onboardingComplete=%p does not", async (v) => {
    setup();
    await run({ onboardingComplete: v, name: "N" });
    expect(userUpdate()).not.toHaveProperty("hasCompletedOnboarding");
  });

  describe("phone requirement (feature flag on)", () => {
    beforeEach(() => usernameSignup.isUsernameSignupEnabled.mockReturnValue(true));

    test.each([
      ["PHONE_REQUIRED", "Add your phone number to finish setting up."],
      ["PHONE_INVALID", "Enter a valid phone number."],
    ])("WB-PROF-38 problem %s blocks completion with a field-level 400", async (code, message) => {
      setup();
      phone.phoneProblem.mockReturnValue(code);
      const r = await run({ onboardingComplete: true });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ code, message, field: "phone" });
      expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    test("WB-PROF-39 the phone saved in the SAME request counts; otherwise the stored phone is used", async () => {
      setup(mkCurrent({ phone: "stored" }));
      await run({ onboardingComplete: true, phone: "09171234567" });
      expect(phone.phoneProblem).toHaveBeenCalledWith("+639171234567");
      setup(mkCurrent({ phone: "stored" }));
      await run({ onboardingComplete: true });
      expect(phone.phoneProblem).toHaveBeenLastCalledWith("stored");
    });

    test("WB-PROF-40 employers and the flag-off case skip the phone requirement", async () => {
      phone.phoneProblem.mockReturnValue("PHONE_REQUIRED");
      setup(mkCurrent({ role: "employer" }));
      expect((await run({ onboardingComplete: true })).status).toBe(200);
      usernameSignup.isUsernameSignupEnabled.mockReturnValue(false);
      setup();
      expect((await run({ onboardingComplete: true })).status).toBe(200);
    });
  });
});

// ---------------------------------------------------------------------------
describe("updateProfile: jobseeker profile (NSRP) fields", () => {
  test.each([
    "placeOfBirth", "landline", "_4psHouseholdId", "repatriationIntent", "laidoffCountry", "passportNo", "passportExpiryDate", "religion", "tin", "sssGsisNo", "pagibigNo",
    "philhealthNo", "schoolAttended", "schoolAttendedOther", "course", "yearGraduated", "languageOthersLabel",
  ])("WB-PROF-41 %s: value stored, blank becomes null", async (field) => {
    setup();
    await run({ [field]: "value" });
    expect(profileSet()[field]).toBe("value");
    JobseekerProfile.findOneAndUpdate.mockClear();
    setup();
    await run({ [field]: "" });
    expect(profileSet()[field]).toBeNull();
  });

  test("PHONE-01 phone is validated on this route and stored as E.164", async () => {
    setup();
    const ok = await run({ phone: "0917 123 4567" });
    expect(ok.status).toBe(200);
    expect(userUpdate().phone).toBe("+639171234567");
  });

  test.each([
    ["abc", "PHONE_BAD_CHARS"],
    ["917 123 456", "PHONE_TOO_SHORT"],
    ["912 345 6789", "PHONE_WEAK"],
    ["+999 123456", "PHONE_COUNTRY_UNKNOWN"],
  ])("PHONE-02 a bad phone %j returns a field-level 400 (%s) and nothing is saved", async (value, code) => {
    setup();
    const r = await run({ phone: value });
    expect(r.status).toBe(400);
    expect(r.body).toEqual(expect.objectContaining({ code, field: "phone", message: expect.any(String) }));
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("PHONE-03 an UNCHANGED phone is never re-validated (a legacy value cannot block a save)", async () => {
    setup(mkCurrent({ phone: "legacy 12" }));
    const r = await run({ phone: "legacy 12" });
    expect(r.status).toBe(200);
    expect(userUpdate().phone).toBe("legacy 12");
  });

  test("PHONE-04 an unchanged legacy phone that parses is upgraded to E.164", async () => {
    setup(mkCurrent({ phone: "09125826297" }));
    await run({ phone: "09125826297" });
    expect(userUpdate().phone).toBe("+639125826297");
  });

  test("PHONE-05 jobseekers cannot use a landline; employers can", async () => {
    setup();
    const seeker = await run({ phone: "02 8123 4567" });
    expect(seeker.status).toBe(400);
    setup(mkCurrent({ role: "employer" }));
    const employer = await run({ phone: "02 8123 4567" }, { user: { id: "u1", _id: "u1", role: "employer" } });
    expect(employer.status).toBe(200);
    expect(userUpdate().phone).toBe("+63281234567");
  });

  test("PHONE-06 mobileSecondary: stored as E.164, blank or punctuation becomes null, bad value is a 400", async () => {
    setup();
    await run({ mobileSecondary: "09171234567" });
    expect(profileSet().mobileSecondary).toBe("+639171234567");
    JobseekerProfile.findOneAndUpdate.mockClear();
    setup();
    await run({ mobileSecondary: "-" });
    expect(profileSet().mobileSecondary).toBeNull();
    setup();
    JobseekerProfile.findOne = jest.fn(() => ({ select: () => ({ lean: () => Promise.resolve(null) }) }));
    const bad = await run({ mobileSecondary: "12" });
    expect(bad.status).toBe(400);
    expect(bad.body.field).toBe("mobileSecondary");
  });

  test.each([
    ["employmentStatus", "not_applicable"],
    ["employmentStatus", "Prefer not to say"],
    ["employmentType", "wage"],
    ["unemploymentReason", "not_applicable"],
    ["unemploymentReason", "fresh_grad"],
  ])("ENUM-01 %s accepts %s and blank becomes null", async (field, value) => {
    setup();
    await run({ [field]: value });
    expect(profileSet()[field]).toBe(value);
    JobseekerProfile.findOneAndUpdate.mockClear();
    setup();
    await run({ [field]: "" });
    expect(profileSet()[field]).toBeNull();
  });

  test.each(["employmentStatus", "employmentType", "unemploymentReason"])("ENUM-02 an unknown %s is a 400 ENUM_INVALID with the field", async (field) => {
    setup();
    JobseekerProfile.findOne = jest.fn(() => ({ select: () => ({ lean: () => Promise.resolve(null) }) }));
    const r = await run({ [field]: "student" });
    expect(r.status).toBe(400);
    expect(r.body).toEqual(expect.objectContaining({ code: "ENUM_INVALID", field }));
    expect(JobseekerProfile.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test.each(["employmentStatus", "employmentType", "unemploymentReason"])("ENUM-03 an unchanged stored %s outside the list does not block the save", async (field) => {
    setup();
    JobseekerProfile.findOne = jest.fn(() => ({ select: () => ({ lean: () => Promise.resolve({ [field]: "legacy" }) }) }));
    const r = await run({ [field]: "legacy" });
    expect(r.status).toBe(200);
  });

  test.each(["height", "weight", "expectedSalaryMin", "expectedSalaryMax"])("WB-PROF-42 numeric %s: parsed as float, blank becomes null", async (field) => {
    setup();
    await run({ [field]: "170.5" });
    expect(profileSet()[field]).toBe(170.5);
    JobseekerProfile.findOneAndUpdate.mockClear();
    setup();
    await run({ [field]: "" });
    expect(profileSet()[field]).toBeNull();
  });

  test.each(["is4psBeneficiary", "isOfw", "isRepatriated"])("WB-PROF-43 %s: the string 'true' is true, 'false' is false", async (field) => {
    setup();
    await run({ [field]: "true" });
    expect(profileSet()[field]).toBe(true);
    JobseekerProfile.findOneAndUpdate.mockClear();
    setup();
    await run({ [field]: "false" });
    expect(profileSet()[field]).toBe(false);
  });

  test.each(["is4psBeneficiary", "isOfw", "isRepatriated"])("WB-PROF-44 KNOWN-ISSUE: %s sent as a real JSON boolean true is stored as FALSE (only the string 'true' counts), although the validator accepts booleans", async (field) => {
    setup();
    await run({ [field]: true });
    expect(profileSet()[field]).toBe(false);
  });

  test.each([
    "skills", "preferredIndustries", "preferredJobTypes", "preferredWorkNature", "preferredOccupations", "preferredWorkLocationLocal",
    "preferredWorkLocationOverseas", "workHistory", "vocationalTrainings",
  ])("WB-PROF-45 JSON list %s: string JSON is parsed, objects pass through, invalid or empty falls back to []", async (field) => {
    const check = async (input, expected) => {
      JobseekerProfile.findOneAndUpdate.mockClear();
      User.findByIdAndUpdate.mockClear();
      setup();
      await run({ [field]: input });
      expect(profileSet()[field]).toEqual(expected);
    };
    await check(JSON.stringify(["a", "b"]), ["a", "b"]);
    await check(["x"], ["x"]);
    await check("{not json", []);
    await check("", []);
  });

  test("WB-PROF-46 civil status: 'Other' keeps the free text, any other value (or blank) clears it; the companion alone is stored", async () => {
    setup();
    await run({ civilStatus: "Other", civilStatusOther: "Annulled" });
    expect(profileSet()).toMatchObject({ civilStatus: "Other", civilStatusOther: "Annulled" });
    JobseekerProfile.findOneAndUpdate.mockClear();
    setup();
    await run({ civilStatus: "Single", civilStatusOther: "stale" });
    expect(profileSet()).toMatchObject({ civilStatus: "Single", civilStatusOther: null });
    JobseekerProfile.findOneAndUpdate.mockClear();
    setup();
    await run({ civilStatus: "" });
    expect(profileSet()).toMatchObject({ civilStatus: null, civilStatusOther: null });
    JobseekerProfile.findOneAndUpdate.mockClear();
    setup();
    await run({ civilStatusOther: "Free" });
    expect(profileSet()).toEqual({ civilStatusOther: "Free" });
    JobseekerProfile.findOneAndUpdate.mockClear();
    setup();
    await run({ civilStatusOther: "" });
    expect(profileSet().civilStatusOther).toBeNull();
  });

  test("WB-PROF-47 disability: 'Others' keeps the free text, otherwise it is cleared (including a non-array value); the companion alone is stored", async () => {
    setup();
    await run({ disability: JSON.stringify(["Visual", "Others"]), disabilityOther: "x" });
    // "Others" is checked, so the free text is NOT cleared; it is stored via the companion branch.
    expect(profileSet()).toMatchObject({ disability: ["Visual", "Others"], disabilityOther: "x" });
    JobseekerProfile.findOneAndUpdate.mockClear();
    setup();
    await run({ disability: ["Visual"], disabilityOther: "stale" });
    expect(profileSet().disabilityOther).toBeNull();
    JobseekerProfile.findOneAndUpdate.mockClear();
    setup();
    await run({ disability: "{bad" });
    expect(profileSet()).toMatchObject({ disability: [], disabilityOther: null });
    JobseekerProfile.findOneAndUpdate.mockClear();
    setup();
    await run({ disability: { not: "array" } });
    expect(profileSet().disabilityOther).toBeNull();
    JobseekerProfile.findOneAndUpdate.mockClear();
    setup();
    await run({ disabilityOther: "alone" });
    expect(profileSet()).toEqual({ disabilityOther: "alone" });
    JobseekerProfile.findOneAndUpdate.mockClear();
    setup();
    await run({ disabilityOther: "" });
    expect(profileSet().disabilityOther).toBeNull();
  });

  test("WB-PROF-48 addresses: JSON strings parsed, objects pass through, invalid JSON falls back to an empty address", async () => {
    const empty = { street: "", barangay: "", municipality: "", province: "", region: "" };
    setup();
    await run({ presentAddress: JSON.stringify({ street: "1 Main" }), permanentAddress: { street: "2 Side" } });
    expect(profileSet()).toMatchObject({ presentAddress: { street: "1 Main" }, permanentAddress: { street: "2 Side" } });
    JobseekerProfile.findOneAndUpdate.mockClear();
    setup();
    await run({ presentAddress: "{bad", permanentAddress: "" });
    expect(profileSet()).toMatchObject({ presentAddress: empty, permanentAddress: empty });
  });

  test("WB-PROF-49 citizenship and unit fields are tidied/normalised; language proficiency ignores invalid JSON but keeps valid values", async () => {
    setup();
    await run({ citizenship: "  filipino ", heightUnit: "cm", weightUnit: "kg", languageProficiency: JSON.stringify({ English: "good" }) });
    const s = profileSet();
    expect(typeof s.citizenship).toBe("string");
    expect(s.heightUnit).toBeDefined();
    expect(s.weightUnit).toBeDefined();
    expect(s.languageProficiency).toEqual({ English: "good" });
    JobseekerProfile.findOneAndUpdate.mockClear();
    JobseekerProfile.findOneAndUpdate.mockClear();
    setup();
    await run({ citizenship: "" });
    expect(profileSet().citizenship).toBeNull();
  });

  test("WB-PROF-49b KNOWN-ISSUE: INVALID languageProficiency JSON is meant to be ignored, but parseJSON(value, undefined) falls back to its default (null), so the stored value is overwritten with null", async () => {
    setup();
    await run({ languageProficiency: "{bad", name: "N" });
    expect(profileSet()).toEqual({ languageProficiency: null });
  });

  test("WB-PROF-50 eligibilities and professional licenses go through the list tidier (string JSON, invalid falls back to [])", async () => {
    setup();
    await run({ eligibilities: JSON.stringify([{ name: " Civil Service " }]), professionalLicenses: "{bad" });
    expect(Array.isArray(profileSet().eligibilities)).toBe(true);
    expect(profileSet().professionalLicenses).toEqual([]);
  });

  test("WB-PROF-51 employer-only profile fields are ignored for jobseekers", async () => {
    setup();
    await run({ tradeName: "Acme", fax: "123", skills: "[]" });
    expect(profileSet()).not.toHaveProperty("tradeName");
    expect(profileSet()).not.toHaveProperty("fax");
  });

  test("WB-PROF-52 the profile is upserted into the JOBSEEKER collection with $set only (partial payloads never blank other fields)", async () => {
    setup();
    const { body } = await run({ course: "BSIT" });
    expect(JobseekerProfile.findOneAndUpdate).toHaveBeenCalledWith({ userId: "u1" }, { $set: { course: "BSIT" } }, { new: true, upsert: true });
    expect(EmployerProfile.findOneAndUpdate).not.toHaveBeenCalled();
    expect(body.profile).toEqual({ updated: "jobseeker" });
    expect(body.profileCompleteness).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("updateProfile: employer profile fields", () => {
  const emp = () => mkCurrent({ role: "employer" });

  test.each(["tradeName", "acronym", "tin", "officeType", "totalWorkforceSize", "ownerName", "contactPersonName", "contactPersonPosition", "fax"])(
    "WB-PROF-53 %s: value stored, blank becomes null", async (field) => {
      setup(emp());
      await run({ [field]: "v" });
      expect(profileSet(EmployerProfile)[field]).toBe("v");
      EmployerProfile.findOneAndUpdate.mockClear();
      setup(emp());
      await run({ [field]: "" });
      expect(profileSet(EmployerProfile)[field]).toBeNull();
    }
  );

  test("WB-PROF-54 classification and structured address parse JSON, with documented fallbacks", async () => {
    setup(emp());
    await run({ employerClassification: JSON.stringify({ type: "private", subtype: "Direct Hire" }), businessAddressStructured: JSON.stringify({ street: "s" }) });
    expect(profileSet(EmployerProfile)).toMatchObject({ employerClassification: { type: "private", subtype: "Direct Hire" }, businessAddress: { street: "s" } });
    EmployerProfile.findOneAndUpdate.mockClear();
    setup(emp());
    await run({ employerClassification: "{bad", businessAddressStructured: "{bad" });
    expect(profileSet(EmployerProfile)).toMatchObject({
      employerClassification: { type: null, subtype: null },
      businessAddress: { street: "", barangay: "", municipality: "", province: "", region: "" },
    });
  });

  test("WB-PROF-55 upserts into the EMPLOYER collection; jobseeker-only fields are ignored and there is no completeness score", async () => {
    setup(emp());
    const { body } = await run({ tradeName: "Acme", skills: "[]", civilStatus: "Single" });
    expect(EmployerProfile.findOneAndUpdate).toHaveBeenCalledWith({ userId: "u1" }, { $set: { tradeName: "Acme" } }, { new: true, upsert: true });
    expect(JobseekerProfile.findOneAndUpdate).not.toHaveBeenCalled();
    expect(body.profileCompleteness).toBeNull();
  });

  test("WB-PROF-56 admin accounts have no role profile at all", async () => {
    setup(mkCurrent({ role: "admin" }));
    const { body } = await run({ tradeName: "Acme", course: "x", name: "N" });
    expect(JobseekerProfile.findOneAndUpdate).not.toHaveBeenCalled();
    expect(EmployerProfile.findOneAndUpdate).not.toHaveBeenCalled();
    expect(body.profile).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("updateProfile: audit and errors", () => {
  test("WB-PROF-57 the audit event is written after the save; a failing audit write does not fail the request or skip OCR scheduling", async () => {
    setup();
    auditService.logAuditEvent.mockRejectedValue(new Error("x"));
    const req = makeReq({ user: { id: "u1" }, body: {}, files: { validIdFile: [{ storedValue: "id.png" }] } });
    const r = await call(ctl.updateProfile, req);
    expect(r.status).toBe(200);
    expect(idOcr.scheduleIdOcr).toHaveBeenCalled();
    setup();
    auditService.logAuditEvent.mockResolvedValue();
    await run({ name: "N" });
    expect(auditService.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "user.profile.updated" }));
  });

  test("WB-PROF-58 a Mongoose ValidationError is a 400 using the first field message (or a generic prompt); the error text is only exposed as a 400, never a 500", async () => {
    setup();
    User.findByIdAndUpdate.mockImplementation(() => failingQuery(Object.assign(new Error("v"), { name: "ValidationError", errors: { workExperience: { message: "`bad` is not a valid enum value" } } })));
    let r = await run({ workExperience: "bad" });
    expect(r.status).toBe(400);
    process.env.SHOW_ERROR_DETAILS = "true";
    setup();
    r = await run({ workExperience: "bad" });
    expect(r.body.message).toBe("v");
    delete process.env.SHOW_ERROR_DETAILS;
    setup();
    User.findByIdAndUpdate.mockImplementation(() => failingQuery(Object.assign(new Error("v"), { name: "ValidationError" })));
    r = await run({ workExperience: "bad" });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("Please check the values you entered and try again.");
  });

  test("WB-PROF-59 any other failure is a generic 500", async () => {
    setup();
    User.findByIdAndUpdate.mockImplementation(() => failingQuery(new Error("secret db internals")));
    const r = await run({ name: "N" });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ message: "Something went wrong" });
  });
});
