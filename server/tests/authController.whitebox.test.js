// White-box branch coverage for server/controllers/authController.js
// (everything except updateProfile, which is in authController.profile.whitebox.test.js).
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
const { User, JobseekerProfile, EmployerProfile, SystemSettings, ReservedUsername, bcrypt, mailService, loginLock, accountAlerts,
  passwordPolicy, usernameUtil, usernameSignup, age, logger, googleVerify, auditService, notificationService, sessionService,
  systemOptionService, storageService } = mocks;
const ctl = require("../controllers/authController");
const { makeReq, makeRes, query, failingQuery, call } = require("../testUtils/httpMocks");

const flush = () => new Promise((r) => setImmediate(r));
const verifyJwt = (t) => jwt.verify(t, "test-secret");
const dbError = () => new Error("secret db internals");
const STRONG = "Str0ng!Pass";
const actor = (o = {}) => ({ id: "u1", _id: "u1", role: "jobseeker", ...o });
const mkUser = (o = {}) => {
  const u = { _id: "u1", role: "jobseeker", email: "a@x.com", name: "Ann", password: "h:pw", tokenVersion: 0, isActive: true, save: jest.fn().mockResolvedValue(), ...o };
  u.toObject = () => ({ _id: u._id, role: u.role, email: u.email, cover: u.cover, avatar: u.avatar });
  return u;
};
const found = (u) => User.findOne.mockImplementation(() => query(u));
const byId = (u) => User.findById.mockImplementation(() => query(u));
const expect500 = (r, message = "Something went wrong") => {
  expect(r.status).toBe(500);
  expect(r.body).toEqual({ message });
};
const authReq = (o = {}) => makeReq({ user: actor(), ...o });

beforeEach(() => {
  jest.resetAllMocks();
  mocks.resetAuthMocks();
});

// ---------------------------------------------------------------------------
describe("register", () => {
  const body = (o = {}) => ({ name: "Ann", email: "  ANN@X.com ", password: STRONG, dateOfBirth: "2000-01-01", ...o });
  const run = (b) => call(ctl.register, makeReq({ body: b }));
  const created = (o = {}) => mkUser({ _id: "new", email: "ann@x.com", ...o });

  test("WB-AUTHC-01 username mode is refused (403) while the feature flag is off", async () => {
    const r = await run(body({ signupMode: "username" }));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("SIGNUP_DISABLED");
    expect(age.validateDobInput).not.toHaveBeenCalled();
  });

  test("WB-AUTHC-02 an invalid date of birth is refused before any lookup", async () => {
    age.validateDobInput.mockReturnValue({ ok: false, code: "DOB_UNDER_MINIMUM_AGE" });
    const r = await run(body());
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("DOB_UNDER_MINIMUM_AGE");
    expect(User.findOne).not.toHaveBeenCalled();
    expect(User.create).not.toHaveBeenCalled();
  });

  test("WB-AUTHC-03 existing email (normalised) is refused", async () => {
    found({ _id: "x" });
    const r = await run(body());
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("Email already exists");
    expect(User.findOne).toHaveBeenCalledWith({ email: "ann@x.com" });
  });

  test("WB-AUTHC-04 chosen username errors: invalid format and taken; code only in username mode", async () => {
    usernameUtil.validateFormat.mockReturnValue({ ok: false, error: "bad format" });
    let r = await run(body({ username: "x" }));
    expect(r.body).toEqual({ message: "bad format", field: "username" });
    usernameUtil.validateFormat.mockReturnValue({ ok: true, normalized: "ann" });
    usernameUtil.isAvailable.mockResolvedValue(false);
    r = await run(body({ username: "ann" }));
    expect(r.body).toEqual({ message: "That username is already taken.", field: "username" });
    usernameSignup.isUsernameSignupEnabled.mockReturnValue(true);
    r = await run(body({ signupMode: "username", username: "ann" }));
    expect(r.body.code).toBe("USERNAME_INVALID");
  });

  test("WB-AUTHC-05 username mode with no username is refused", async () => {
    usernameSignup.isUsernameSignupEnabled.mockReturnValue(true);
    const r = await run(body({ signupMode: "username" }));
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ code: "USERNAME_INVALID", message: "Choose a username.", field: "username" });
  });

  test("WB-AUTHC-06 email-mode success: hashed password, composed name, profile, verification mail, suggested username, 201", async () => {
    User.create.mockResolvedValue(created());
    const r = await run(body({ firstName: "Ann", middleName: "B", surname: "Cruz", suffix: "Jr" }));
    expect(r.status).toBe(201);
    const arg = User.create.mock.calls[0][0];
    expect(arg).toMatchObject({ name: "Ann B Cruz Jr", surname: "Cruz", firstName: "Ann", middleName: "B", suffix: "Jr", email: "ann@x.com", password: `h:${STRONG}`, role: "jobseeker", dobSource: "registration" });
    expect(arg).not.toHaveProperty("username");
    expect(JobseekerProfile.create).toHaveBeenCalledWith({ userId: "new" });
    expect(mailService.sendEmailVerification).toHaveBeenCalledWith(expect.objectContaining({ to: "ann@x.com" }));
    expect(usernameUtil.suggestFromEmailLocalPart).toHaveBeenCalledWith("ann");
    expect(auditService.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.user.registered", metadata: { signupMode: "email" } }));
    expect(r.body).toEqual({ message: "Account created. Check your email to verify it before signing in.", email: "ann@x.com" });
  });

  test("WB-AUTHC-07 name falls back to `name` when no name parts are given; blank parts become null", async () => {
    User.create.mockResolvedValue(created());
    await run(body({ firstName: "", surname: "" }));
    expect(User.create.mock.calls[0][0]).toMatchObject({ name: "Ann", surname: null, firstName: null, middleName: null, suffix: null });
  });

  test("WB-AUTHC-08 a user-chosen username is stored and no suggestion is attempted", async () => {
    User.create.mockResolvedValue(created());
    usernameUtil.validateFormat.mockReturnValue({ ok: true, normalized: "annc" });
    await run(body({ username: "AnnC" }));
    expect(User.create.mock.calls[0][0].username).toBe("annc");
    expect(usernameUtil.suggestFromEmailLocalPart).not.toHaveBeenCalled();
  });

  test("WB-AUTHC-09 EXPOSE_DEV_LINKS=true echoes the verification URL (and only then)", async () => {
    User.create.mockResolvedValue(created());
    process.env.EXPOSE_DEV_LINKS = "true";
    const r = await run(body());
    expect(r.body.devVerifyUrl).toMatch(/^http:\/\/client\/confirm-email\?token=[0-9a-f]{64}&email=ann%40x\.com$/);
    process.env.EXPOSE_DEV_LINKS = "yes";
    User.create.mockResolvedValue(created());
    expect((await run(body())).body.devVerifyUrl).toBeUndefined();
  });

  test("WB-AUTHC-10 username suggestion failures never fail registration", async () => {
    User.create.mockResolvedValue(created());
    usernameUtil.suggestFromEmailLocalPart.mockRejectedValue(new Error("x"));
    expect((await run(body())).status).toBe(201);
    expect(logger.error).toHaveBeenCalledWith("Failed to suggest a username at account creation", expect.anything());
    const u = created();
    User.create.mockResolvedValue(u);
    usernameUtil.suggestFromEmailLocalPart.mockResolvedValue(null);
    await run(body());
    expect(u.save).toHaveBeenCalledTimes(1); // only the verification-token save
  });

  test("WB-AUTHC-11 username mode success: no email stored or queried, immediate session", async () => {
    usernameSignup.isUsernameSignupEnabled.mockReturnValue(true);
    usernameUtil.validateFormat.mockReturnValue({ ok: true, normalized: "annc" });
    User.create.mockResolvedValue(created({ email: undefined }));
    const r = await run(body({ signupMode: "username", username: "AnnC", email: "ignored@x.com" }));
    expect(r.status).toBe(201);
    expect(User.findOne).not.toHaveBeenCalled();
    expect(User.create.mock.calls[0][0]).not.toHaveProperty("email");
    expect(verifyJwt(r.body.token)).toMatchObject({ id: "new", role: "jobseeker" });
    expect(r.body.user).toEqual({ id: "new", role: "jobseeker" });
    expect(r.body.termsVersion).toBe(ctl.CURRENT_TERMS_VERSION);
    expect(mailService.sendEmailVerification).not.toHaveBeenCalled();
    expect(auditService.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ metadata: { signupMode: "username" } }));
  });

  describe("create races (unique index)", () => {
    const dup = (extra) => Object.assign(new Error("E11000"), { code: 11000, ...extra });

    test("WB-AUTHC-12 username collision: code only in username mode", async () => {
      User.create.mockRejectedValue(dup({ keyPattern: { username: 1 } }));
      let r = await run(body());
      expect(r.body).toEqual({ message: "That username is already taken.", field: "username" });
      usernameSignup.isUsernameSignupEnabled.mockReturnValue(true);
      usernameUtil.validateFormat.mockReturnValue({ ok: true, normalized: "annc" });
      r = await run(body({ signupMode: "username", username: "annc" }));
      expect(r.body.code).toBe("USERNAME_TAKEN");
    });

    test("WB-AUTHC-13 email collision is reported as 'Email already exists'", async () => {
      User.create.mockRejectedValue(dup({ keyPattern: { email: 1 } }));
      expect((await run(body())).body.message).toBe("Email already exists");
      User.create.mockRejectedValue(dup({}));
      expect((await run(body())).body.message).toBe("Email already exists");
    });

    test("WB-AUTHC-14 username mode hitting the OLD email unique index is a server fault (500), not the user's", async () => {
      usernameSignup.isUsernameSignupEnabled.mockReturnValue(true);
      usernameUtil.validateFormat.mockReturnValue({ ok: true, normalized: "annc" });
      User.create.mockRejectedValue(dup({ keyPattern: { email: 1 } }));
      expect500(await run(body({ signupMode: "username", username: "annc" })));
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("index swap"), expect.anything());
    });

    test("WB-AUTHC-15 a duplicate raised AFTER create (outer handler) maps username/email; other errors are a generic 500", async () => {
      User.create.mockResolvedValue(created());
      JobseekerProfile.create.mockRejectedValue(dup({ keyPattern: { username: 1 } }));
      expect((await run(body())).body).toEqual({ message: "That username is already taken.", field: "username" });
      JobseekerProfile.create.mockRejectedValue(dup({}));
      expect((await run(body())).body.message).toBe("Email already exists");
      JobseekerProfile.create.mockRejectedValue(dbError());
      expect500(await run(body()));
    });
  });
});

// ---------------------------------------------------------------------------
describe("registerEmployer", () => {
  const body = (o = {}) => ({ name: "Acme", email: "BOSS@acme.com", password: STRONG, confirmAdult: "true", ...o });
  const run = (b) => call(ctl.registerEmployer, makeReq({ body: b }));

  test.each(["true", "1", "on", "TRUE", "On", true])("WB-AUTHC-16 confirmAdult %p is accepted", async (v) => {
    User.create.mockResolvedValue(mkUser({ _id: "emp", role: "employer", email: "boss@acme.com" }));
    expect((await run(body({ confirmAdult: v }))).status).toBe(201);
  });

  test.each([undefined, "", "false", "0", "yes", null])("WB-AUTHC-17 confirmAdult %p is refused", async (v) => {
    const r = await run(body({ confirmAdult: v }));
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("EMPLOYER_ADULT_ATTESTATION_REQUIRED");
    expect(User.findOne).not.toHaveBeenCalled();
  });

  test("WB-AUTHC-18 existing email and invalid chosen username are refused", async () => {
    found({ _id: "x" });
    expect((await run(body())).body.message).toBe("Email already exists");
    found(null);
    usernameUtil.validateFormat.mockReturnValue({ ok: false, error: "bad" });
    expect((await run(body({ username: "x" }))).body).toEqual({ message: "bad", field: "username" });
  });

  test("WB-AUTHC-19 success: employer account + profile, verification mail, every admin notified, no session token", async () => {
    User.create.mockResolvedValue(mkUser({ _id: "emp", role: "employer", email: "boss@acme.com", name: "Acme" }));
    User.find.mockImplementation(() => query([{ _id: "a1" }, { _id: "a2" }]));
    const r = await run(body());
    expect(r.status).toBe(201);
    expect(User.create.mock.calls[0][0]).toMatchObject({ name: "Acme", email: "boss@acme.com", role: "employer", password: `h:${STRONG}` });
    expect(EmployerProfile.create).toHaveBeenCalledWith({ userId: "emp" });
    expect(mailService.sendEmailVerification).toHaveBeenCalled();
    expect(notificationService.notifyManyUsers).toHaveBeenCalledWith(expect.objectContaining({ recipientIds: ["a1", "a2"], title: "New employer registered" }));
    expect(r.body.token).toBeUndefined();
    expect(usernameUtil.suggestFromEmailLocalPart).toHaveBeenCalled();
  });

  test("WB-AUTHC-20 chosen username is stored (no suggestion); EXPOSE_DEV_LINKS echoes the link", async () => {
    User.create.mockResolvedValue(mkUser({ _id: "emp", role: "employer", email: "boss@acme.com" }));
    usernameUtil.validateFormat.mockReturnValue({ ok: true, normalized: "acme" });
    process.env.EXPOSE_DEV_LINKS = "true";
    const r = await run(body({ username: "Acme" }));
    expect(User.create.mock.calls[0][0].username).toBe("acme");
    expect(usernameUtil.suggestFromEmailLocalPart).not.toHaveBeenCalled();
    expect(r.body.devVerifyUrl).toContain("confirm-email");
  });

  test("WB-AUTHC-21 races: username keyPattern gives the username message; anything else with code 11000 is 'Email already exists'; other errors 500", async () => {
    const dup = (extra) => Object.assign(new Error("dup"), { code: 11000, ...extra });
    User.create.mockRejectedValue(dup({ keyPattern: { username: 1 } }));
    expect((await run(body())).body).toEqual({ message: "That username is already taken.", field: "username" });
    User.create.mockRejectedValue(dup({ keyPattern: { email: 1 } }));
    expect((await run(body())).body.message).toBe("Email already exists");
    User.create.mockRejectedValue(dbError());
    expect500(await run(body()));
  });

  test("WB-AUTHC-22 KNOWN-ISSUE: a username collision reported only via keyValue (no keyPattern) is mis-reported as an email collision here (register() handles both shapes)", async () => {
    User.create.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000, keyValue: { username: "acme" } }));
    expect((await run(body())).body.message).toBe("Email already exists");
  });
});

// ---------------------------------------------------------------------------
describe("login", () => {
  const run = (b, over = {}) => call(ctl.login, makeReq({ body: b, headers: { "user-agent": "jest" }, ...over }));
  const good = (o = {}) => mkUser({ password: "h:pw", ...o });

  test("WB-AUTHC-23 unknown user: generic 400 AND a bcrypt compare against the dummy hash (timing parity)", async () => {
    const r = await run({ identifier: "ghost@x.com", password: "pw" });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("Invalid username/email or password");
    expect(bcrypt.compare).toHaveBeenCalledWith("pw", expect.stringMatching(/^\$2a\$10\$/));
    expect(loginLock.recordFailure).not.toHaveBeenCalled();
    expect(loginLock.recordFailureDummy).not.toHaveBeenCalled();
  });

  test("WB-AUTHC-24 wrong password and missing password both give the same generic 400", async () => {
    found(good());
    expect((await run({ identifier: "a@x.com", password: "nope" })).body.message).toBe("Invalid username/email or password");
    expect((await run({ identifier: "a@x.com" })).status).toBe(400);
    expect(bcrypt.compare).toHaveBeenCalledWith("", "h:pw");
  });

  test("WB-AUTHC-25 identifier resolution: `email` alias, @ means email (normalised), otherwise lower-cased username with a case-insensitive collation", async () => {
    await run({ email: " A@X.com ", password: "pw" });
    expect(User.findOne).toHaveBeenLastCalledWith({ email: "a@x.com" });
    const q = query(null);
    User.findOne.mockImplementation(() => q);
    await run({ identifier: "AnnC", password: "pw" });
    expect(User.findOne).toHaveBeenLastCalledWith({ username: "annc" });
    expect(q.collation).toHaveBeenCalledWith({ locale: "en", strength: 2 });
    User.findOne.mockClear();
    await run({ identifier: "   ", password: "pw" });
    expect(User.findOne).not.toHaveBeenCalled();
  });

  test("WB-AUTHC-26 staffRecoveryPending accounts cannot sign in even with the right password", async () => {
    found(good({ staffRecoveryPending: true }));
    expect((await run({ identifier: "a@x.com", password: "pw" })).status).toBe(400);
  });

  test("WB-AUTHC-26b a staff account pending activation cannot sign in, even if the password somehow matched, and answers like a wrong password", async () => {
    found(good({ role: "admin", isActive: false, accountStatus: "pending_activation" }));
    const r = await run({ identifier: "a@x.com", password: "pw" });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ message: "Invalid username/email or password" });
    expect(r.body).not.toHaveProperty("token");
  });

  describe("per-account lockout (feature flag on)", () => {
    beforeEach(() => usernameSignup.isUsernameSignupEnabled.mockReturnValue(true));

    test("WB-AUTHC-27 wrong password on a lockable (jobseeker) account records a failure", async () => {
      found(good());
      await run({ identifier: "a@x.com", password: "nope" });
      expect(loginLock.recordFailure).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ req: expect.anything() }));
      expect(loginLock.recordFailureDummy).not.toHaveBeenCalled();
    });

    test.each(["employee", "resident"])("WB-AUTHC-28 role %s is lockable too", async (role) => {
      found(good({ role }));
      await run({ identifier: "a@x.com", password: "nope" });
      expect(loginLock.recordFailure).toHaveBeenCalled();
    });

    test.each(["admin", "superadmin", "employer"])("WB-AUTHC-29 role %s is NOT lockable: failures only do the dummy write", async (role) => {
      found(good({ role }));
      await run({ identifier: "a@x.com", password: "nope" });
      expect(loginLock.recordFailure).not.toHaveBeenCalled();
      expect(loginLock.recordFailureDummy).toHaveBeenCalled();
    });

    test("WB-AUTHC-30 unknown user does the dummy write too (response time parity)", async () => {
      await run({ identifier: "ghost@x.com", password: "pw" });
      expect(loginLock.recordFailureDummy).toHaveBeenCalled();
    });

    test("WB-AUTHC-31 a locked account answers like a wrong password even with the RIGHT password, without recording a new failure", async () => {
      found(good());
      loginLock.isLocked.mockReturnValue(true);
      const r = await run({ identifier: "a@x.com", password: "pw" });
      expect(r.status).toBe(400);
      expect(r.body.message).toBe("Invalid username/email or password");
      expect(loginLock.recordFailure).not.toHaveBeenCalled();
      expect(loginLock.recordFailureDummy).toHaveBeenCalled();
    });

    test("WB-AUTHC-32 success clears an existing lock; 3+ prior failures trigger an in-app alert; new-device check always runs", async () => {
      found(good({ loginLock: { failures: 3 } }));
      const r = await run({ identifier: "a@x.com", password: "pw" });
      expect(r.status).toBe(200);
      expect(loginLock.clearLock).toHaveBeenCalledWith("u1");
      expect(accountAlerts.notifyFailedAttempts).toHaveBeenCalled();
      expect(accountAlerts.checkNewDevice).toHaveBeenCalledWith("u1", "jest", expect.anything());
    });

    test("WB-AUTHC-33 fewer than 3 failures: no alert; no loginLock object: nothing to clear", async () => {
      found(good({ loginLock: { failures: 2 } }));
      await run({ identifier: "a@x.com", password: "pw" });
      expect(accountAlerts.notifyFailedAttempts).not.toHaveBeenCalled();
      found(good());
      loginLock.clearLock.mockClear();
      await run({ identifier: "a@x.com", password: "pw" });
      expect(loginLock.clearLock).not.toHaveBeenCalled();
      found(good({ loginLock: {} }));
      await run({ identifier: "a@x.com", password: "pw", });
      expect(accountAlerts.notifyFailedAttempts).not.toHaveBeenCalled();
    });

    test("WB-AUTHC-34 missing headers do not break the new-device check", async () => {
      found(good());
      const r = await call(ctl.login, makeReq({ body: { identifier: "a@x.com", password: "pw" }, headers: undefined }));
      expect(r.status).toBe(200);
      expect(accountAlerts.checkNewDevice).toHaveBeenCalledWith("u1", undefined, expect.anything());
    });
  });

  test("WB-AUTHC-35 flag off: no lockout calls at all", async () => {
    found(good());
    await run({ identifier: "a@x.com", password: "nope" });
    await run({ identifier: "a@x.com", password: "pw" });
    expect(loginLock.recordFailure).not.toHaveBeenCalled();
    expect(loginLock.clearLock).not.toHaveBeenCalled();
    expect(accountAlerts.checkNewDevice).not.toHaveBeenCalled();
  });

  test.each(["admin", "superadmin"])("WB-AUTHC-36 a disabled %s gets ACCOUNT_DISABLED (no appeal token)", async (role) => {
    found(good({ role, isActive: false }));
    const r = await run({ identifier: "a@x.com", password: "pw" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("ACCOUNT_DISABLED");
    expect(r.body.appealToken).toBeUndefined();
  });

  test("WB-AUTHC-37 self-deactivated account is reactivated by a correct login", async () => {
    const u = good({ isActive: false, accountStatus: "deactivated", deactivatedAt: new Date() });
    found(u);
    const r = await run({ identifier: "a@x.com", password: "pw" });
    expect(u).toMatchObject({ isActive: true, accountStatus: "active", deactivatedAt: null });
    expect(u.save).toHaveBeenCalledWith({ validateModifiedOnly: true });
    expect(r.status).toBe(200);
    expect(r.body.reactivated).toBe(true);
  });

  test.each([["banned", "banned"], ["suspended", "suspended"], [undefined, "suspended"], ["weird", "suspended"]])(
    "WB-AUTHC-38 suspended account (status %p) gets 403 with an appeal-only token and accountStatus %s", async (accountStatus, expected) => {
      found(good({ isActive: false, accountStatus, suspensionReason: "spam", suspendedAt: "d" }));
      const r = await run({ identifier: "a@x.com", password: "pw" });
      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ code: "ACCOUNT_SUSPENDED", accountStatus: expected, suspensionReason: "spam", suspendedAt: "d" });
      expect(verifyJwt(r.body.appealToken)).toMatchObject({ id: "u1", scope: "appeal" });
      expect(verifyJwt(r.body.appealToken).role).toBeUndefined();
    }
  );

  test("WB-AUTHC-39 suspended: missing reason/date become null", async () => {
    found(good({ isActive: false }));
    const r = await run({ identifier: "a@x.com", password: "pw" });
    expect(r.body.suspensionReason).toBeNull();
    expect(r.body.suspendedAt).toBeNull();
  });

  test.each([
    [{ appealWindowDays: 3 }, 3], [{ appealWindowDays: "7" }, 7], [{ appealWindowDays: 0 }, 14], [{ appealWindowDays: -2 }, 14],
    [{ appealWindowDays: "abc" }, 14], [{}, 14],
  ])("WB-AUTHC-40 appeal window setting %j gives a %i-day token", async (settings, days) => {
    SystemSettings.getSingleton.mockResolvedValue(settings);
    found(good({ isActive: false }));
    const r = await run({ identifier: "a@x.com", password: "pw" });
    const decoded = verifyJwt(r.body.appealToken);
    expect(Math.round((decoded.exp - decoded.iat) / 86400)).toBe(days);
  });

  test("WB-AUTHC-41 a settings read failure falls back to 14 days", async () => {
    SystemSettings.getSingleton.mockRejectedValue(new Error("db"));
    found(good({ isActive: false }));
    const decoded = verifyJwt((await run({ identifier: "a@x.com", password: "pw" })).body.appealToken);
    expect(Math.round((decoded.exp - decoded.iat) / 86400)).toBe(14);
  });

  test("WB-AUTHC-42 email not verified (literal false) blocks sign-in; unset/true does not", async () => {
    found(good({ isEmailVerified: false }));
    const r = await run({ identifier: "a@x.com", password: "pw" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("EMAIL_NOT_VERIFIED");
    found(good({ isEmailVerified: undefined }));
    expect((await run({ identifier: "a@x.com", password: "pw" })).status).toBe(200);
    found(good({ isEmailVerified: true }));
    expect((await run({ identifier: "a@x.com", password: "pw" })).status).toBe(200);
  });

  test("WB-AUTHC-43 success: 30-day token for the user, lastLoginAt recorded, session payload and terms version returned", async () => {
    found(good({ tokenVersion: 4 }));
    const r = await run({ identifier: "a@x.com", password: "pw" });
    const d = verifyJwt(r.body.token);
    expect(d).toMatchObject({ id: "u1", role: "jobseeker", tokenVersion: 4 });
    expect(Math.round((d.exp - d.iat) / 86400)).toBe(30);
    expect(User.updateOne).toHaveBeenCalledWith({ _id: "u1" }, { $set: { lastLoginAt: expect.any(Date) } });
    expect(r.body.user).toEqual({ id: "u1", role: "jobseeker" });
    expect(r.body.termsVersion).toBe(ctl.CURRENT_TERMS_VERSION);
    expect(r.body.reactivated).toBeUndefined();
  });

  test("WB-AUTHC-44 a failing lastLoginAt write is logged and does not fail the login", async () => {
    found(good());
    User.updateOne.mockRejectedValue(new Error("db"));
    const r = await run({ identifier: "a@x.com", password: "pw" });
    await flush();
    expect(r.status).toBe(200);
    expect(logger.error).toHaveBeenCalledWith("Failed to record lastLoginAt", expect.anything());
  });

  test("WB-AUTHC-45 a DB failure is a generic 500 that never leaks the message", async () => {
    User.findOne.mockImplementation(() => failingQuery(dbError()));
    expect500(await run({ identifier: "a@x.com", password: "pw" }));
  });
});

// ---------------------------------------------------------------------------
describe("changePassword", () => {
  const run = (b, over = {}) => call(ctl.changePassword, authReq({ body: b, ...over }));

  test("WB-AUTHC-46 new password shorter than 8 is rejected before any lookup (8 is accepted)", async () => {
    const r = await run({ currentPassword: "pw", newPassword: "1234567" });
    expect(r.status).toBe(400);
    expect(User.findById).not.toHaveBeenCalled();
    byId(mkUser());
    expect((await run({ currentPassword: "pw", newPassword: "12345678" })).status).toBe(200);
  });

  test("WB-AUTHC-47 unknown user 404; Google-only account (no password) 400", async () => {
    expect((await run({ currentPassword: "pw", newPassword: STRONG })).status).toBe(404);
    byId(mkUser({ password: undefined }));
    expect((await run({ currentPassword: "pw", newPassword: STRONG })).status).toBe(400);
  });

  test("WB-AUTHC-48 wrong current password (via the lockout-aware check) is 400", async () => {
    byId(mkUser());
    loginLock.checkPasswordWithLock.mockResolvedValue(false);
    const r = await run({ currentPassword: "bad", newPassword: STRONG });
    expect(r.body.message).toBe("Your current password is incorrect.");
    expect(loginLock.checkPasswordWithLock).toHaveBeenCalledWith(expect.anything(), "bad", expect.objectContaining({ req: expect.anything() }));
  });

  test("WB-AUTHC-49 password-policy rejection is returned with its code; reusing the current password is refused", async () => {
    byId(mkUser());
    passwordPolicy.enforce.mockReturnValue({ ok: false, code: "PASSWORD_COMMON", message: "Too common" });
    const r = await run({ currentPassword: "pw", newPassword: STRONG });
    expect(r.body).toEqual({ code: "PASSWORD_COMMON", message: "Too common" });
    passwordPolicy.enforce.mockReturnValue({ ok: true });
    byId(mkUser({ password: `h:${STRONG}` }));
    expect((await run({ currentPassword: "pw", newPassword: STRONG })).body.message).toBe("The new password must be different from the current one.");
  });

  test("WB-AUTHC-50 success: hashed, tokenVersion bumped, mustChangePassword cleared, fresh token, notice mail, in-app alert, audit", async () => {
    const u = mkUser({ tokenVersion: 2, mustChangePassword: true });
    byId(u);
    const r = await run({ currentPassword: "pw", newPassword: STRONG });
    expect(u).toMatchObject({ password: `h:${STRONG}`, tokenVersion: 3, mustChangePassword: false });
    expect(verifyJwt(r.body.token).tokenVersion).toBe(3);
    expect(mailService.sendPasswordChangedEmail).toHaveBeenCalled();
    expect(accountAlerts.notifyPasswordChanged).toHaveBeenCalled();
    expect(auditService.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "user.password.changed", severity: "warning" }));
  });

  test("WB-AUTHC-51 tokenVersion starts from 0 when unset; a failing notice mail is only logged", async () => {
    const u = mkUser({ tokenVersion: undefined });
    byId(u);
    mailService.sendPasswordChangedEmail.mockRejectedValue(new Error("smtp"));
    const r = await run({ currentPassword: "pw", newPassword: STRONG });
    await flush();
    expect(u.tokenVersion).toBe(1);
    expect(r.status).toBe(200);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("password-changed"), expect.anything());
  });

  test("WB-AUTHC-52 non-string inputs are coerced; a DB failure is a generic 500 with the custom fallback", async () => {
    expect((await run({ currentPassword: 5, newPassword: 12345 })).status).toBe(400);
    User.findById.mockImplementation(() => failingQuery(dbError()));
    expect500(await run({ currentPassword: "pw", newPassword: STRONG }), "Could not change the password");
  });
});

// ---------------------------------------------------------------------------
describe("setPassword (Google-only accounts)", () => {
  const run = (b) => call(ctl.setPassword, authReq({ body: b }));
  const googleUser = (o = {}) => mkUser({ password: undefined, googleId: "g1", ...o });
  const ok = { credential: "tok", newPassword: STRONG };

  test("WB-AUTHC-53 503 when GOOGLE_CLIENT_ID is not configured", async () => {
    process.env.GOOGLE_CLIENT_ID = "  ";
    expect((await run(ok)).status).toBe(503);
  });

  test("WB-AUTHC-54 missing credential, short password, unknown user", async () => {
    expect((await run({ newPassword: STRONG })).body.message).toBe("Missing Google credential.");
    expect((await run({ credential: "t", newPassword: "short" })).body.message).toMatch(/at least 8/);
    expect((await run(ok)).status).toBe(404);
  });

  test("WB-AUTHC-55 accounts that already have a password are refused", async () => {
    byId(googleUser({ password: "h:x" }));
    expect((await run(ok)).body.message).toMatch(/already has a password/);
  });

  test("WB-AUTHC-56 policy is checked before the Google link; an account not linked to Google is refused", async () => {
    byId(googleUser({ googleId: undefined }));
    passwordPolicy.enforce.mockReturnValue({ ok: false, code: "PASSWORD_COMMON", message: "weak" });
    expect((await run(ok)).body.code).toBe("PASSWORD_COMMON");
    passwordPolicy.enforce.mockReturnValue({ ok: true });
    expect((await run(ok)).body.message).toBe("This account isn't linked to Google.");
  });

  test("WB-AUTHC-57 a Google verification failure is 401", async () => {
    byId(googleUser());
    googleVerify.mockRejectedValue(new Error("bad token"));
    expect((await run(ok)).status).toBe(401);
  });

  test("WB-AUTHC-58 a token for a DIFFERENT Google account (or no payload) is 401", async () => {
    byId(googleUser());
    googleVerify.mockResolvedValue({ getPayload: () => ({ sub: "someone-else" }) });
    expect((await run(ok)).body.message).toMatch(/doesn't match/);
    googleVerify.mockResolvedValue({ getPayload: () => null });
    expect((await run(ok)).status).toBe(401);
  });

  test("WB-AUTHC-59 success: password added, tokenVersion bumped, fresh token, notice mail", async () => {
    const u = googleUser({ tokenVersion: 1 });
    byId(u);
    googleVerify.mockResolvedValue({ getPayload: () => ({ sub: "g1" }) });
    const r = await run(ok);
    expect(googleVerify).toHaveBeenCalledWith({ idToken: "tok", audience: "client-id" });
    expect(u).toMatchObject({ password: `h:${STRONG}`, tokenVersion: 2 });
    expect(r.body).toMatchObject({ hasPassword: true });
    expect(verifyJwt(r.body.token).tokenVersion).toBe(2);
    expect(mailService.sendPasswordAddedEmail).toHaveBeenCalled();
  });

  test("WB-AUTHC-60 a failing notice mail is only logged; a DB error is a generic 500", async () => {
    byId(googleUser());
    googleVerify.mockResolvedValue({ getPayload: () => ({ sub: "g1" }) });
    mailService.sendPasswordAddedEmail.mockRejectedValue(new Error("smtp"));
    expect((await run(ok)).status).toBe(200);
    await flush();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("password-added"), expect.anything());
    User.findById.mockImplementation(() => failingQuery(dbError()));
    expect500(await run(ok), "Could not set the password");
  });
});

// ---------------------------------------------------------------------------
describe("username endpoints", () => {
  test("WB-AUTHC-61 checkUsernameAvailable: invalid, available, taken, error", async () => {
    let r = await call(ctl.checkUsernameAvailable, makeReq({ query: {} }));
    expect(r.body).toEqual({ available: false, reason: "Enter a username." });
    r = await call(ctl.checkUsernameAvailable, makeReq({ query: { u: "AnnC" } }));
    expect(r.body).toEqual({ available: true, normalized: "annc" });
    usernameUtil.isAvailable.mockResolvedValue(false);
    expect((await call(ctl.checkUsernameAvailable, makeReq({ query: { u: "x" } }))).body.available).toBe(false);
    usernameUtil.isAvailable.mockRejectedValue(dbError());
    expect500(await call(ctl.checkUsernameAvailable, makeReq({ query: { u: "x" } })), "Could not check username availability");
  });

  describe("setUsername", () => {
    const run = (b) => call(ctl.setUsername, authReq({ body: b }));

    test("WB-AUTHC-62 invalid format 400; unknown user 404; unchanged username is a no-op", async () => {
      expect((await run({})).status).toBe(400);
      expect((await run({ username: "Annc" })).status).toBe(404);
      const u = mkUser({ username: "annc" });
      byId(u);
      const r = await run({ username: "ANNC" });
      expect(r.body).toEqual({ message: "That's already your username.", username: "annc" });
      expect(u.save).not.toHaveBeenCalled();
    });

    test("WB-AUTHC-63 cooldown blocks a change and returns the next allowed date", async () => {
      const next = new Date("2026-12-01");
      usernameUtil.getChangeCooldown.mockReturnValue({ ok: false, nextAllowedAt: next });
      byId(mkUser({ username: "old" }));
      const r = await run({ username: "new" });
      expect(r.status).toBe(400);
      expect(r.body.nextAllowedAt).toBe(next);
      expect(r.body.message).toMatch(/You can change your username again on/);
    });

    test("WB-AUTHC-64 a taken username is refused (availability excludes the caller)", async () => {
      byId(mkUser({ username: "old" }));
      usernameUtil.isAvailable.mockResolvedValue(false);
      expect((await run({ username: "new" })).body.message).toBe("That username is already taken.");
      expect(usernameUtil.isAvailable).toHaveBeenCalledWith("new", "u1");
    });

    test("WB-AUTHC-65 success: changed, cooldown stamp, old name tombstoned, audited with old/new", async () => {
      const u = mkUser({ username: "old" });
      byId(u);
      const r = await run({ username: "New" });
      expect(u).toMatchObject({ username: "new" });
      expect(u.usernameChangedAt).toBeInstanceOf(Date);
      expect(ReservedUsername.create).toHaveBeenCalledWith({ username: "old", releasedBy: "u1", reason: "changed" });
      expect(auditService.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ metadata: { previousUsername: "old", newUsername: "new" } }));
      expect(r.body).toEqual({ message: "Your username has been updated.", username: "new" });
    });

    test("WB-AUTHC-66 first-ever username (no previous) is not tombstoned; a failing tombstone is only logged", async () => {
      byId(mkUser({ username: undefined }));
      await run({ username: "new" });
      expect(ReservedUsername.create).not.toHaveBeenCalled();
      byId(mkUser({ username: "old" }));
      ReservedUsername.create.mockRejectedValue(new Error("x"));
      expect((await run({ username: "new" })).status).toBe(200);
      await flush();
      expect(logger.error).toHaveBeenCalledWith("Failed to tombstone released username", expect.anything());
    });

    test("WB-AUTHC-67 unique-index race (E11000) is the 'taken' message; other save errors are a generic 500", async () => {
      const u = mkUser({ username: "old" });
      u.save.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
      byId(u);
      expect((await run({ username: "new" })).body.message).toBe("That username is already taken.");
      const u2 = mkUser({ username: "old" });
      u2.save.mockRejectedValue(dbError());
      byId(u2);
      expect500(await run({ username: "new" }), "Could not set the username");
    });
  });
});

// ---------------------------------------------------------------------------
describe("forgotPassword", () => {
  const GENERIC = { message: "If that email is registered, a password reset link has been sent." };
  const run = (b) => call(ctl.forgotPassword, makeReq({ body: b }));

  test("WB-AUTHC-68 flag off: only `email` is read; blank is 400, unknown and staff-recovery accounts get the generic answer", async () => {
    expect((await run({})).body.message).toBe("Email is required");
    expect((await run({ identifier: "a@x.com" })).status).toBe(400);
    expect((await run({ email: "ghost@x.com" })).body).toEqual(GENERIC);
    found(mkUser({ staffRecoveryPending: true }));
    expect((await run({ email: "a@x.com" })).body).toEqual(GENERIC);
    expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  test("WB-AUTHC-68b a staff account pending activation gets the generic answer: no reset token, no mail, so a reset can never activate it", async () => {
    const u = mkUser({ role: "admin", isActive: false, accountStatus: "pending_activation" });
    found(u);
    expect((await run({ email: "a@x.com" })).body).toEqual(GENERIC);
    expect(u.passwordResetToken).toBeUndefined();
    expect(u.save).not.toHaveBeenCalled();
    expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  test("WB-AUTHC-69 success: token hashed (never stored raw), 30-minute expiry, mail to the primary address, audited, generic response", async () => {
    const u = mkUser();
    found(u);
    const r = await run({ email: " A@X.com " });
    expect(r.body).toEqual(GENERIC);
    expect(u.passwordResetToken).toMatch(/^[0-9a-f]{64}$/);
    const sent = mailService.sendPasswordResetEmail.mock.calls[0][0];
    const rawToken = new URL(sent.resetUrl).searchParams.get("token");
    expect(u.passwordResetToken).not.toBe(rawToken);
    expect(sent).toMatchObject({ to: "a@x.com", expiresMinutes: 30 });
    expect(Math.round((u.passwordResetExpires - Date.now()) / 60000)).toBe(30);
    expect(auditService.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.password.reset_requested" }));
  });

  test("WB-AUTHC-70 recovery email is used only on explicit opt-in (=== true) AND when verified", async () => {
    const verified = mkUser({ recoveryEmail: "rec@x.com", recoveryEmailVerifiedAt: new Date() });
    found(verified);
    await run({ email: "a@x.com", useRecoveryEmail: true });
    expect(mailService.sendPasswordResetEmail.mock.calls[0][0].to).toBe("rec@x.com");
    expect(mailService.sendPasswordResetEmail.mock.calls[0][0].resetUrl).toContain("email=a%40x.com");
    await run({ email: "a@x.com", useRecoveryEmail: "true" });
    expect(mailService.sendPasswordResetEmail.mock.calls[1][0].to).toBe("a@x.com");
    found(mkUser({ recoveryEmail: "rec@x.com" }));
    await run({ email: "a@x.com", useRecoveryEmail: true });
    expect(mailService.sendPasswordResetEmail.mock.calls[2][0].to).toBe("a@x.com");
    found(mkUser());
    await run({ email: "a@x.com", useRecoveryEmail: true });
    expect(mailService.sendPasswordResetEmail.mock.calls[3][0].to).toBe("a@x.com");
  });

  test("WB-AUTHC-71 EXPOSE_DEV_LINKS=true adds devResetUrl", async () => {
    found(mkUser());
    process.env.EXPOSE_DEV_LINKS = "true";
    expect((await run({ email: "a@x.com" })).body.devResetUrl).toContain("/reset-password?token=");
  });

  describe("feature flag on (username identifiers)", () => {
    beforeEach(() => usernameSignup.isUsernameSignupEnabled.mockReturnValue(true));

    test("WB-AUTHC-72 identifier without @ is a username; account with no verified email gets the generic answer", async () => {
      found(mkUser());
      usernameSignup.hasVerifiedEmail.mockReturnValue(false);
      expect((await run({ identifier: "annc" })).body).toEqual(GENERIC);
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    test("WB-AUTHC-73 a username with a verified email gets the link at that email; identifier with @ is treated as email", async () => {
      found(mkUser({ email: "Real@X.com" }));
      await run({ identifier: "annc" });
      expect(mailService.sendPasswordResetEmail.mock.calls[0][0].to).toBe("real@x.com");
      await run({ identifier: "b@x.com" });
      expect(User.findOne).toHaveBeenLastCalledWith({ email: "b@x.com" });
      await run({ email: "c@x.com" });
      expect(User.findOne).toHaveBeenLastCalledWith({ email: "c@x.com" });
    });

    test("WB-AUTHC-74 blank identifier is 400; unknown username is generic", async () => {
      expect((await run({})).status).toBe(400);
      expect((await run({ identifier: "ghost" })).body).toEqual(GENERIC);
    });
  });

  test("WB-AUTHC-75 a mail or DB failure is a generic 500 (the real reason is never echoed)", async () => {
    found(mkUser());
    mailService.sendPasswordResetEmail.mockRejectedValue(dbError());
    expect500(await run({ email: "a@x.com" }), "Could not process the request");
  });
});

// ---------------------------------------------------------------------------
describe("resetPassword", () => {
  const run = (b) => call(ctl.resetPassword, makeReq({ body: b }));
  const ok = { token: "tok", email: "A@x.com", password: STRONG };

  test("WB-AUTHC-76 incomplete link, short password", async () => {
    expect((await run({ email: "a@x.com", password: STRONG })).body.message).toMatch(/incomplete/);
    expect((await run({ token: "t", password: STRONG })).status).toBe(400);
    expect((await run({ token: "t", email: "a@x.com", password: "short" })).body.message).toMatch(/at least 8/);
    expect(User.findOne).not.toHaveBeenCalled();
  });

  test("WB-AUTHC-77 lookup uses the HASHED token, a future expiry and excludes staff-recovery accounts; no match is 400", async () => {
    const r = await run(ok);
    expect(r.status).toBe(400);
    const filter = User.findOne.mock.calls[0][0];
    expect(filter.email).toBe("a@x.com");
    expect(filter.passwordResetToken).toMatch(/^[0-9a-f]{64}$/);
    expect(filter.passwordResetToken).not.toBe("tok");
    expect(filter.passwordResetExpires.$gt).toBeInstanceOf(Date);
    expect(filter.staffRecoveryPending).toEqual({ $ne: true });
    // A pending staff account is never reachable through a reset token.
    expect(filter.accountStatus).toEqual({ $ne: "pending_activation" });
  });

  test("WB-AUTHC-78 policy rejection is returned", async () => {
    found(mkUser());
    passwordPolicy.enforce.mockReturnValue({ ok: false, code: "PASSWORD_COMMON", message: "weak" });
    expect((await run(ok)).body.code).toBe("PASSWORD_COMMON");
  });

  test("WB-AUTHC-79 success: new hash, reset token spent, lock and email code cleared, all sessions invalidated, notices sent", async () => {
    const u = mkUser({ tokenVersion: 5, passwordResetToken: "x", passwordResetExpires: new Date(), loginLock: { failures: 5 }, emailCode: { c: 1 } });
    found(u);
    const r = await run(ok);
    expect(u).toMatchObject({ password: `h:${STRONG}`, passwordResetToken: null, passwordResetExpires: null, loginLock: undefined, emailCode: undefined, tokenVersion: 6 });
    expect(r.body.message).toMatch(/has been reset/);
    expect(mailService.sendPasswordChangedEmail).toHaveBeenCalled();
    expect(accountAlerts.notifyPasswordChanged).toHaveBeenCalled();
    expect(auditService.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.password.reset" }));
  });

  test("WB-AUTHC-80 tokenVersion starts at 0 when unset; a failing notice mail is only logged; a DB error is a generic 500", async () => {
    const u = mkUser({ tokenVersion: undefined });
    found(u);
    mailService.sendPasswordChangedEmail.mockRejectedValue(new Error("smtp"));
    await run(ok);
    await flush();
    expect(u.tokenVersion).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("password-reset notification"), expect.anything());
    User.findOne.mockImplementation(() => failingQuery(dbError()));
    expect500(await run(ok), "Could not reset the password");
  });
});

// ---------------------------------------------------------------------------
describe("email change", () => {
  describe("requestEmailChange", () => {
    const run = (b) => call(ctl.requestEmailChange, authReq({ body: b }));
    const ok = { newEmail: "New@X.com", currentPassword: "pw" };

    test("WB-AUTHC-81 blank / malformed new email are rejected before any lookup", async () => {
      expect((await run({})).body.message).toBe("Enter the new email address.");
      expect((await run({ newEmail: "nope" })).body.message).toMatch(/valid email/);
      expect((await run({ newEmail: "a b@x.com" })).status).toBe(400);
      expect(User.findById).not.toHaveBeenCalled();
    });

    test("WB-AUTHC-82 unknown user 404; same address 400; no local password 400; wrong password 400; address taken 400", async () => {
      expect((await run(ok)).status).toBe(404);
      byId(mkUser({ email: "new@x.com" }));
      expect((await run(ok)).body.message).toMatch(/already your email/);
      byId(mkUser({ password: undefined }));
      expect((await run(ok)).body.message).toMatch(/Set a password first/);
      byId(mkUser());
      loginLock.checkPasswordWithLock.mockResolvedValue(false);
      expect((await run(ok)).body.message).toMatch(/current password is incorrect/);
      loginLock.checkPasswordWithLock.mockResolvedValue(true);
      found({ _id: "other" });
      expect((await run(ok)).body.message).toMatch(/already in use/);
      expect(User.findOne).toHaveBeenLastCalledWith({ email: "new@x.com", _id: { $ne: "u1" } });
    });

    test("WB-AUTHC-83 a username-only account (no email) can still add one", async () => {
      byId(mkUser({ email: undefined }));
      expect((await run(ok)).status).toBe(200);
    });

    test("WB-AUTHC-84 success: pending address + hashed 30-min token, link mailed to the NEW address, alert to the OLD, audited", async () => {
      const u = mkUser();
      byId(u);
      const r = await run(ok);
      expect(u.pendingEmail).toBe("new@x.com");
      expect(u.emailChangeToken).toMatch(/^[0-9a-f]{64}$/);
      expect(Math.round((u.emailChangeExpires - Date.now()) / 60000)).toBe(30);
      expect(mailService.sendEmailChangeVerification).toHaveBeenCalledWith(expect.objectContaining({ to: "new@x.com", expiresMinutes: 30 }));
      expect(mailService.sendEmailChangeAlert).toHaveBeenCalledWith({ to: "a@x.com", name: "Ann", newEmail: "new@x.com" });
      expect(r.body.devVerifyUrl).toBeUndefined();
      process.env.EXPOSE_DEV_LINKS = "true";
      expect((await run(ok)).body.devVerifyUrl).toContain("/verify-email?token=");
    });

    test("WB-AUTHC-85 a failing alert mail is only logged; a DB failure is a generic 500", async () => {
      byId(mkUser());
      mailService.sendEmailChangeAlert.mockRejectedValue(new Error("smtp"));
      expect((await run(ok)).status).toBe(200);
      await flush();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("email-change alert"), expect.anything());
      User.findById.mockImplementation(() => failingQuery(dbError()));
      expect500(await run(ok), "Could not start the email change");
    });
  });

  describe("confirmEmailChange", () => {
    const run = (b) => call(ctl.confirmEmailChange, makeReq({ body: b }));
    const pending = (o = {}) => mkUser({ email: "old@x.com", pendingEmail: "new@x.com", emailChangeToken: "t", emailChangeExpires: new Date(), ...o });

    test("WB-AUTHC-86 incomplete link and unknown/expired token", async () => {
      expect((await run({ email: "new@x.com" })).body.message).toMatch(/incomplete/);
      expect((await run({ token: "t" })).status).toBe(400);
      const r = await run({ token: "t", email: "New@x.com" });
      expect(r.body.message).toMatch(/invalid or has expired/);
      const f = User.findOne.mock.calls[0][0];
      expect(f.pendingEmail).toBe("new@x.com");
      expect(f.emailChangeToken).toMatch(/^[0-9a-f]{64}$/);
      expect(f.emailChangeExpires.$gt).toBeInstanceOf(Date);
    });

    test("WB-AUTHC-87 address registered by someone else in the meantime: pending change is discarded", async () => {
      const u = pending();
      User.findOne.mockReturnValueOnce(query(u)).mockReturnValueOnce(query({ _id: "other" }));
      const r = await run({ token: "t", email: "new@x.com" });
      expect(r.status).toBe(400);
      expect(u).toMatchObject({ pendingEmail: null, emailChangeToken: null, emailChangeExpires: null, email: "old@x.com" });
      expect(u.save).toHaveBeenCalled();
    });

    test("WB-AUTHC-88 success: address swapped, verified, token spent, completion alert to the OLD address, audited", async () => {
      const u = pending();
      User.findOne.mockReturnValueOnce(query(u)).mockReturnValueOnce(query(null));
      const r = await run({ token: "t", email: "new@x.com" });
      expect(u).toMatchObject({ email: "new@x.com", pendingEmail: null, emailChangeToken: null, isEmailVerified: true });
      expect(u.emailVerifiedAt).toBeInstanceOf(Date);
      expect(mailService.sendEmailChangeAlert).toHaveBeenCalledWith({ to: "old@x.com", name: "Ann", newEmail: "new@x.com", completed: true });
      expect(auditService.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.email_change_completed" }));
      expect(r.body.message).toMatch(/updated/);
    });

    test("WB-AUTHC-89 failing completion alert is only logged; DB failure is a generic 500", async () => {
      User.findOne.mockReturnValueOnce(query(pending())).mockReturnValueOnce(query(null));
      mailService.sendEmailChangeAlert.mockRejectedValue(new Error("smtp"));
      expect((await run({ token: "t", email: "new@x.com" })).status).toBe(200);
      await flush();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("completion alert"), expect.anything());
      User.findOne.mockImplementation(() => failingQuery(dbError()));
      expect500(await run({ token: "t", email: "new@x.com" }), "Could not confirm the email change");
    });
  });
});

// ---------------------------------------------------------------------------
describe("recovery email", () => {
  describe("requestRecoveryEmail", () => {
    const run = (b) => call(ctl.requestRecoveryEmail, authReq({ body: b }));
    const ok = { recoveryEmail: "Rec@X.com", currentPassword: "pw" };

    test("WB-AUTHC-90 validation order: blank, malformed, unknown user, same as sign-in email, no password, wrong password, already used elsewhere", async () => {
      expect((await run({})).body.message).toBe("Enter a recovery email address.");
      expect((await run({ recoveryEmail: "nope" })).body.message).toMatch(/valid email/);
      expect((await run(ok)).status).toBe(404);
      byId(mkUser({ email: "rec@x.com" }));
      expect((await run(ok)).body.message).toMatch(/must be different/);
      byId(mkUser({ password: undefined }));
      expect((await run(ok)).body.message).toMatch(/Set a password first/);
      byId(mkUser());
      loginLock.checkPasswordWithLock.mockResolvedValue(false);
      expect((await run(ok)).body.message).toMatch(/current password is incorrect/);
      loginLock.checkPasswordWithLock.mockResolvedValue(true);
      found({ _id: "other" });
      expect((await run(ok)).body.message).toMatch(/another account/);
    });

    test.each([[undefined, "added"], ["old@x.com", "replaced"]])("WB-AUTHC-91 existing recovery email %p is reported to the primary address as '%s'", async (existing, action) => {
      const u = mkUser({ recoveryEmail: existing, recoveryEmailVerifiedAt: new Date() });
      byId(u);
      const r = await run(ok);
      expect(u).toMatchObject({ recoveryEmail: "rec@x.com", recoveryEmailVerifiedAt: null });
      expect(u.recoveryEmailToken).toMatch(/^[0-9a-f]{64}$/);
      expect(mailService.sendRecoveryEmailVerification).toHaveBeenCalledWith(expect.objectContaining({ to: "rec@x.com" }));
      expect(mailService.sendRecoveryEmailAlert).toHaveBeenCalledWith(expect.objectContaining({ to: "a@x.com", action }));
      expect(r.body.devVerifyUrl).toBeUndefined();
    });

    test("WB-AUTHC-92 dev link only with EXPOSE_DEV_LINKS; failing alert only logged; DB failure generic 500", async () => {
      byId(mkUser());
      process.env.EXPOSE_DEV_LINKS = "true";
      expect((await run(ok)).body.devVerifyUrl).toContain("/verify-recovery-email?token=");
      mailService.sendRecoveryEmailAlert.mockRejectedValue(new Error("smtp"));
      expect((await run(ok)).status).toBe(200);
      await flush();
      expect(logger.error).toHaveBeenCalledWith("Failed to send recovery-email alert", expect.anything());
      User.findById.mockImplementation(() => failingQuery(dbError()));
      expect500(await run(ok), "Could not set the recovery email");
    });
  });

  describe("confirmRecoveryEmail", () => {
    const run = (b) => call(ctl.confirmRecoveryEmail, makeReq({ body: b }));

    test("WB-AUTHC-93 incomplete, unknown/expired, success, and generic 500", async () => {
      expect((await run({ token: "t" })).status).toBe(400);
      expect((await run({ email: "r@x.com" })).status).toBe(400);
      expect((await run({ token: "t", email: "r@x.com" })).body.message).toMatch(/invalid or has expired/);
      const u = mkUser({ recoveryEmailToken: "x", recoveryEmailExpires: new Date() });
      found(u);
      const r = await run({ token: "t", email: "R@x.com" });
      expect(u.recoveryEmailVerifiedAt).toBeInstanceOf(Date);
      expect(u).toMatchObject({ recoveryEmailToken: null, recoveryEmailExpires: null });
      expect(r.body.message).toMatch(/confirmed/);
      User.findOne.mockImplementation(() => failingQuery(dbError()));
      expect500(await run({ token: "t", email: "r@x.com" }), "Could not confirm the recovery email");
    });
  });
});

// ---------------------------------------------------------------------------
describe("backup codes", () => {
  test("WB-AUTHC-94 generateBackupCodes: 404 for unknown user", async () => {
    expect((await call(ctl.generateBackupCodes, authReq())).status).toBe(404);
  });

  test("WB-AUTHC-95 generates 10 unambiguous codes, stores only bcrypt hashes, replaces the previous set, notifies and audits", async () => {
    const u = mkUser({ backupCodes: [{ hash: "old", usedAt: null }] });
    byId(u);
    const r = await call(ctl.generateBackupCodes, authReq());
    expect(r.body.codes).toHaveLength(10);
    expect(new Set(r.body.codes).size).toBe(10);
    r.body.codes.forEach((c) => expect(c).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/));
    expect(u.backupCodes).toHaveLength(10);
    expect(u.backupCodes[0]).toEqual({ hash: `h:${r.body.codes[0]}`, usedAt: null });
    expect(JSON.stringify(u.backupCodes)).not.toContain("old");
    expect(mailService.sendBackupCodesGeneratedEmail).toHaveBeenCalledWith({ to: "a@x.com", name: "Ann", count: 10 });
    expect(auditService.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "user.backup_codes.generated" }));
    expect(logger.info.mock.calls.concat(logger.error.mock.calls).flat().join(" ")).not.toContain(r.body.codes[0]);
  });

  test("WB-AUTHC-96 a failing notice mail is only logged; a DB error is a generic 500", async () => {
    byId(mkUser());
    mailService.sendBackupCodesGeneratedEmail.mockRejectedValue(new Error("smtp"));
    expect((await call(ctl.generateBackupCodes, authReq())).status).toBe(200);
    await flush();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("backup-codes-generated"), expect.anything());
    User.findById.mockImplementation(() => failingQuery(dbError()));
    expect500(await call(ctl.generateBackupCodes, authReq()), "Could not generate backup codes");
  });

  describe("redeemBackupCode", () => {
    const GENERIC = { message: "That code didn't work. Check it and try again, or contact the PESO office for help." };
    const run = (b) => call(ctl.redeemBackupCode, makeReq({ body: b }));
    const withCodes = (o = {}) => mkUser({ tokenVersion: 3, backupCodes: [{ hash: "h:AAAA-BBBB", usedAt: null }, { hash: "h:CCCC-DDDD", usedAt: null }], ...o });

    test("WB-AUTHC-97 missing identifier or code is the generic 400", async () => {
      expect((await run({ code: "X" })).body).toEqual(GENERIC);
      expect((await run({ identifier: "a@x.com" })).body).toEqual(GENERIC);
      expect(User.findOne).not.toHaveBeenCalled();
    });

    test("WB-AUTHC-98 unknown account, account with no codes, all codes used and a wrong code are indistinguishable (same body, a bcrypt compare each time)", async () => {
      const bodies = [];
      bcrypt.compare.mockClear();
      bodies.push((await run({ identifier: "ghost@x.com", code: "AAAA-BBBB" })).body);
      found(mkUser({ backupCodes: [] }));
      bodies.push((await run({ identifier: "a@x.com", code: "AAAA-BBBB" })).body);
      found(withCodes({ backupCodes: [{ hash: "h:AAAA-BBBB", usedAt: new Date() }] }));
      bodies.push((await run({ identifier: "a@x.com", code: "AAAA-BBBB" })).body);
      found(withCodes());
      bodies.push((await run({ identifier: "a@x.com", code: "ZZZZ-ZZZZ" })).body);
      bodies.forEach((b) => expect(b).toEqual(GENERIC));
      expect(bcrypt.compare.mock.calls.length).toBeGreaterThanOrEqual(5);
    });

    test("WB-AUTHC-99 correct code (case-insensitive): marked used, tokenVersion bumped, 15-minute recovery-scope token, critical audit, alert mail", async () => {
      const u = withCodes();
      found(u);
      const r = await run({ identifier: "a@x.com", code: " cccc-dddd " });
      expect(r.status).toBe(200);
      expect(u.backupCodes[1].usedAt).toBeInstanceOf(Date);
      expect(u.backupCodes[0].usedAt).toBeNull();
      expect(u.tokenVersion).toBe(4);
      const d = verifyJwt(r.body.recoveryToken);
      expect(d).toMatchObject({ id: "u1", scope: "recovery", tokenVersion: 4 });
      expect(Math.round((d.exp - d.iat) / 60)).toBe(15);
      expect(r.body.expiresInMinutes).toBe(15);
      expect(auditService.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.backup_code.redeemed", severity: "critical" }));
      expect(mailService.sendBackupCodeRedeemedEmail).toHaveBeenCalled();
    });

    test("WB-AUTHC-100 a used code cannot be replayed; staffRecoveryPending accounts get the generic answer even with a valid code", async () => {
      const u = withCodes();
      found(u);
      await run({ identifier: "a@x.com", code: "AAAA-BBBB" });
      expect((await run({ identifier: "a@x.com", code: "AAAA-BBBB" })).body).toEqual(GENERIC);
      found(withCodes({ staffRecoveryPending: true }));
      expect((await run({ identifier: "a@x.com", code: "AAAA-BBBB" })).body).toEqual(GENERIC);
    });

    test("WB-AUTHC-101 users with undefined backupCodes / tokenVersion are handled; failing alert only logged; DB error is a generic 500", async () => {
      found(mkUser({ backupCodes: undefined }));
      expect((await run({ identifier: "a@x.com", code: "AAAA-BBBB" })).status).toBe(400);
      const u = withCodes({ tokenVersion: undefined });
      found(u);
      mailService.sendBackupCodeRedeemedEmail.mockRejectedValue(new Error("smtp"));
      expect((await run({ identifier: "a@x.com", code: "AAAA-BBBB" })).status).toBe(200);
      await flush();
      expect(u.tokenVersion).toBe(1);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("backup-code-redeemed"), expect.anything());
      User.findOne.mockImplementation(() => failingQuery(dbError()));
      expect500(await run({ identifier: "a@x.com", code: "AAAA-BBBB" }), "Could not process the request");
    });
  });

  describe("recoverSetPassword", () => {
    const run = (b) => call(ctl.recoverSetPassword, authReq({ body: b, user: actor({ scope: "recovery" }) }));

    test("WB-AUTHC-102 short password 400; unknown user 404; policy rejection returned", async () => {
      expect((await run({ newPassword: "short" })).status).toBe(400);
      expect((await run({ newPassword: STRONG })).status).toBe(404);
      byId(mkUser());
      passwordPolicy.enforce.mockReturnValue({ ok: false, code: "X", message: "weak" });
      expect((await run({ newPassword: STRONG })).body.code).toBe("X");
    });

    test("WB-AUTHC-103 success: password set, lock/email code cleared, tokenVersion bumped (spends the recovery token), full 30-day session issued, critical audit", async () => {
      const u = mkUser({ tokenVersion: 4, loginLock: { failures: 9 }, emailCode: { c: 1 } });
      byId(u);
      const r = await run({ newPassword: STRONG });
      expect(u).toMatchObject({ password: `h:${STRONG}`, loginLock: undefined, emailCode: undefined, tokenVersion: 5 });
      const d = verifyJwt(r.body.token);
      expect(d).toMatchObject({ id: "u1", role: "jobseeker", tokenVersion: 5 });
      expect(d.scope).toBeUndefined();
      expect(auditService.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.account.recovered", severity: "critical" }));
    });

    test("WB-AUTHC-104 failing notice mail only logged; DB error generic 500", async () => {
      byId(mkUser({ tokenVersion: undefined }));
      mailService.sendPasswordChangedEmail.mockRejectedValue(new Error("smtp"));
      expect((await run({ newPassword: STRONG })).status).toBe(200);
      await flush();
      expect(logger.error).toHaveBeenCalled();
      User.findById.mockImplementation(() => failingQuery(dbError()));
      expect500(await run({ newPassword: STRONG }), "Could not set the new password");
    });
  });
});

// ---------------------------------------------------------------------------
describe("googleAuth / googleComplete", () => {
  const payload = (o = {}) => ({ email: "G@x.com", sub: "g1", name: "Gina", email_verified: true, ...o });
  const verified = (p = payload()) => googleVerify.mockResolvedValue({ getPayload: () => p });
  const run = (b = {}) => call(ctl.googleAuth, makeReq({ body: { credential: "tok", ...b } }));

  test("WB-AUTHC-105 503 when not configured; missing credential 400; verification failure 401", async () => {
    process.env.GOOGLE_CLIENT_ID = "";
    expect((await run()).status).toBe(503);
    process.env.GOOGLE_CLIENT_ID = "client-id";
    expect((await call(ctl.googleAuth, makeReq({ body: {} }))).status).toBe(400);
    googleVerify.mockRejectedValue(new Error("bad"));
    expect((await run()).status).toBe(401);
  });

  test.each([[null], [{ sub: "x" }], [payload({ email_verified: false })]])("WB-AUTHC-106 unusable Google payload %j is 401", async (p) => {
    verified(p);
    const r = await run();
    expect(r.status).toBe(401);
    expect(r.body.message).toMatch(/no verified email/);
  });

  test("WB-AUTHC-107 email_verified absent is accepted (only an explicit false is refused)", async () => {
    verified(payload({ email_verified: undefined }));
    expect((await run()).status).toBe(202);
  });

  test("WB-AUTHC-108 first-time jobseeker: nothing is created; a 10-minute signed pending token carries the verified identity", async () => {
    verified();
    const r = await run();
    expect(r.status).toBe(202);
    expect(r.body.code).toBe("DOB_REQUIRED");
    expect(User.create).not.toHaveBeenCalled();
    const d = verifyJwt(r.body.pendingToken);
    expect(d).toMatchObject({ purpose: "google_signup", email: "g@x.com", googleId: "g1", name: "Gina" });
    expect(Math.round((d.exp - d.iat) / 60)).toBe(10);
  });

  test("WB-AUTHC-109 display name falls back to the email local part", async () => {
    verified(payload({ name: "   " }));
    expect(verifyJwt((await run()).body.pendingToken).name).toBe("g");
    verified(payload({ name: undefined }));
    expect(verifyJwt((await run()).body.pendingToken).name).toBe("g");
  });

  test("WB-AUTHC-110 an arbitrary `intent` can only ever mint jobseeker/employer (never admin)", async () => {
    verified();
    expect((await run({ intent: "admin" })).status).toBe(202);
    expect(User.create).not.toHaveBeenCalled();
  });

  test("WB-AUTHC-110b a matching Google email cannot sign in to, or link, a staff account pending activation", async () => {
    verified(payload({ email: "staff@peso.gov" }));
    const u = mkUser({ role: "admin", email: "staff@peso.gov", isActive: false, accountStatus: "pending_activation" });
    found(u);
    const r = await run();
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("ACCOUNT_PENDING_ACTIVATION");
    expect(r.body).not.toHaveProperty("token");
    expect(r.body).not.toHaveProperty("appealToken");
    expect(u.googleId).toBeUndefined();
    expect(u.save).not.toHaveBeenCalled();
  });

  test.each([undefined, "false", "no"])("WB-AUTHC-111 employer sign-up needs the 18+ attestation (%p refused)", async (v) => {
    verified();
    const r = await run({ intent: "employer", confirmAdult: v });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("EMPLOYER_ADULT_ATTESTATION_REQUIRED");
    expect(User.create).not.toHaveBeenCalled();
  });

  test("WB-AUTHC-112 employer sign-up creates a verified account + profile, suggests a username, notifies admins and signs in", async () => {
    verified();
    User.create.mockResolvedValue(mkUser({ _id: "emp", role: "employer", email: "g@x.com", name: "Gina" }));
    User.find.mockImplementation(() => query([{ _id: "a1" }]));
    const r = await run({ intent: " employer ", confirmAdult: "on" });
    expect(r.status).toBe(200);
    expect(User.create.mock.calls[0][0]).toMatchObject({ email: "g@x.com", googleId: "g1", authProvider: "google", role: "employer", isEmailVerified: true });
    expect(EmployerProfile.create).toHaveBeenCalledWith({ userId: "emp" });
    expect(notificationService.notifyManyUsers).toHaveBeenCalledWith(expect.objectContaining({ recipientIds: ["a1"] }));
    expect(auditService.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.employer.registered" }));
    expect(r.body.isNewUser).toBe(true);
    expect(verifyJwt(r.body.token).role).toBe("employer");
  });

  test("WB-AUTHC-113 existing password account with the same verified email: Google is linked and the email marked verified", async () => {
    verified();
    const u = mkUser({ email: "g@x.com", googleId: undefined, isEmailVerified: undefined });
    found(u);
    const r = await run();
    expect(u).toMatchObject({ googleId: "g1", isEmailVerified: true });
    expect(u.emailVerifiedAt).toBeInstanceOf(Date);
    expect(u.save).toHaveBeenCalled();
    expect(r.body.isNewUser).toBe(false);
    expect(User.findOne).toHaveBeenCalledWith({ $or: [{ googleId: "g1" }, { email: "g@x.com" }] });
  });

  test("WB-AUTHC-114 a returning Google user needs no save; an email change on our side is NOT vouched for by the old Google address", async () => {
    verified();
    const same = mkUser({ email: "g@x.com", googleId: "g1", isEmailVerified: true });
    found(same);
    await run();
    expect(same.save).not.toHaveBeenCalled();
    const changed = mkUser({ email: "new@x.com", googleId: "g1", isEmailVerified: false });
    found(changed);
    await run();
    expect(changed.isEmailVerified).toBe(false);
    expect(changed.save).not.toHaveBeenCalled();
  });

  test.each([[{ googleSignInDisabled: true }], [{ staffRecoveryPending: true }]])("WB-AUTHC-115 account flagged %j cannot use Google", async (flag) => {
    verified();
    found(mkUser({ email: "g@x.com", ...flag }));
    expect((await run()).status).toBe(403);
  });

  describe("unverified password stub", () => {
    const stub = (o = {}) => mkUser({ email: "g@x.com", isEmailVerified: false, googleId: undefined, role: "jobseeker", ...o });

    test("WB-AUTHC-116 the stub is deleted (with its profiles) and the normal first-time flow runs", async () => {
      verified();
      found(stub());
      const r = await run();
      expect(User.deleteOne).toHaveBeenCalledWith({ _id: "u1", isEmailVerified: false, googleId: null });
      expect(JobseekerProfile.deleteOne).toHaveBeenCalledWith({ userId: "u1" });
      expect(EmployerProfile.deleteOne).toHaveBeenCalledWith({ userId: "u1" });
      expect(auditService.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.user.unverified_stub_replaced" }));
      expect(r.status).toBe(202);
    });

    test("WB-AUTHC-117 if the stub was verified/linked since it was read (deletedCount !== 1) the request is a 409 retry", async () => {
      verified();
      found(stub());
      User.deleteOne.mockResolvedValue({ deletedCount: 0 });
      const r = await run();
      expect(r.status).toBe(409);
      expect(JobseekerProfile.deleteOne).not.toHaveBeenCalled();
    });

    test.each([
      ["already linked to Google", { googleId: "g1" }],
      ["email verified", { isEmailVerified: true }],
      ["email unset", { isEmailVerified: undefined }],
      ["staff role", { role: "admin" }],
      ["different email", { email: "other@x.com" }],
    ])("WB-AUTHC-118 an account that is %s is NOT treated as a stub", async (_n, o) => {
      verified();
      found(stub(o));
      await run();
      expect(User.deleteOne).not.toHaveBeenCalled();
    });
  });

  test("WB-AUTHC-119 self-deactivated account is reactivated by Google sign-in", async () => {
    verified();
    const u = mkUser({ email: "g@x.com", googleId: "g1", isEmailVerified: true, isActive: false, accountStatus: "deactivated" });
    found(u);
    const r = await run();
    expect(u).toMatchObject({ isActive: true, accountStatus: "active", deactivatedAt: null });
    expect(r.body.reactivated).toBe(true);
  });

  test.each([["banned", "banned"], ["suspended", "suspended"], [undefined, "suspended"]])("WB-AUTHC-120 suspended account (%p) gets 403 + appeal token", async (accountStatus, expected) => {
    verified();
    found(mkUser({ email: "g@x.com", googleId: "g1", isActive: false, accountStatus, suspensionReason: "r" }));
    const r = await run();
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: "ACCOUNT_SUSPENDED", accountStatus: expected });
    expect(verifyJwt(r.body.appealToken).scope).toBe("appeal");
    found(mkUser({ email: "g@x.com", googleId: "g1", isActive: false }));
    const r2 = await run();
    expect(r2.body.suspensionReason).toBeNull();
    expect(r2.body.suspendedAt).toBeNull();
  });

  test("WB-AUTHC-121 KNOWN-ISSUE: a DISABLED STAFF account gets the jobseeker suspension/appeal flow via Google (login() answers ACCOUNT_DISABLED with no appeal token)", async () => {
    verified();
    found(mkUser({ email: "g@x.com", googleId: "g1", role: "admin", isActive: false, accountStatus: "suspended" }));
    const r = await run();
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("ACCOUNT_SUSPENDED");
    expect(r.body.appealToken).toBeDefined();
  });

  test("WB-AUTHC-122 KNOWN-ISSUE: an account already linked to Google account A can be signed into by Google account B that shares the verified email (only the email is matched)", async () => {
    verified(payload({ sub: "attacker-sub" }));
    found(mkUser({ email: "g@x.com", googleId: "original-sub", isEmailVerified: true }));
    const r = await run();
    expect(r.status).toBe(200);
    expect(verifyJwt(r.body.token).id).toBe("u1");
  });

  test("WB-AUTHC-123 successful Google login returns the user summary and audits login_success (no lastLoginAt write, unlike password login)", async () => {
    verified();
    found(mkUser({ email: "g@x.com", googleId: "g1", isEmailVerified: true, username: undefined, verificationStatus: "none" }));
    const r = await run();
    expect(r.body.user).toMatchObject({ id: "u1", username: null, isEmailVerified: true, hasVerifiedEmail: true });
    expect(auditService.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.user.login_success" }));
    expect(User.updateOne).not.toHaveBeenCalled();
  });

  test("WB-AUTHC-124 creation race (E11000) is a 409 retry; other errors a generic 500", async () => {
    verified();
    User.findOne.mockImplementation(() => failingQuery(Object.assign(new Error("dup"), { code: 11000 })));
    expect((await run()).status).toBe(409);
    User.findOne.mockImplementation(() => failingQuery(dbError()));
    expect500(await run(), "Google sign-in failed");
  });

  describe("googleComplete", () => {
    const pending = (o = {}, secret = "test-secret", opts = {}) => jwt.sign({ purpose: "google_signup", email: "g@x.com", googleId: "g1", name: "Gina", ...o }, secret, opts);
    const go = (b) => call(ctl.googleComplete, makeReq({ body: b }));

    test("WB-AUTHC-125 missing, forged, expired or wrong-purpose pending tokens are GOOGLE_PENDING_EXPIRED", async () => {
      for (const t of [undefined, "garbage", pending({}, "other-secret"), pending({}, "test-secret", { expiresIn: -5 }), pending({ purpose: "x" }), pending({ email: undefined }), pending({ googleId: undefined })]) {
        const r = await go({ pendingToken: t, dateOfBirth: "2000-01-01" });
        expect(r.status).toBe(401);
        expect(r.body.code).toBe("GOOGLE_PENDING_EXPIRED");
      }
      expect(User.create).not.toHaveBeenCalled();
    });

    test("WB-AUTHC-126 invalid date of birth creates nothing", async () => {
      age.validateDobInput.mockReturnValue({ ok: false, code: "DOB_UNDER_MINIMUM_AGE" });
      const r = await go({ pendingToken: pending(), dateOfBirth: "2020-01-01" });
      expect(r.status).toBe(400);
      expect(User.create).not.toHaveBeenCalled();
    });

    test("WB-AUTHC-127 an account that appeared meanwhile is a 409 'sign in instead'", async () => {
      found(mkUser());
      expect((await go({ pendingToken: pending(), dateOfBirth: "2000-01-01" })).status).toBe(409);
    });

    test("WB-AUTHC-128 an unverified stub registered meanwhile is purged and sign-up continues; a stub that cannot be purged still blocks (409)", async () => {
      const stub = mkUser({ email: "g@x.com", isEmailVerified: false, googleId: undefined });
      found(stub);
      User.create.mockResolvedValue(mkUser({ _id: "new", email: "g@x.com" }));
      expect((await go({ pendingToken: pending(), dateOfBirth: "2000-01-01" })).status).toBe(200);
      found(stub);
      User.deleteOne.mockResolvedValue({ deletedCount: 0 });
      expect((await go({ pendingToken: pending(), dateOfBirth: "2000-01-01" })).status).toBe(409);
    });

    test("WB-AUTHC-129 success: jobseeker created with the locked DOB, profile + username, signed in as a new user", async () => {
      User.create.mockResolvedValue(mkUser({ _id: "new", email: "g@x.com" }));
      const r = await go({ pendingToken: pending(), dateOfBirth: "2000-01-01" });
      expect(User.create.mock.calls[0][0]).toMatchObject({ role: "jobseeker", dobSource: "google_pending", googleId: "g1", dateOfBirth: expect.any(Date) });
      expect(JobseekerProfile.create).toHaveBeenCalledWith({ userId: "new" });
      expect(r.body.isNewUser).toBe(true);
      expect(notificationService.notifyManyUsers).not.toHaveBeenCalled();
    });

    test("WB-AUTHC-130 create race (E11000) is a 409 retry; other errors generic 500", async () => {
      User.create.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
      expect((await go({ pendingToken: pending(), dateOfBirth: "2000-01-01" })).status).toBe(409);
      User.create.mockRejectedValue(dbError());
      expect500(await go({ pendingToken: pending(), dateOfBirth: "2000-01-01" }), "Google sign-in failed");
    });
  });
});

// ---------------------------------------------------------------------------
describe("email verification", () => {
  test("WB-AUTHC-131 resend: blank 400; unknown and already verified get the same generic answer; otherwise a new link", async () => {
    const GENERIC = { message: "If that email is registered and not yet verified, a verification link has been sent." };
    const run = (b) => call(ctl.resendEmailVerification, makeReq({ body: b }));
    expect((await run({})).status).toBe(400);
    expect((await run({ email: "ghost@x.com" })).body).toEqual(GENERIC);
    found(mkUser({ isEmailVerified: true }));
    expect((await run({ email: "a@x.com" })).body).toEqual(GENERIC);
    expect(mailService.sendEmailVerification).not.toHaveBeenCalled();
    found(mkUser({ isEmailVerified: false }));
    expect((await run({ email: "a@x.com" })).body).toEqual(GENERIC);
    expect(mailService.sendEmailVerification).toHaveBeenCalledTimes(1);
    found(mkUser({ isEmailVerified: undefined }));
    process.env.EXPOSE_DEV_LINKS = "true";
    expect((await run({ email: "a@x.com" })).body.devVerifyUrl).toContain("confirm-email");
    User.findOne.mockImplementation(() => failingQuery(dbError()));
    expect500(await run({ email: "a@x.com" }), "Could not process the request");
  });

  test("WB-AUTHC-132 confirm: incomplete, unknown/expired, success, generic 500", async () => {
    const run = (b) => call(ctl.confirmEmailVerification, makeReq({ body: b }));
    expect((await run({ token: "t" })).status).toBe(400);
    expect((await run({ email: "a@x.com" })).status).toBe(400);
    expect((await run({ token: "t", email: "a@x.com" })).body.message).toMatch(/invalid or has expired/);
    const f = User.findOne.mock.calls[0][0];
    expect(f.emailVerificationToken).toMatch(/^[0-9a-f]{64}$/);
    const u = mkUser({ isEmailVerified: false, emailVerificationToken: "x" });
    found(u);
    const r = await run({ token: "t", email: "a@x.com" });
    expect(u).toMatchObject({ isEmailVerified: true, emailVerificationToken: null, emailVerificationExpires: null });
    expect(r.body.message).toMatch(/verified/);
    User.findOne.mockImplementation(() => failingQuery(dbError()));
    expect500(await run({ token: "t", email: "a@x.com" }), "Could not verify the email");
  });
});

// ---------------------------------------------------------------------------
describe("acceptTerms / getMe / getProfile", () => {
  test("WB-AUTHC-133 acceptTerms: default and custom version, 404, generic 500", async () => {
    User.findByIdAndUpdate.mockImplementation(() => query({ acceptedTermsAt: "t", termsVersion: "2026-01" }));
    let r = await call(ctl.acceptTerms, authReq({ body: {} }));
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith("u1", { acceptedTermsAt: expect.any(Date), termsVersion: "2026-01" }, { new: true });
    expect(r.body).toEqual({ message: "Terms accepted", acceptedTermsAt: "t", termsVersion: "2026-01" });
    await call(ctl.acceptTerms, authReq({ body: { version: "2027-05" } }));
    expect(User.findByIdAndUpdate.mock.calls[1][1].termsVersion).toBe("2027-05");
    User.findByIdAndUpdate.mockImplementation(() => query(null));
    expect((await call(ctl.acceptTerms, authReq({ body: {} }))).status).toBe(404);
    User.findByIdAndUpdate.mockImplementation(() => failingQuery(dbError()));
    expect500(await call(ctl.acceptTerms, authReq({ body: {} })));
  });

  test("WB-AUTHC-134 getMe: 404; success excludes secrets from the query and adds computed fields; hasPassword comes from a separate existence check", async () => {
    expect((await call(ctl.getMe, authReq())).status).toBe(404);
    const q = query(mkUser({ pendingEmail: "p@x.com", cover: "c", avatar: "a" }));
    User.findById.mockImplementation(() => q);
    User.exists.mockResolvedValue(false);
    const r = await call(ctl.getMe, authReq());
    expect(q.select).toHaveBeenCalledWith("-password -backupCodes -recoveryEmailToken -governmentIdOcr.rawText");
    expect(User.exists).toHaveBeenCalledWith({ _id: "u1", password: { $exists: true, $ne: null } });
    expect(r.body).toMatchObject({ cover: "cover", avatarPreset: "preset", hasPassword: false, ageTier: "adult", hasVerifiedEmail: true, hasPendingEmail: true });
    User.findById.mockImplementation(() => query(mkUser()));
    expect((await call(ctl.getMe, authReq())).body.hasPendingEmail).toBe(false);
    User.findById.mockImplementation(() => failingQuery(dbError()));
    expect500(await call(ctl.getMe, authReq()));
  });

  test.each([
    ["jobseeker", "jobseeker", "p1"], ["employer", "employer", "p2"], ["admin", null, null],
  ])("WB-AUTHC-135 getProfile for %s", async (role, kind, expected) => {
    expect((await call(ctl.getProfile, authReq())).status).toBe(404);
    byId(mkUser({ role }));
    JobseekerProfile.findOne.mockResolvedValue("p1");
    EmployerProfile.findOne.mockResolvedValue("p2");
    const r = await call(ctl.getProfile, authReq());
    expect(r.body.profile).toBe(expected);
    expect(r.body.user).toMatchObject({ hasPassword: true, ageTier: "adult" });
    if (role === "jobseeker") expect(r.body.profileCompleteness).not.toBeNull();
    else expect(r.body.profileCompleteness).toBeNull();
  });

  test("WB-AUTHC-136 getProfile: generic 500", async () => {
    User.findById.mockImplementation(() => failingQuery(dbError()));
    expect500(await call(ctl.getProfile, authReq()));
  });
});

// ---------------------------------------------------------------------------
describe("settings", () => {
  test("WB-AUTHC-137 getSettings: 404, success, generic 500", async () => {
    expect((await call(ctl.getSettings, authReq())).status).toBe(404);
    byId({ notificationPreferences: { a: 1 }, emailNotificationPreferences: { b: 2 }, privacy: { c: 3 } });
    expect((await call(ctl.getSettings, authReq())).body).toEqual({ notificationPreferences: { a: 1 }, emailNotificationPreferences: { b: 2 }, privacy: { c: 3 } });
    User.findById.mockImplementation(() => failingQuery(dbError()));
    expect500(await call(ctl.getSettings, authReq()), "Could not load settings");
  });

  describe("updateSettings", () => {
    const upd = (b, over = {}) => call(ctl.updateSettings, authReq({ body: b, ...over }));
    const saved = (o = {}) => User.findByIdAndUpdate.mockImplementation(() => query({ notificationPreferences: {}, emailNotificationPreferences: {}, privacy: {}, ...o }));
    const setArg = () => User.findByIdAndUpdate.mock.calls[0][1].$set;

    test.each([undefined, {}, { notificationPreferences: "x" }, { notificationPreferences: { notifyMessages: "yes" } }, { privacy: { profileVisibility: "nobody", allowMessagesFrom: "all", showActiveStatus: "true" } }, { emailNotificationPreferences: { unknownKey: true } }])(
      "WB-AUTHC-138 no valid field in %j is a 400 and nothing is written", async (b) => {
        const r = await upd(b);
        expect(r.status).toBe(400);
        expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
      }
    );

    test("WB-AUTHC-139 only whitelisted boolean preference keys are written (prototype/unknown keys ignored)", async () => {
      saved();
      await upd({ notificationPreferences: { notifyMessages: false, notifyJobMatch: true, isAdmin: true, __proto__x: true }, emailNotificationPreferences: { emailAll: false, notifyMessages: true, role: "admin" } });
      expect(setArg()).toEqual({
        "notificationPreferences.notifyMessages": false,
        "notificationPreferences.notifyJobMatch": true,
        "emailNotificationPreferences.notifyMessages": true,
        "emailNotificationPreferences.emailAll": false,
      });
    });

    test.each([["public"], ["employers"], ["hidden"]])("WB-AUTHC-140 profileVisibility %s accepted", async (v) => {
      saved();
      await upd({ privacy: { profileVisibility: v } });
      expect(setArg()).toEqual({ "privacy.profileVisibility": v });
    });

    test("WB-AUTHC-141 allowMessagesFrom anyone/employers accepted; showActiveStatus only a real boolean", async () => {
      saved();
      await upd({ privacy: { allowMessagesFrom: "employers", showActiveStatus: false } });
      expect(setArg()).toEqual({ "privacy.allowMessagesFrom": "employers", "privacy.showActiveStatus": false });
    });

    test("WB-AUTHC-142 changing showActiveStatus tells the active-status service (when present); other changes do not", async () => {
      saved();
      const onVisibilityChanged = jest.fn();
      const app = { get: jest.fn((k) => (k === "activeStatus" ? { onVisibilityChanged } : null)) };
      await upd({ privacy: { showActiveStatus: true } }, { app });
      expect(onVisibilityChanged).toHaveBeenCalledWith("u1");
      onVisibilityChanged.mockClear();
      User.findByIdAndUpdate.mockClear();
      await upd({ privacy: { profileVisibility: "public" } }, { app });
      expect(onVisibilityChanged).not.toHaveBeenCalled();
      expect((await upd({ privacy: { showActiveStatus: true } }, { app: { get: jest.fn(() => null) } })).status).toBe(200);
      expect((await upd({ privacy: { showActiveStatus: true } }, { app: undefined })).status).toBe(200);
    });

    test("WB-AUTHC-143 unknown user 404; DB error generic 500", async () => {
      User.findByIdAndUpdate.mockImplementation(() => query(null));
      expect((await upd({ privacy: { profileVisibility: "public" } })).status).toBe(404);
      User.findByIdAndUpdate.mockImplementation(() => failingQuery(dbError()));
      expect500(await upd({ privacy: { profileVisibility: "public" } }), "Could not save settings");
    });
  });
});

// ---------------------------------------------------------------------------
describe("deactivateAccount", () => {
  const run = (b = { password: "pw" }) => call(ctl.deactivateAccount, authReq({ body: b }));

  test("WB-AUTHC-144 unknown user 404; staff 403; no local password 400; wrong password 400; already deactivated 400", async () => {
    expect((await run()).status).toBe(404);
    for (const role of ["admin", "superadmin"]) {
      byId(mkUser({ role }));
      expect((await run()).status).toBe(403);
    }
    byId(mkUser({ password: undefined }));
    expect((await run()).body.message).toMatch(/Set a password first/);
    byId(mkUser());
    loginLock.checkPasswordWithLock.mockResolvedValue(false);
    expect((await run()).body.message).toBe("Your password is incorrect.");
    loginLock.checkPasswordWithLock.mockResolvedValue(true);
    byId(mkUser({ isActive: false }));
    expect((await run()).body.message).toMatch(/already deactivated/);
  });

  test("WB-AUTHC-145 success: deactivated (not suspended), all sessions force-logged-out, audited", async () => {
    const u = mkUser();
    byId(u);
    const r = await run();
    expect(u).toMatchObject({ isActive: false, accountStatus: "deactivated" });
    expect(u.deactivatedAt).toBeInstanceOf(Date);
    expect(sessionService.forceLogout).toHaveBeenCalledWith("io", "u1", expect.objectContaining({ code: "ACCOUNT_DEACTIVATED" }));
    expect(auditService.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "user.account.self_deactivated" }));
    expect(r.body.message).toMatch(/deactivated/);
  });

  test("WB-AUTHC-146 missing password body is treated as an empty password; DB error generic 500", async () => {
    byId(mkUser());
    await call(ctl.deactivateAccount, authReq({ body: {} }));
    expect(loginLock.checkPasswordWithLock).toHaveBeenCalledWith(expect.anything(), "", expect.anything());
    User.findById.mockImplementation(() => failingQuery(dbError()));
    expect500(await run(), "Could not deactivate the account");
  });
});

// ---------------------------------------------------------------------------
describe("updateAvatar", () => {
  const run = (over = {}) => call(ctl.updateAvatar, authReq({ file: { storedValue: "new.png" }, ...over }));

  test("WB-AUTHC-147 no upload 400; unknown user 404", async () => {
    expect((await call(ctl.updateAvatar, authReq({ file: undefined }))).status).toBe(400);
    expect((await run()).status).toBe(404);
  });

  test("WB-AUTHC-148 success: replaces the photo, clears a preset avatar, removes the old file (not when unchanged or absent)", async () => {
    const u = mkUser({ profileImage: "old.png", avatar: "preset1" });
    byId(u);
    const r = await run();
    expect(u).toMatchObject({ profileImage: "new.png", avatar: undefined });
    expect(storageService.remove).toHaveBeenCalledWith("old.png");
    expect(r.body).toEqual({ message: "Profile picture updated", profileImage: "new.png" });
    storageService.remove.mockClear();
    byId(mkUser({ profileImage: "new.png" }));
    await run();
    byId(mkUser({ profileImage: undefined }));
    await run();
    expect(storageService.remove).not.toHaveBeenCalled();
  });

  test("WB-AUTHC-149 DB error generic 500", async () => {
    User.findById.mockImplementation(() => failingQuery(dbError()));
    expect500(await run());
  });
});

// ---------------------------------------------------------------------------
describe("getDocumentFieldRemovals", () => {
  test.each([
    [{ resumeFile: "" }, { resumeFile: null }],
    [{ resumeFile: "null" }, { resumeFile: null }],
    [{ resumeFile: "UNDEFINED" }, { resumeFile: null }],
    [{ validIdFile: " Remove " }, { validIdFile: null }],
    [{ businessPermit: "clear" }, { businessPermitUrl: null }],
    [{ registrationDoc: null }, { registrationDocUrl: null }],
    [{ resume: "" }, { resumeFile: null }],
    [{ supportingDocument: "remove" }, { validIdFile: null }],
    [{ resumeFile: "keep.pdf" }, {}],
    [{ resumeFile: undefined }, {}],
    [{ somethingElse: "" }, {}],
    [{}, {}],
  ])("WB-AUTHC-150 payload %j gives removals %j", (payload, expected) => {
    expect(ctl.getDocumentFieldRemovals(payload)).toEqual(expected);
  });

  test("WB-AUTHC-151 default argument is tolerated", () => {
    expect(ctl.getDocumentFieldRemovals()).toEqual({});
  });
});
