// The public staff activation endpoints, through the real auth router on both
// the /api and /api/v1 mounts. Mocked models, no database, no real email.

jest.mock("../models/User", () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock("../models/RateLimitCounter", () => ({ findOneAndUpdate: jest.fn() }));
jest.mock("../models/EmailOutbox", () => ({ find: jest.fn(), updateMany: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

process.env.JWT_SECRET = "local-test-secret";
// Per-IP limits are database backed; the per-token limit is read when the router loads.
process.env.DISABLE_RATE_LIMITS = "true";
process.env.STAFF_ACTIVATE_LIMIT_PER_HOUR_TOKEN = "3";
// The username sign-up flag must NOT be needed for the full password rules to apply.
delete process.env.USERNAME_SIGNUP_ENABLED;

const crypto = require("crypto");
const express = require("express");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const EmailOutbox = require("../models/EmailOutbox");
const { logAuditEvent } = require("../services/auditService");
const { query } = require("../testUtils/httpMocks");

const router = require("../routes/authRoutes");
const app = express();
app.use(express.json());
app.use("/api/auth", router);
app.use("/api/v1/auth", router);

const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");
const GOOD = "Tr0ub4dor&Horse9";
const USER_ID = "333333333333333333333333";
let counter = 0;
// A different valid-looking token each time keeps the per-token limiter out of unrelated tests.
const newToken = () => sha(`token-${++counter}`);

const pendingUser = (token, o = {}) => ({
  _id: USER_ID,
  name: "Ann Cruz",
  email: "ann.cruz@peso.gov",
  role: "admin",
  staffInvite: { tokenHash: sha(token), status: "pending", expiresAt: new Date(Date.now() + 3600 * 1000) },
  ...o,
});

const INVALID = { code: "INVITE_INVALID", message: "This activation link is not valid. Ask your superadmin to send a new one." };

let logSpies;
beforeEach(() => {
  jest.resetAllMocks();
  logAuditEvent.mockResolvedValue();
  EmailOutbox.updateMany.mockResolvedValue({});
  User.findOne.mockReturnValue(query(null));
  User.findOneAndUpdate.mockReturnValue(query({ _id: USER_ID, name: "Ann Cruz", role: "admin" }));
  logSpies = ["log", "info", "warn", "error"].map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => logSpies.forEach((s) => s.mockRestore()));

const auditData = () => logAuditEvent.mock.calls.map(([a]) => ({ ...a, req: undefined }));

describe.each(["/api/auth", "/api/v1/auth"])("%s activation", (prefix) => {
  test("a valid link passes the check, which looks up only the hash of the token", async () => {
    const token = newToken();
    User.findOne.mockReturnValue(query(pendingUser(token)));
    const res = await request(app).post(`${prefix}/activate-account/check`).send({ token });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: true });
    const filter = User.findOne.mock.calls[0][0];
    expect(filter["staffInvite.tokenHash"]).toBe(sha(token));
    expect(JSON.stringify(filter)).not.toContain(token);
    expect(filter).toMatchObject({ role: "admin", accountStatus: "pending_activation", deletedAt: null, "staffInvite.status": "pending" });
    expect(filter["staffInvite.expiresAt"].$gt).toBeInstanceOf(Date);
  });

  test("activation sets the password hash, activates the account, ends the token, bumps tokenVersion and does not sign in", async () => {
    const token = newToken();
    User.findOne.mockReturnValue(query(pendingUser(token)));
    const res = await request(app).post(`${prefix}/activate-account`).send({ token, password: GOOD, confirmPassword: GOOD });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "Your account is active. You can now sign in." });
    // No session: no token, no user object, no cookie.
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/token|user|jwt/i);

    const [filter, update] = User.findOneAndUpdate.mock.calls[0];
    expect(filter).toMatchObject({
      _id: USER_ID, role: "admin", accountStatus: "pending_activation", deletedAt: null,
      "staffInvite.status": "pending", "staffInvite.tokenHash": sha(token),
    });
    expect(filter["staffInvite.expiresAt"].$gt).toBeInstanceOf(Date);
    expect(update.$set).toMatchObject({
      isActive: true, accountStatus: "active", mustChangePassword: false, "staffInvite.status": "activated",
    });
    expect(update.$set["staffInvite.activatedAt"]).toBeInstanceOf(Date);
    expect(update.$inc).toEqual({ tokenVersion: 1 });
    expect(update.$unset).toMatchObject({ "staffInvite.tokenHash": "", loginLock: "" });
    expect(update.$set.password).not.toBe(GOOD);
    expect(await bcrypt.compare(GOOD, update.$set.password)).toBe(true);

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "staff.account.activated", actorId: USER_ID, targetUserId: USER_ID, actorRole: "admin" })
    );
    const everything = JSON.stringify([auditData(), logSpies.map((s) => s.mock.calls), res.body]);
    expect(everything).not.toContain(token);
    expect(everything).not.toContain(GOOD);
    expect(EmailOutbox.updateMany).toHaveBeenCalled(); // any stale invite email is dropped
  });

  test("a link works once: when the atomic update finds nothing (already used or replaced) the answer is the same generic one", async () => {
    const token = newToken();
    User.findOne.mockReturnValue(query(pendingUser(token)));
    User.findOneAndUpdate.mockReturnValue(query(null));
    const res = await request(app).post(`${prefix}/activate-account`).send({ token, password: GOOD, confirmPassword: GOOD });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(INVALID);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  test("invalid, malformed, expired, used, replaced and revoked links all get the very same neutral answer", async () => {
    const bodies = [];
    const statuses = [];
    const record = (res) => { bodies.push(JSON.stringify(res.body)); statuses.push(res.status); };

    // Unknown, expired, used, replaced and revoked links all fail the database lookup.
    for (let i = 0; i < 5; i += 1) {
      User.findOne.mockReturnValue(query(null));
      record(await request(app).post(`${prefix}/activate-account`).send({ token: newToken(), password: GOOD, confirmPassword: GOOD }));
    }
    // Malformed tokens never reach the database.
    User.findOne.mockClear();
    for (const token of ["", "short", "x".repeat(64), "A".repeat(64), undefined, { $ne: "x" }, 12345]) {
      record(await request(app).post(`${prefix}/activate-account`).send({ token, password: GOOD, confirmPassword: GOOD }));
    }
    expect(User.findOne).not.toHaveBeenCalled();
    // A record whose stored hash does not match what was asked for is refused too.
    const t = newToken();
    User.findOne.mockReturnValue(query(pendingUser("some-other-token")));
    record(await request(app).post(`${prefix}/activate-account`).send({ token: t, password: GOOD, confirmPassword: GOOD }));

    expect(new Set(statuses)).toEqual(new Set([400]));
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0])).toEqual(INVALID);
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("the check endpoint gives the same neutral answer for a bad link", async () => {
    const res = await request(app).post(`${prefix}/activate-account/check`).send({ token: newToken() });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(INVALID);
  });

  test("the answer never reveals whether an email exists: an email field is ignored", async () => {
    const res = await request(app).post(`${prefix}/activate-account`).send({ email: "ann.cruz@peso.gov", token: newToken(), password: GOOD, confirmPassword: GOOD });
    expect(res.body).toEqual(INVALID);
    expect(JSON.stringify(User.findOne.mock.calls)).not.toContain("ann.cruz");
  });
});

describe("password rules apply in full, whatever the sign-up flag says", () => {
  const attempt = async (password, confirmPassword = password, email = "ann.cruz@peso.gov") => {
    const token = newToken();
    User.findOne.mockReturnValue(query(pendingUser(token, { email })));
    const res = await request(app).post("/api/auth/activate-account").send({ token, password, confirmPassword });
    return res;
  };

  test("a mismatch is refused and nothing is written", async () => {
    const res = await attempt(GOOD, GOOD + "x");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASSWORD_MISMATCH");
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test.each([
    ["too short", "Ab1!xyz", "PASSWORD_WEAK"],
    ["no special character", "Qwvtzmkp8142", "PASSWORD_WEAK"],
    ["no number", "Qwvtzmkpzr!!", "PASSWORD_WEAK"],
    ["no uppercase", "qwvtzmkp81!!", "PASSWORD_WEAK"],
    ["a common password", "Password1!", "PASSWORD_TOO_COMMON"],
    ["contains the email name", "Ann.cruz-2024!Ok", "PASSWORD_SAME_AS_USERNAME"],
  ])("%s is refused", async (_label, password, code) => {
    const res = await attempt(password);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(code);
    expect(typeof res.body.message).toBe("string");
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toContain(password);
  });

  test("a short email name does not block ordinary passwords", async () => {
    const res = await attempt(GOOD, GOOD, "jo@peso.gov");
    expect(res.status).toBe(200);
  });
});

describe("per-token rate limit", () => {
  test("the same link is limited to a few tries an hour (429); another link is not affected", async () => {
    const token = newToken();
    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push((await request(app).post("/api/v1/auth/activate-account").send({ token, password: GOOD, confirmPassword: GOOD })).status);
    }
    expect(statuses).toEqual([400, 400, 400, 429]);
    const other = await request(app).post("/api/v1/auth/activate-account").send({ token: newToken(), password: GOOD, confirmPassword: GOOD });
    expect(other.status).toBe(400);
  });
});
