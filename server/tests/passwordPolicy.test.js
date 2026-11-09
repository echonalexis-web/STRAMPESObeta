// Shared password policy: the pure rules, and where each flow applies them.
// Mocked models, no database, no real mail.

jest.mock("../models/User", () => ({
  findById: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock("../models/ReservedUsername", () => ({ findOne: jest.fn() }));
jest.mock("../models/JobseekerProfile", () => ({ create: jest.fn() }));
jest.mock("../models/EmployerProfile", () => ({ create: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/notificationService", () => ({ notifyManyUsers: jest.fn().mockResolvedValue([]) }));
jest.mock("../services/accountAlertService", () => ({
  notifyAccountLocked: jest.fn().mockResolvedValue(undefined),
  notifyFailedAttempts: jest.fn().mockResolvedValue(undefined),
  notifyPasswordChanged: jest.fn().mockResolvedValue(undefined),
  checkNewDevice: jest.fn().mockResolvedValue(false),
}));
jest.mock("../services/mailService", () => ({
  isEmailConfigured: jest.fn().mockReturnValue(false),
  renderEmail: jest.fn(),
  sendMail: jest.fn().mockResolvedValue({}),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({}),
  sendPasswordChangedEmail: jest.fn().mockResolvedValue({}),
  sendPasswordAddedEmail: jest.fn().mockResolvedValue({}),
  sendEmailVerification: jest.fn().mockResolvedValue({}),
  sendEmailChangeVerification: jest.fn().mockResolvedValue({}),
  sendEmailChangeAlert: jest.fn().mockResolvedValue({}),
  sendRecoveryEmailVerification: jest.fn().mockResolvedValue({}),
  sendRecoveryEmailAlert: jest.fn().mockResolvedValue({}),
  sendBackupCodesGeneratedEmail: jest.fn().mockResolvedValue({}),
  sendBackupCodeRedeemedEmail: jest.fn().mockResolvedValue({}),
}));
jest.mock("../utils/logger", () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.GOOGLE_CLIENT_ID = "test.apps.googleusercontent.com";

const express = require("express");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const policy = require("../utils/passwordPolicy");
const authController = require("../controllers/authController");
const { validateUserRegistration, validatePasswordChange } = require("../middleware/validation");

const GOOD = "Tr0ub4dor&Horse"; // 15 chars, all classes, not common

beforeEach(() => {
  jest.clearAllMocks();
  process.env.USERNAME_SIGNUP_ENABLED = "true";
});
afterAll(() => {
  delete process.env.USERNAME_SIGNUP_ENABLED;
});

describe("validatePassword (pure rules)", () => {
  const v = (password, extra = {}) => policy.validatePassword({ password, ...extra });

  test("accepts a strong password", () => {
    expect(v(GOOD)).toEqual({ ok: true });
  });

  test("composition: 8+ chars, upper, lower, digit, special", () => {
    expect(v("Ab1!").code).toBe("PASSWORD_WEAK"); // too short
    expect(v("kpwlmntr1!").code).toBe("PASSWORD_WEAK"); // no upper
    expect(v("KPWLMNTR1!").code).toBe("PASSWORD_WEAK"); // no lower
    expect(v("Kpwlmntr!!").code).toBe("PASSWORD_WEAK"); // no digit
    expect(v("Kpwlmntr12").code).toBe("PASSWORD_WEAK"); // no special
    expect(v("x".repeat(129) + "A1!").code).toBe("PASSWORD_WEAK"); // over the cap
  });

  test("one special-character set: every char register accepted is accepted, including the old change-password set", () => {
    for (const ch of policy.SPECIAL_CHARS) {
      expect(v(`Zq7${ch}mNvKwpL`)).toEqual({ ok: true });
    }
    for (const ch of "@$!%*?&") expect(v(`Zq7${ch}mNvKwpL`)).toEqual({ ok: true });
  });

  test("10-character minimum only for username-only accounts", () => {
    expect(v("Zq7!mNvKw", { usernameOnly: true }).code).toBe("PASSWORD_TOO_SHORT_USERNAME_MODE"); // 9
    expect(v("Zq7!mNvKwp", { usernameOnly: true })).toEqual({ ok: true }); // 10
    expect(v("Zq7!mNvKw", { usernameOnly: false })).toEqual({ ok: true }); // 9 is fine with an email
  });

  test("common passwords are refused, including with the usual composition tricks", () => {
    for (const p of ["Password1!", "Qwerty123!", "Iloveyou1!", "Welcome123!", "Admin123!", "Jollibee1!", "P@ssw0rd"]) {
      expect(v(p).code).toBe("PASSWORD_TOO_COMMON");
    }
  });

  test("not equal to, and not containing, the username (case-insensitive)", () => {
    expect(v("Juan_dc1!Xy", { username: "juan_dc" }).code).toBe("PASSWORD_SAME_AS_USERNAME");
    expect(v("JUAN_DC_99", { username: "juan_dc" }).code).toBe("PASSWORD_SAME_AS_USERNAME");
    expect(v("Zq7!mNvKwpL", { username: "juan_dc" })).toEqual({ ok: true });
    expect(v("Zq7!mNvKwpL", { username: "" })).toEqual({ ok: true });
  });

  test.each([
    ["20000115"], // YYYYMMDD
    ["15012000"], // DDMMYYYY
    ["01152000"], // MMDDYYYY
    ["2000-01-15"],
    ["15-01-2000"],
    ["01-15-2000"],
  ])("not equal to the date of birth: %s", (dob) => {
    expect(v(dob, { dateOfBirth: "2000-01-15" }).code).toBe("PASSWORD_SAME_AS_BIRTHDATE");
  });

  test("not containing the date of birth digits, and works with a Date value", () => {
    expect(v("Juan15012000!", { dateOfBirth: new Date(Date.UTC(2000, 0, 15)) }).code).toBe("PASSWORD_SAME_AS_BIRTHDATE");
    expect(v(GOOD, { dateOfBirth: new Date(Date.UTC(2000, 0, 15)) })).toEqual({ ok: true });
    expect(v(GOOD, { dateOfBirth: "garbage" })).toEqual({ ok: true });
  });

  test("never echoes the password", () => {
    const verdict = v("Password1!");
    expect(JSON.stringify(verdict)).not.toContain("Password1!");
  });
});

describe("enforce is inert while the flag is off", () => {
  test("flag off: everything is ok (existing per-flow checks stay as they were)", () => {
    process.env.USERNAME_SIGNUP_ENABLED = "false";
    expect(policy.enforce({ password: "Password1!" })).toEqual({ ok: true });
    expect(policy.enforce({ password: "x" })).toEqual({ ok: true });
  });
  test("flag on: enforced", () => {
    expect(policy.enforce({ password: "Password1!" }).ok).toBe(false);
  });
});

describe("register validator", () => {
  const app = () => {
    const a = express();
    a.use(express.json());
    a.post("/register", validateUserRegistration, (req, res) => res.status(201).json({ ok: true }));
    return a;
  };
  const base = { name: "Juan Dela Cruz", email: "juan@example.com", dateOfBirth: "2000-01-15" };

  test("email mode: a common password is refused with a code", async () => {
    const res = await request(app()).post("/register").send({ ...base, password: "Password1!" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASSWORD_TOO_COMMON");
  });

  test("username mode: needs 10 characters and cannot contain the username or birth date", async () => {
    const send = (password, username = "juan_dc") =>
      request(app()).post("/register").send({ name: base.name, dateOfBirth: base.dateOfBirth, signupMode: "username", username, password });
    expect((await send("Zq7!mNvKw")).body.code).toBe("PASSWORD_TOO_SHORT_USERNAME_MODE");
    expect((await send("Juan_dc9!Zq")).body.code).toBe("PASSWORD_SAME_AS_USERNAME");
    expect((await send("Zq15012000!")).body.code).toBe("PASSWORD_SAME_AS_BIRTHDATE");
    expect((await send("Zq7!mNvKwp")).status).toBe(201);
  });

  test("flag off: nothing new is enforced at register", async () => {
    process.env.USERNAME_SIGNUP_ENABLED = "false";
    const res = await request(app()).post("/register").send({ ...base, password: "Password1!" });
    expect(res.status).toBe(201);
  });
});

describe("change-password validator uses the same special-character set", () => {
  const run = (newPassword) =>
    new Promise((resolve) => {
      const res = { status: () => res, json: (body) => resolve({ blocked: true, body }) };
      validatePasswordChange({ body: { currentPassword: "x", newPassword, confirmPassword: newPassword } }, res, () => resolve({ blocked: false }));
    });

  test("a password with '#' (valid at register) is no longer rejected on change", async () => {
    expect((await run("Zq7#mNvKwpL")).blocked).toBe(false);
  });
  test("still requires a special character", async () => {
    expect((await run("Zq7amNvKwpL")).blocked).toBe(true);
  });
});

describe("each flow applies the policy (flag on)", () => {
  const hashPromise = bcrypt.hash("Current#Pass1", 4);
  const userDoc = async (overrides = {}) => ({
    _id: "507f1f77bcf86cd799439011",
    name: "Juan",
    role: "jobseeker",
    username: "juan_dc",
    email: "juan@example.com",
    dateOfBirth: new Date(Date.UTC(2000, 0, 15)),
    password: await hashPromise,
    tokenVersion: 0,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });
  const app = (user) => {
    const a = express();
    a.use(express.json());
    a.use((req, res, next) => {
      req.user = { id: "507f1f77bcf86cd799439011", role: "jobseeker" };
      next();
    });
    a.post("/change", authController.changePassword);
    a.post("/reset", authController.resetPassword);
    a.post("/set", authController.setPassword);
    a.post("/recover", authController.recoverSetPassword);
    return a;
  };

  test("changePassword: weak new password -> 400 with a code, nothing saved", async () => {
    const user = await userDoc();
    User.findById.mockResolvedValue(user);
    const res = await request(app()).post("/change").send({ currentPassword: "Current#Pass1", newPassword: "Password1!" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASSWORD_TOO_COMMON");
    expect(user.save).not.toHaveBeenCalled();
  });

  test("changePassword: a strong one goes through and raises the in-app alert", async () => {
    const user = await userDoc();
    User.findById.mockResolvedValue(user);
    const res = await request(app()).post("/change").send({ currentPassword: "Current#Pass1", newPassword: GOOD });
    expect(res.status).toBe(200);
    expect(user.save).toHaveBeenCalled();
    expect(require("../services/accountAlertService").notifyPasswordChanged).toHaveBeenCalled();
  });

  test("changePassword: a username-only account needs 10 characters", async () => {
    const user = await userDoc({ email: undefined });
    User.findById.mockResolvedValue(user);
    const res = await request(app()).post("/change").send({ currentPassword: "Current#Pass1", newPassword: "Zq7!mNvKw" });
    expect(res.body.code).toBe("PASSWORD_TOO_SHORT_USERNAME_MODE");
  });

  test("changePassword: wrong current password counts toward the lockout", async () => {
    User.findById.mockResolvedValue(await userDoc());
    User.findOneAndUpdate.mockResolvedValue({ loginLock: { failures: 1, level: 0 } });
    const res = await request(app()).post("/change").send({ currentPassword: "wrong", newPassword: GOOD });
    expect(res.status).toBe(400);
    expect(User.findOneAndUpdate.mock.calls[0][1].$inc).toEqual({ "loginLock.failures": 1 });
  });

  test("changePassword: flag off, a wrong current password writes no lockout state", async () => {
    process.env.USERNAME_SIGNUP_ENABLED = "false";
    User.findById.mockResolvedValue(await userDoc());
    const res = await request(app()).post("/change").send({ currentPassword: "wrong", newPassword: GOOD });
    expect(res.status).toBe(400);
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("resetPassword: weak password refused before the hash is written", async () => {
    const user = await userDoc({ passwordResetToken: "x", passwordResetExpires: new Date(Date.now() + 60000) });
    User.findOne.mockResolvedValue(user);
    const res = await request(app()).post("/reset").send({ token: "t", email: "juan@example.com", password: "Juan_dc1!Xy" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASSWORD_SAME_AS_USERNAME");
    expect(user.save).not.toHaveBeenCalled();
  });

  test("resetPassword: strong password works and unlocks", async () => {
    const user = await userDoc({ passwordResetToken: "x", passwordResetExpires: new Date(Date.now() + 60000), loginLock: { failures: 2 } });
    User.findOne.mockResolvedValue(user);
    const res = await request(app()).post("/reset").send({ token: "t", email: "juan@example.com", password: GOOD });
    expect(res.status).toBe(200);
    expect(user.loginLock).toBeUndefined();
    expect(user.save).toHaveBeenCalled();
  });

  test("setPassword: weak password refused before any Google call", async () => {
    const user = await userDoc({ password: undefined, googleId: "g1" });
    User.findById.mockResolvedValue(user);
    const res = await request(app()).post("/set").send({ credential: "cred", newPassword: "Password1!" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASSWORD_TOO_COMMON");
  });

  test("recoverSetPassword: weak refused, strong accepted and unlocks", async () => {
    const weak = await userDoc();
    User.findById.mockResolvedValue(weak);
    const bad = await request(app()).post("/recover").send({ newPassword: "Password1!" });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("PASSWORD_TOO_COMMON");
    expect(weak.save).not.toHaveBeenCalled();

    const ok = await userDoc({ loginLock: { failures: 3 } });
    User.findById.mockResolvedValue(ok);
    const good = await request(app()).post("/recover").send({ newPassword: GOOD });
    expect(good.status).toBe(200);
    expect(ok.loginLock).toBeUndefined();
  });
});
