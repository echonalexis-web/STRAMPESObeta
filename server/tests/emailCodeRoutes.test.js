// Add-email by six-digit code: request and verify. Mocked models, mocked mail,
// no database, no real accounts.

jest.mock("../models/User", () => ({
  findById: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock("../models/RateLimitCounter", () => ({ findOneAndUpdate: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/mailService", () => ({ sendEmailCode: jest.fn().mockResolvedValue({}) }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const PEPPER = "p".repeat(40);
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.EMAIL_CODE_PEPPER = PEPPER;

const express = require("express");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const RateLimitCounter = require("../models/RateLimitCounter");
const { logAuditEvent } = require("../services/auditService");
const { sendEmailCode } = require("../services/mailService");
const emailCode = require("../utils/emailCode");
const { requestAddEmail, verifyAddEmail } = require("../controllers/emailCodeController");

const USER_ID = "507f1f77bcf86cd799439011";
const TARGET = "juan@example.com";
const GOOD_PASSWORD = "Sup3rSecret!";

let passwordHash;
beforeAll(async () => {
  passwordHash = await bcrypt.hash(GOOD_PASSWORD, 4);
});

const app = () => {
  const a = express();
  a.use(express.json());
  a.use((req, res, next) => {
    req.user = { id: USER_ID, role: "jobseeker" };
    next();
  });
  a.post("/request", requestAddEmail);
  a.post("/verify", verifyAddEmail);
  return a;
};

const selectable = (value) => ({ select: jest.fn().mockResolvedValue(value) });
const baseUser = (overrides = {}) => ({
  _id: USER_ID,
  name: "Juan",
  role: "jobseeker",
  username: "juan_dc",
  password: passwordHash,
  tokenVersion: 3,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  User.findById.mockReturnValue(selectable(baseUser()));
  User.findOneAndUpdate.mockResolvedValue({ _id: USER_ID }); // the send claim by default
  User.updateOne.mockResolvedValue({});
  User.findOne.mockReturnValue({ collation: jest.fn().mockReturnValue(selectable(null)) });
  RateLimitCounter.findOneAndUpdate.mockResolvedValue({ count: 1 });
});

const lastClaim = () => User.findOneAndUpdate.mock.calls.find(([, u]) => u.$set && u.$set.emailCode);

describe("POST /request", () => {
  const send = (body = {}) => request(app()).post("/request").send({ email: TARGET, currentPassword: GOOD_PASSWORD, ...body });

  test("sends a code, stores an HMAC (never the code) and pendingEmail, answers a neutral 202", async () => {
    const res = await send();
    expect(res.status).toBe(202);
    expect(res.body.retryAfter).toBe(60);

    expect(sendEmailCode).toHaveBeenCalledTimes(1);
    const mail = sendEmailCode.mock.calls[0][0];
    expect(mail.to).toBe(TARGET);
    expect(mail.code).toMatch(/^\d{6}$/);

    const [, update] = lastClaim();
    const stored = update.$set.emailCode;
    expect(stored.hash).toBe(emailCode.hashCode({ pepper: PEPPER, userId: USER_ID, target: TARGET, code: mail.code }));
    expect(stored.target).toBe(TARGET);
    expect(stored.attempts).toBe(0);
    expect(stored.sendCount).toBe(1);
    expect(stored.expiresAt.getTime() - stored.lastSentAt.getTime()).toBe(10 * 60 * 1000);
    expect(update.$set.pendingEmail).toBe(TARGET);
    expect(update.$set.emailChangeToken).toBeNull();

    expect(JSON.stringify(res.body)).not.toContain(mail.code);
    expect(JSON.stringify(update)).not.toContain(`"${mail.code}"`);
  });

  test("normalizes the address", async () => {
    await send({ email: "  Juan@Example.COM " });
    expect(sendEmailCode.mock.calls[0][0].to).toBe(TARGET);
  });

  test("never looks the address up: same body whether or not another account owns it", async () => {
    const res = await send();
    expect(User.findOne).not.toHaveBeenCalled();
    const other = await send({ email: "someone-else@example.com" });
    expect(other.status).toBe(res.status);
    expect(other.body).toEqual(res.body);
  });

  test("bad format -> EMAIL_INVALID and nothing else happens", async () => {
    const res = await send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("EMAIL_INVALID");
    expect(User.findById).not.toHaveBeenCalled();
    expect(sendEmailCode).not.toHaveBeenCalled();
  });

  test("an account that already has an email is pointed at the change flow", async () => {
    User.findById.mockReturnValue(selectable(baseUser({ email: "old@example.com" })));
    const res = await send();
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("EMAIL_ALREADY_SET");
    expect(sendEmailCode).not.toHaveBeenCalled();
  });

  test("wrong password -> 401 PASSWORD_INCORRECT and it counts toward the same lockout as login", async () => {
    User.findOneAndUpdate.mockResolvedValue({ loginLock: { failures: 1, level: 0 } });
    const res = await send({ currentPassword: "nope" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("PASSWORD_INCORRECT");
    expect(User.findOneAndUpdate.mock.calls[0][1].$inc).toEqual({ "loginLock.failures": 1 });
    expect(sendEmailCode).not.toHaveBeenCalled();
  });

  test("missing password is a wrong password", async () => {
    const res = await request(app()).post("/request").send({ email: TARGET });
    expect(res.status).toBe(401);
    expect(sendEmailCode).not.toHaveBeenCalled();
  });

  test("a locked account gets the wrong-password answer even with the right password, and no mail", async () => {
    User.findById.mockReturnValue(
      selectable(baseUser({ loginLock: { lockedUntil: new Date(Date.now() + 600_000), level: 1 } }))
    );
    const res = await send();
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("PASSWORD_INCORRECT");
    expect(sendEmailCode).not.toHaveBeenCalled();
    expect(User.findOneAndUpdate).not.toHaveBeenCalled(); // not counted again while locked
  });

  test("a correct password clears earlier failures", async () => {
    User.findById.mockReturnValue(selectable(baseUser({ loginLock: { failures: 3, level: 0 } })));
    await send();
    expect(User.updateOne.mock.calls.some(([, u]) => u.$unset && u.$unset.loginLock === 1)).toBe(true);
  });

  test("60 second cooldown -> 429 EMAIL_CODE_COOLDOWN with retryAfter, no mail", async () => {
    User.findById.mockReturnValue(
      selectable(baseUser({ emailCode: { lastSentAt: new Date(Date.now() - 30_000), windowStart: new Date(), sendCount: 1 } }))
    );
    const res = await send();
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("EMAIL_CODE_COOLDOWN");
    expect(res.body.retryAfter).toBeGreaterThan(25);
    expect(res.body.retryAfter).toBeLessThanOrEqual(30);
    expect(sendEmailCode).not.toHaveBeenCalled();
  });

  test("5 sends per hour -> 429 EMAIL_CODE_LIMIT", async () => {
    User.findById.mockReturnValue(
      selectable(
        baseUser({
          emailCode: { lastSentAt: new Date(Date.now() - 120_000), windowStart: new Date(Date.now() - 600_000), sendCount: 5 },
        })
      )
    );
    const res = await send();
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("EMAIL_CODE_LIMIT");
    expect(sendEmailCode).not.toHaveBeenCalled();
  });

  test("3 per address per day, counted across accounts: the 4th is refused without mailing", async () => {
    RateLimitCounter.findOneAndUpdate.mockResolvedValue({ count: 4 });
    const res = await send();
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("EMAIL_CODE_LIMIT");
    expect(sendEmailCode).not.toHaveBeenCalled();
    // The counter key is a hash, never the address.
    const key = RateLimitCounter.findOneAndUpdate.mock.calls[0][0]._id;
    expect(key).not.toMatch(/juan|example/);
  });

  test("the 3rd request for an address is still allowed", async () => {
    RateLimitCounter.findOneAndUpdate.mockResolvedValue({ count: 3 });
    expect((await send()).status).toBe(202);
  });

  test("losing the atomic send claim (parallel double-click) -> cooldown, no second mail", async () => {
    User.findOneAndUpdate.mockResolvedValue(null);
    const res = await send();
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("EMAIL_CODE_COOLDOWN");
    expect(sendEmailCode).not.toHaveBeenCalled();
  });

  test("a mail failure does not change the answer", async () => {
    sendEmailCode.mockRejectedValueOnce(new Error("smtp down"));
    expect((await send()).status).toBe(202);
  });

  test("audit records the domain only: no code, no full address, no password", async () => {
    await send();
    const events = logAuditEvent.mock.calls.map(([e]) => JSON.stringify({ ...e, req: undefined }));
    const code = sendEmailCode.mock.calls[0][0].code;
    for (const text of events) {
      expect(text).toContain("auth.email.code_requested");
      expect(text).toContain("example.com");
      expect(text).not.toContain(TARGET);
      expect(text).not.toContain(code);
      expect(text).not.toContain(GOOD_PASSWORD);
    }
  });
});

describe("POST /verify", () => {
  const CODE = "123456";
  const storedFor = (overrides = {}) => ({
    hash: emailCode.hashCode({ pepper: PEPPER, userId: USER_ID, target: TARGET, code: CODE }),
    target: TARGET,
    expiresAt: new Date(Date.now() + 5 * 60_000),
    attempts: 1,
    ...overrides,
  });
  // First findOneAndUpdate = the attempt increment; second = the success write.
  const withStoredCode = (overrides = {}, extra = {}) =>
    User.findOneAndUpdate.mockResolvedValueOnce({ _id: USER_ID, emailCode: storedFor(overrides), ...extra });
  const verify = (code = CODE) => request(app()).post("/verify").send({ code });
  const dropped = () => User.updateOne.mock.calls.some(([, u]) => u.$unset && u.$unset.emailCode === 1);

  test("correct code: sets the email, marks it verified, bumps tokenVersion, returns a working fresh token", async () => {
    withStoredCode();
    User.findOneAndUpdate.mockResolvedValueOnce({
      _id: USER_ID,
      name: "Juan",
      role: "jobseeker",
      username: "juan_dc",
      email: TARGET,
      isEmailVerified: true,
      tokenVersion: 4,
    });
    const res = await verify();
    expect(res.status).toBe(200);

    const [filter, update] = User.findOneAndUpdate.mock.calls[1];
    expect(filter["emailCode.hash"]).toBeDefined(); // single use under a race
    expect(filter.email).toEqual({ $exists: false });
    expect(update.$set).toMatchObject({ email: TARGET, isEmailVerified: true, pendingEmail: null });
    expect(update.$set.emailVerifiedAt).toBeInstanceOf(Date);
    expect(update.$unset).toEqual({ emailCode: 1 });
    expect(update.$inc).toEqual({ tokenVersion: 1 });

    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded).toMatchObject({ id: USER_ID, tokenVersion: 4 });
    expect(res.body.user).toMatchObject({ email: TARGET, hasVerifiedEmail: true });
    expect(JSON.stringify(res.body)).not.toMatch(/emailCode|"hash"/);
  });

  test("accepts spaces and dashes in the pasted code", async () => {
    withStoredCode();
    User.findOneAndUpdate.mockResolvedValueOnce({ _id: USER_ID, role: "jobseeker", email: TARGET, tokenVersion: 4 });
    expect((await verify("123 456")).status).toBe(200);
  });

  test("consumes an attempt BEFORE comparing (atomic $inc on the account)", async () => {
    withStoredCode();
    await verify("000000");
    const [filter, update] = User.findOneAndUpdate.mock.calls[0];
    expect(filter._id).toBe(USER_ID);
    expect(update).toEqual({ $inc: { "emailCode.attempts": 1 } });
  });

  const INVALID = { code: "EMAIL_CODE_INVALID", message: expect.any(String) };

  test("wrong code -> neutral 400, email untouched", async () => {
    withStoredCode();
    const res = await verify("999999");
    expect(res.status).toBe(400);
    expect(res.body).toEqual(INVALID);
    expect(User.findOneAndUpdate).toHaveBeenCalledTimes(1); // no success write
    expect(dropped()).toBe(false); // attempts remain
  });

  test("the 5th wrong attempt kills the code", async () => {
    withStoredCode({ attempts: 5 });
    const res = await verify("999999");
    expect(res.status).toBe(400);
    expect(dropped()).toBe(true);
  });

  test("a 6th attempt is refused even with the right code, and the code is dropped", async () => {
    withStoredCode({ attempts: 6 });
    const res = await verify(CODE);
    expect(res.status).toBe(400);
    expect(User.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(dropped()).toBe(true);
  });

  test("an expired code is refused even when correct, and dropped", async () => {
    withStoredCode({ expiresAt: new Date(Date.now() - 1000) });
    const res = await verify(CODE);
    expect(res.status).toBe(400);
    expect(User.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(dropped()).toBe(true);
  });

  test("no active code -> the same answer", async () => {
    User.findOneAndUpdate.mockResolvedValueOnce(null);
    const res = await verify();
    expect(res.status).toBe(400);
    expect(res.body).toEqual(INVALID);
  });

  test("an account that already has an email cannot use a stale code", async () => {
    withStoredCode({}, { email: "old@example.com" });
    expect((await verify()).status).toBe(400);
    expect(User.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  test("a non-numeric code never matches, even if the real code is 000000", async () => {
    withStoredCode({ hash: emailCode.hashCode({ pepper: PEPPER, userId: USER_ID, target: TARGET, code: "000000" }) });
    const res = await verify("abcdef");
    expect(res.status).toBe(400);
    expect(User.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  test("address already used by another account: correct code still gets the SAME neutral answer, nothing is merged", async () => {
    withStoredCode();
    User.findOne.mockReturnValue({ collation: jest.fn().mockReturnValue(selectable({ _id: "someone-else" })) });
    const taken = await verify(CODE);

    jest.clearAllMocks();
    User.findOne.mockReturnValue({ collation: jest.fn().mockReturnValue(selectable(null)) });
    withStoredCode();
    const wrong = await verify("999999");

    expect(taken.status).toBe(400);
    expect(taken.status).toBe(wrong.status);
    expect(taken.text).toBe(wrong.text);
  });

  test("taken address: no email written, the code and pending address are dropped", async () => {
    withStoredCode();
    User.findOne.mockReturnValue({ collation: jest.fn().mockReturnValue(selectable({ _id: "someone-else" })) });
    await verify(CODE);
    expect(User.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(dropped()).toBe(true);
  });

  test("the uniqueness lookup runs for a wrong code too (same work for taken and wrong)", async () => {
    withStoredCode();
    await verify("999999");
    expect(User.findOne).toHaveBeenCalledTimes(1);
    const query = User.findOne.mock.calls[0][0];
    expect(query).toMatchObject({ email: TARGET, _id: { $ne: USER_ID } });
  });

  test("a duplicate-key race at the final write gets the same neutral answer", async () => {
    withStoredCode();
    User.findOneAndUpdate.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: 11000 }));
    const res = await verify();
    expect(res.status).toBe(400);
    expect(res.body).toEqual(INVALID);
  });

  test("losing the single-use race (code already spent) -> neutral answer", async () => {
    withStoredCode();
    User.findOneAndUpdate.mockResolvedValueOnce(null);
    expect((await verify()).status).toBe(400);
  });

  test("audit payloads never contain the code, the full address or the hash", async () => {
    withStoredCode();
    User.findOneAndUpdate.mockResolvedValueOnce({ _id: USER_ID, role: "jobseeker", email: TARGET, tokenVersion: 4 });
    await verify();
    withStoredCode();
    await verify("999999");
    const payloads = logAuditEvent.mock.calls.map(([e]) => JSON.stringify({ ...e, req: undefined }));
    expect(payloads.length).toBeGreaterThanOrEqual(2);
    for (const text of payloads) {
      expect(text).not.toContain(TARGET);
      expect(text).not.toContain(CODE);
      expect(text).not.toContain("999999");
      expect(text).not.toContain(storedFor().hash);
    }
    expect(payloads.some((t) => t.includes("auth.email.verified"))).toBe(true);
    expect(payloads.some((t) => t.includes("auth.email.code_failed"))).toBe(true);
  });

  test("the old token stops working: the success write bumps tokenVersion (verifyToken compares it)", async () => {
    withStoredCode();
    User.findOneAndUpdate.mockResolvedValueOnce({ _id: USER_ID, role: "jobseeker", email: TARGET, tokenVersion: 4 });
    await verify();
    expect(User.findOneAndUpdate.mock.calls[1][1].$inc.tokenVersion).toBe(1);
  });
});
