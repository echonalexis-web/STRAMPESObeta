// Group C hardening: signed form token + honeypot, forgot-username, in-app
// alerts, limiter changes, admin summary and unlock, forgot-password by
// username. Mocked models, no database, no real mail.

jest.mock("../models/User", () => ({
  findById: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
  countDocuments: jest.fn(),
}));
jest.mock("../models/RateLimitCounter", () => ({ findOneAndUpdate: jest.fn() }));
jest.mock("../models/AuditLog", () => ({ countDocuments: jest.fn() }));
jest.mock("../models/ReservedUsername", () => ({ findOne: jest.fn() }));
jest.mock("../models/JobseekerProfile", () => ({ create: jest.fn() }));
jest.mock("../models/EmployerProfile", () => ({ create: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/notificationService", () => ({
  notifyManyUsers: jest.fn().mockResolvedValue([]),
  createNotificationForUser: jest.fn().mockResolvedValue({}),
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
  sendUsernameReminder: jest.fn().mockResolvedValue({}),
}));
jest.mock("../utils/logger", () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const PEPPER = "p".repeat(40);
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.EMAIL_CODE_PEPPER = PEPPER;
process.env.DISABLE_RATE_LIMITS = "true"; // dbLimiter becomes a no-op; the limiter itself is covered elsewhere

const express = require("express");
const request = require("supertest");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const RateLimitCounter = require("../models/RateLimitCounter");
const { logAuditEvent } = require("../services/auditService");
const { createNotificationForUser } = require("../services/notificationService");
const mail = require("../services/mailService");
const signupToken = require("../utils/signupToken");
const { signupGuard } = require("../middleware/signupGuard");
const { sensitiveOperationLimiter } = require("../middleware/security");
const alerts = require("../services/accountAlertService");
const { forgotUsername, NEUTRAL } = require("../controllers/forgotUsernameController");
const authController = require("../controllers/authController");
const adminSecurity = require("../controllers/accountSecurityAdminController");

beforeEach(() => {
  jest.clearAllMocks();
  process.env.USERNAME_SIGNUP_ENABLED = "true";
  RateLimitCounter.findOneAndUpdate.mockResolvedValue({ count: 1 });
});
afterAll(() => {
  delete process.env.USERNAME_SIGNUP_ENABLED;
  delete process.env.DISABLE_RATE_LIMITS;
});

describe("signup form token", () => {
  const t0 = 1_800_000_000_000;

  test("valid after 3 seconds, before 1 hour", () => {
    const token = signupToken.issueToken(t0);
    expect(signupToken.verifyToken(token, t0 + 3000)).toEqual({ ok: true });
    expect(signupToken.verifyToken(token, t0 + 60 * 60 * 1000)).toEqual({ ok: true });
  });

  test("too fast, expired, missing, malformed, forged, tampered", () => {
    const token = signupToken.issueToken(t0);
    expect(signupToken.verifyToken(token, t0 + 2999).reason).toBe("too_fast");
    expect(signupToken.verifyToken(token, t0 + 60 * 60 * 1000 + 1).reason).toBe("expired");
    expect(signupToken.verifyToken(undefined, t0).reason).toBe("missing");
    expect(signupToken.verifyToken("garbage", t0).reason).toBe("invalid");
    expect(signupToken.verifyToken(`${t0}.${"0".repeat(64)}`, t0 + 5000).reason).toBe("invalid");
    // Back-dating the timestamp to beat the minimum age breaks the signature.
    const [, sig] = token.split(".");
    expect(signupToken.verifyToken(`${t0 - 10_000}.${sig}`, t0 + 5000).reason).toBe("invalid");
    // A token from the future is invalid, not "too fast".
    expect(signupToken.verifyToken(signupToken.issueToken(t0 + 99_999), t0).reason).toBe("invalid");
  });

  test("a different pepper does not validate (key is derived from the pepper)", () => {
    const token = signupToken.issueToken(t0);
    process.env.EMAIL_CODE_PEPPER = "q".repeat(40);
    expect(signupToken.verifyToken(token, t0 + 5000).ok).toBe(false);
    process.env.EMAIL_CODE_PEPPER = PEPPER;
  });
});

describe("signup guard (honeypot + token)", () => {
  const app = () => {
    const a = express();
    a.use(express.json());
    a.post("/register", signupGuard, (req, res) => res.status(201).json({ ok: true }));
    return a;
  };
  const aged = () => signupToken.issueToken(Date.now() - 5000);
  const body = (extra = {}) => ({ signupMode: "username", username: "juan_dc", password: "x", dateOfBirth: "2000-01-15", ...extra });
  const REJECT = { code: "SIGNUP_REJECTED", message: expect.any(String) };

  test("a normal submit passes", async () => {
    const res = await request(app()).post("/register").send(body({ formToken: aged(), website: "" }));
    expect(res.status).toBe(201);
  });

  test.each([
    ["filled honeypot", () => body({ formToken: aged(), website: "http://spam.example" }), "honeypot"],
    ["missing token", () => body({ website: "" }), "missing"],
    ["forged token", () => body({ formToken: `${Date.now() - 9000}.${"a".repeat(64)}` }), "invalid"],
    ["submitted too fast", () => body({ formToken: signupToken.issueToken(Date.now()) }), "too_fast"],
    ["expired token", () => body({ formToken: signupToken.issueToken(Date.now() - 2 * 3600 * 1000) }), "expired"],
  ])("%s -> the same generic 400", async (_, make, reason) => {
    const res = await request(app()).post("/register").send(make());
    expect(res.status).toBe(400);
    expect(res.body).toEqual(REJECT);
    const event = logAuditEvent.mock.calls[0][0];
    expect(event.action).toBe("auth.signup.rejected");
    expect(event.metadata).toEqual({ reason });
  });

  test("the audit event carries no personal data", async () => {
    await request(app()).post("/register").send(body({ website: "x", name: "Juan Dela Cruz" }));
    const text = JSON.stringify({ ...logAuditEvent.mock.calls[0][0], req: undefined });
    expect(text).not.toMatch(/juan|2000-01-15|"x"|password/i);
  });

  test("every rejection looks identical to the client", async () => {
    const a = await request(app()).post("/register").send(body({ website: "x" }));
    const b = await request(app()).post("/register").send(body());
    expect(a.text).toBe(b.text);
  });

  test("email-mode sign-up is not touched, and neither is flag-off", async () => {
    const emailMode = await request(app()).post("/register").send({ email: "a@b.co", password: "x" });
    expect(emailMode.status).toBe(201);
    process.env.USERNAME_SIGNUP_ENABLED = "false";
    const off = await request(app()).post("/register").send(body());
    expect(off.status).toBe(201); // the route-level flag check answers first in the real chain
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe("real routes: flag off", () => {
  const authRoutes = require("../routes/authRoutes");
  const app = () => {
    const a = express();
    a.use(express.json());
    a.use("/api/auth", authRoutes);
    a.use("/api/v1/auth", authRoutes);
    return a;
  };

  test.each([["/api/auth"], ["/api/v1/auth"]])("%s: signup-token and forgot-username are 404 while off, live while on", async (base) => {
    process.env.USERNAME_SIGNUP_ENABLED = "false";
    expect((await request(app()).get(`${base}/signup-token`)).status).toBe(404);
    expect((await request(app()).post(`${base}/forgot-username`).send({ email: "a@b.co" })).status).toBe(404);
    expect(User.findOne).not.toHaveBeenCalled();

    process.env.USERNAME_SIGNUP_ENABLED = "true";
    const token = await request(app()).get(`${base}/signup-token`);
    expect(token.status).toBe(200);
    expect(token.headers["cache-control"]).toMatch(/no-store/);
    expect(signupToken.verifyToken(token.body.formToken, Date.now() + 5000).ok).toBe(true);
  });

  test("register with a username-mode body and no token is rejected generically", async () => {
    const res = await request(app())
      .post("/api/auth/register")
      .send({ signupMode: "username", username: "juan_dc", password: "Zq7!mNvKwpL", name: "Juan", dateOfBirth: "2000-01-15" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SIGNUP_REJECTED");
  });
});

describe("forgot username", () => {
  const app = () => {
    const a = express();
    a.use(express.json());
    a.post("/forgot-username", forgotUsername);
    return a;
  };
  const found = (doc) => User.findOne.mockReturnValue({ collation: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(doc) }) });
  const send = (email = "juan@example.com") => request(app()).post("/forgot-username").send({ email });

  test("verified email: mails the username to that address only, never returns it", async () => {
    found({ name: "Juan", username: "juan_dc", email: "juan@example.com", isEmailVerified: true });
    const res = await send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual(NEUTRAL);
    expect(JSON.stringify(res.body)).not.toContain("juan_dc");
    expect(mail.sendUsernameReminder).toHaveBeenCalledWith({ to: "juan@example.com", name: "Juan", username: "juan_dc" });
  });

  test("unknown address: identical response, nothing sent", async () => {
    found(null);
    const known = await (async () => {
      found({ name: "Juan", username: "juan_dc", email: "juan@example.com" });
      return send();
    })();
    found(null);
    const unknown = await send("ghost@example.com");
    expect(unknown.status).toBe(known.status);
    expect(unknown.text).toBe(known.text);
    expect(mail.sendUsernameReminder).toHaveBeenCalledTimes(1); // only for the known one
  });

  test("an unverified email gets nothing; an account with no username gets nothing", async () => {
    found({ name: "J", username: "juan_dc", email: "juan@example.com", isEmailVerified: false });
    await send();
    found({ name: "J", email: "juan@example.com" });
    await send();
    expect(mail.sendUsernameReminder).not.toHaveBeenCalled();
  });

  test("garbage input gets the same neutral answer and touches nothing", async () => {
    const res = await send("not-an-email");
    expect(res.body).toEqual(NEUTRAL);
    expect(User.findOne).not.toHaveBeenCalled();
  });

  test("3 per address per day: the 4th is silently not sent, response unchanged", async () => {
    RateLimitCounter.findOneAndUpdate.mockResolvedValue({ count: 4 });
    found({ name: "J", username: "juan_dc", email: "juan@example.com" });
    const res = await send();
    expect(res.body).toEqual(NEUTRAL);
    expect(mail.sendUsernameReminder).not.toHaveBeenCalled();
  });

  test("the counter key is a hash, and the audit event has the domain only", async () => {
    found({ name: "J", username: "juan_dc", email: "juan@example.com" });
    await send();
    expect(RateLimitCounter.findOneAndUpdate.mock.calls[0][0]._id).not.toMatch(/juan|example/);
    const text = JSON.stringify({ ...logAuditEvent.mock.calls[0][0], req: undefined });
    expect(text).toContain("auth.username.forgot_requested");
    expect(text).toContain("example.com");
    expect(text).not.toContain("juan@example.com");
    expect(text).not.toContain("juan_dc");
  });
});

describe("forgot password by username", () => {
  const app = () => {
    const a = express();
    a.use(express.json());
    a.post("/forgot", authController.forgotPassword);
    return a;
  };
  const GENERIC = { message: "If that email is registered, a password reset link has been sent." };
  const byUsername = (doc) => User.findOne.mockReturnValue({ collation: jest.fn().mockResolvedValue(doc) });
  const account = (extra = {}) => ({
    _id: "u1",
    name: "Juan",
    email: "juan@example.com",
    isEmailVerified: true,
    save: jest.fn().mockResolvedValue(undefined),
    ...extra,
  });

  test("username with a verified email: the link goes to that email", async () => {
    byUsername(account());
    const res = await request(app()).post("/forgot").send({ identifier: "juan_dc" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(GENERIC);
    expect(mail.sendPasswordResetEmail.mock.calls[0][0].to).toBe("juan@example.com");
  });

  test("username with no email, or an unknown username: the same neutral answer, nothing sent", async () => {
    byUsername(account({ email: undefined }));
    const noEmail = await request(app()).post("/forgot").send({ identifier: "juan_dc" });
    byUsername(null);
    const unknown = await request(app()).post("/forgot").send({ identifier: "ghost" });
    expect(noEmail.text).toBe(JSON.stringify(GENERIC));
    expect(unknown.text).toBe(noEmail.text);
    expect(mail.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  test("flag off: a username identifier is ignored, email path unchanged", async () => {
    process.env.USERNAME_SIGNUP_ENABLED = "false";
    const res = await request(app()).post("/forgot").send({ identifier: "juan_dc" });
    expect(res.status).toBe(400); // no email supplied: same as before
    User.findOne.mockResolvedValue(account());
    const ok = await request(app()).post("/forgot").send({ email: "Juan@Example.com" });
    expect(ok.body).toEqual(GENERIC);
    expect(User.findOne).toHaveBeenCalledWith({ email: "juan@example.com" });
  });
});

describe("in-app alerts", () => {
  test("device label is browser family + OS only; the hash has no IP and no version", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    expect(alerts.deviceLabel(ua)).toBe("chrome|windows");
    expect(alerts.deviceLabel(ua.replace("126.0.0.0", "130.1.2.3"))).toBe("chrome|windows");
    expect(alerts.deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1")).toBe("safari|ios");
    expect(alerts.deviceLabel(undefined)).toBe("other|other");
    expect(alerts.deviceHash(ua)).toMatch(/^[0-9a-f]{32}$/);
  });

  test("first sign-in only records the device; no alert", async () => {
    User.findOneAndUpdate.mockResolvedValueOnce({ knownDevices: undefined });
    expect(await alerts.checkNewDevice("u1", "Chrome Windows")).toBe(false);
    expect(createNotificationForUser).not.toHaveBeenCalled();
  });

  test("a new device after earlier ones raises a system notification", async () => {
    User.findOneAndUpdate.mockResolvedValueOnce({ knownDevices: ["abc"] });
    expect(await alerts.checkNewDevice("u1", "Firefox/1 Linux")).toBe(true);
    const arg = createNotificationForUser.mock.calls[0][0];
    expect(arg.type).toBe("system");
    expect(arg.recipientId).toBe("u1");
    expect(arg.metadata).toEqual({ alertKey: "newSignIn" });
  });

  test("a known device: no write result, no alert", async () => {
    User.findOneAndUpdate.mockResolvedValueOnce(null);
    expect(await alerts.checkNewDevice("u1", "Chrome Windows")).toBe(false);
    expect(createNotificationForUser).not.toHaveBeenCalled();
  });

  test("devices are capped at 10 and stored as hashes only", async () => {
    User.findOneAndUpdate.mockResolvedValueOnce(null);
    await alerts.checkNewDevice("u1", "Chrome/1 Windows NT");
    const [filter, update] = User.findOneAndUpdate.mock.calls[0];
    expect(update.$push.knownDevices.$slice).toBe(-10);
    expect(update.$push.knownDevices.$each[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify([filter, update])).not.toMatch(/Windows|Chrome/);
  });

  test("alerts never throw, even when notifications fail", async () => {
    createNotificationForUser.mockRejectedValueOnce(new Error("db down"));
    await expect(alerts.notifyAccountLocked("u1")).resolves.toBeUndefined();
    User.findOneAndUpdate.mockRejectedValueOnce(new Error("db down"));
    await expect(alerts.checkNewDevice("u1", "x")).resolves.toBe(false);
  });

  test("each alert is a system notification with a translatable key", async () => {
    await alerts.notifyEmailAdded("u1");
    await alerts.notifyPasswordChanged("u1");
    await alerts.notifyFailedAttempts("u1");
    await alerts.notifyAccountLocked("u1");
    const keys = createNotificationForUser.mock.calls.map(([a]) => a.metadata.alertKey);
    expect(keys).toEqual(["emailAdded", "passwordChanged", "failedAttempts", "accountLocked"]);
    for (const [a] of createNotificationForUser.mock.calls) expect(a.type).toBe("system");
  });
});

describe("limiters", () => {
  const run = async (limiter, reqs) => {
    const results = [];
    for (const req of reqs) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
      const next = jest.fn();
      limiter(req, res, next);
      results.push({ blocked: res.status.mock.calls.length > 0, passed: next.mock.calls.length > 0 });
    }
    return results;
  };

  test("keyFn: limits per identifier+IP, so another identifier from the same IP starts fresh", async () => {
    const limiter = sensitiveOperationLimiter(2, 60_000, { keyFn: (r) => `${r.ip}|${r.body.identifier}` });
    const r = (identifier) => ({ ip: "1.1.1.1", body: { identifier } });
    const out = await run(limiter, [r("a"), r("a"), r("a"), r("b")]);
    expect(out.map((o) => o.blocked)).toEqual([false, false, true, false]);
  });

  test("default key is still the IP", async () => {
    const limiter = sensitiveOperationLimiter(1, 60_000);
    const out = await run(limiter, [{ ip: "1.1.1.1" }, { ip: "1.1.1.1" }, { ip: "2.2.2.2" }]);
    expect(out.map((o) => o.blocked)).toEqual([false, true, false]);
  });

  test("idle keys are pruned once the window passes (the map cannot grow forever)", async () => {
    jest.useFakeTimers();
    try {
      const limiter = sensitiveOperationLimiter(5, 1000);
      await run(limiter, [{ ip: "a" }, { ip: "b" }, { ip: "c" }]);
      jest.setSystemTime(Date.now() + 5000);
      // After the window, every old key is idle. A new request triggers the sweep
      // and the old IPs start from zero (they are not blocked by stale state).
      const out = await run(limiter, [{ ip: "new" }, { ip: "a" }]);
      expect(out.every((o) => o.passed)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test("username-available limit is configurable with a default of 60 per minute", () => {
    const { positiveIntEnv } = require("../middleware/dbLimiter");
    delete process.env.USERNAME_CHECK_LIMIT_PER_MIN;
    expect(positiveIntEnv("USERNAME_CHECK_LIMIT_PER_MIN", 60)).toBe(60);
    process.env.USERNAME_CHECK_LIMIT_PER_MIN = "120";
    expect(positiveIntEnv("USERNAME_CHECK_LIMIT_PER_MIN", 60)).toBe(120);
    process.env.USERNAME_CHECK_LIMIT_PER_MIN = "-5";
    expect(positiveIntEnv("USERNAME_CHECK_LIMIT_PER_MIN", 60)).toBe(60);
    delete process.env.USERNAME_CHECK_LIMIT_PER_MIN;
  });
});

describe("admin: security summary and unlock", () => {
  const app = () => {
    const a = express();
    a.use(express.json());
    a.use((req, res, next) => {
      req.user = { id: "admin1", role: "admin" };
      next();
    });
    a.get("/summary", adminSecurity.getSecuritySummary);
    a.put("/users/:id/unlock-login", adminSecurity.unlockLogin);
    return a;
  };

  test("summary returns counts only", async () => {
    User.countDocuments.mockResolvedValueOnce(12).mockResolvedValueOnce(4).mockResolvedValueOnce(2);
    AuditLog.countDocuments.mockResolvedValueOnce(3).mockResolvedValueOnce(9);
    const res = await request(app()).get("/summary");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      emailLessCount: 12,
      idleEmailLessCount: 4,
      idleDays: 90,
      locksLast24h: 3,
      locksLast7d: 9,
      lockedNow: 2,
    });
    // Email-less = jobseekers with no email field.
    expect(User.countDocuments.mock.calls[0][0]).toMatchObject({ email: { $exists: false } });
    expect(AuditLog.countDocuments.mock.calls[0][0].action).toBe("auth.account.locked");
  });

  test("unlock needs a reason", async () => {
    const res = await request(app()).put("/users/507f1f77bcf86cd799439011/unlock-login").send({ reason: "no" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("REASON_REQUIRED");
    expect(User.updateOne).not.toHaveBeenCalled();
  });

  test("unlock clears the lock and writes an audit event with the actor and reason", async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: "t1", role: "jobseeker" }) });
    User.updateOne.mockResolvedValue({ modifiedCount: 1 });
    const res = await request(app()).put("/users/507f1f77bcf86cd799439011/unlock-login").send({ reason: "Verified in person" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unlocked: true });
    expect(User.updateOne.mock.calls[0][1]).toEqual({ $unset: { loginLock: 1 } });
    const event = logAuditEvent.mock.calls[0][0];
    expect(event).toMatchObject({ action: "auth.account.unlocked", actorId: "admin1", targetUserId: "t1" });
    expect(event.metadata.reason).toBe("Verified in person");
  });

  test("only jobseeker accounts can be unlocked this way", async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: "t1", role: "admin" }) });
    const res = await request(app()).put("/users/507f1f77bcf86cd799439011/unlock-login").send({ reason: "Verified in person" });
    expect(res.status).toBe(404);
    expect(User.updateOne).not.toHaveBeenCalled();
  });

  test("the admin routes sit behind the admin router guard", () => {
    const adminRoutes = require("../routes/adminRoutes");
    const paths = adminRoutes.stack.filter((l) => l.route).map((l) => l.route.path);
    expect(paths).toEqual(expect.arrayContaining(["/accounts/security-summary", "/users/:id/unlock-login"]));
    // router.use(protect, isAdmin) is the first layer, before any route.
    const firstRouteIndex = adminRoutes.stack.findIndex((l) => l.route);
    expect(adminRoutes.stack.slice(0, firstRouteIndex).length).toBeGreaterThanOrEqual(2);
  });
});
