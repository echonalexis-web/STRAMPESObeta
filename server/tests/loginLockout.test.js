// Per-account login lockout (phase 3b). Mocked models, no database.

jest.mock("../models/User", () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock("../models/ReservedUsername", () => ({ findOne: jest.fn() }));
jest.mock("../models/JobseekerProfile", () => ({ create: jest.fn() }));
jest.mock("../models/EmployerProfile", () => ({ create: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/notificationService", () => ({ notifyManyUsers: jest.fn().mockResolvedValue([]) }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const express = require("express");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { logAuditEvent } = require("../services/auditService");
const lock = require("../services/loginLockService");
const authController = require("../controllers/authController");

const app = () => {
  const a = express();
  a.use(express.json());
  a.post("/login", authController.login);
  return a;
};

let hash;
beforeAll(async () => {
  hash = await bcrypt.hash("Sup3rSecret!", 4);
});

const makeUser = (overrides = {}) => ({
  _id: "507f1f77bcf86cd799439011",
  name: "J",
  role: "jobseeker",
  username: "juan_dc",
  email: "a@b.co",
  password: hash,
  tokenVersion: 0,
  save: jest.fn(),
  ...overrides,
});

const loginWith = (user, password) => {
  User.findOne.mockReturnValue({ collation: jest.fn().mockResolvedValue(user) });
  return request(app()).post("/login").send({ identifier: user ? "juan_dc" : "ghost", password });
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.USERNAME_SIGNUP_ENABLED = "true";
  User.findOneAndUpdate.mockResolvedValue({ loginLock: { failures: 1, level: 0 } });
  User.updateOne.mockResolvedValue({});
});
afterAll(() => {
  delete process.env.USERNAME_SIGNUP_ENABLED;
});

describe("lock schedule", () => {
  test("15, 30, 60 minutes, capped at 60", () => {
    expect([1, 2, 3, 4, 9].map(lock.lockMinutes)).toEqual([15, 30, 60, 60, 60]);
  });

  test("isLocked only while lockedUntil is in the future", () => {
    const now = Date.now();
    expect(lock.isLocked({ loginLock: { lockedUntil: new Date(now + 1000) } }, now)).toBe(true);
    expect(lock.isLocked({ loginLock: { lockedUntil: new Date(now - 1000) } }, now)).toBe(false);
    expect(lock.isLocked({}, now)).toBe(false);
    expect(lock.isLocked(null, now)).toBe(false);
  });
});

describe("recordFailure", () => {
  const user = { _id: "507f1f77bcf86cd799439011" };

  test("counts atomically with $inc and does not lock before the 5th failure", async () => {
    User.findOneAndUpdate.mockResolvedValueOnce({ loginLock: { failures: 4, level: 0 } });
    const r = await lock.recordFailure(user);
    expect(r.locked).toBe(false);
    expect(User.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(User.findOneAndUpdate.mock.calls[0][1].$inc).toEqual({ "loginLock.failures": 1 });
  });

  test.each([
    [0, 15],
    [1, 30],
    [2, 60],
    [5, 60],
  ])("the 5th failure at level %i locks for %i minutes, resets the counter, and audits", async (level, minutes) => {
    const now = new Date("2026-01-01T00:00:00Z");
    User.findOneAndUpdate
      .mockResolvedValueOnce({ loginLock: { failures: 5, level } })
      .mockResolvedValueOnce({ _id: user._id });
    const r = await lock.recordFailure(user, { now });
    expect(r.locked).toBe(true);
    const [filter, update] = User.findOneAndUpdate.mock.calls[1];
    expect(filter["loginLock.failures"]).toEqual({ $gte: 5 }); // single winner
    expect(update.$set["loginLock.failures"]).toBe(0);
    expect(update.$set["loginLock.level"]).toBe(level + 1);
    expect(update.$set["loginLock.lockedUntil"].getTime()).toBe(now.getTime() + minutes * 60_000);
    expect(logAuditEvent.mock.calls[0][0].action).toBe("auth.account.locked");
    expect(JSON.stringify(logAuditEvent.mock.calls[0][0].metadata)).toBe(JSON.stringify({ level: level + 1, minutes }));
  });

  test("a parallel request that loses the lock claim does not audit twice", async () => {
    User.findOneAndUpdate.mockResolvedValueOnce({ loginLock: { failures: 6, level: 0 } }).mockResolvedValueOnce(null);
    const r = await lock.recordFailure(user);
    expect(r.locked).toBe(false);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  test("never throws when the database fails", async () => {
    User.findOneAndUpdate.mockRejectedValue(new Error("down"));
    await expect(lock.recordFailure(user)).resolves.toEqual({ locked: false });
  });

  test("clearLock unsets the whole subdocument", async () => {
    await lock.clearLock("507f1f77bcf86cd799439011");
    expect(User.updateOne.mock.calls[0][1]).toEqual({ $unset: { loginLock: 1 } });
  });
});

describe("login with lockout", () => {
  const GENERIC = { message: "Invalid username/email or password" };

  test("flag OFF: a wrong password writes nothing (no lockout fields for legacy behavior)", async () => {
    process.env.USERNAME_SIGNUP_ENABLED = "false";
    const res = await loginWith(makeUser(), "wrong");
    expect(res.status).toBe(400);
    expect(res.body).toEqual(GENERIC);
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    expect(User.updateOne).not.toHaveBeenCalled();
  });

  test("a wrong password counts against the account", async () => {
    const res = await loginWith(makeUser(), "wrong");
    expect(res.status).toBe(400);
    expect(res.body).toEqual(GENERIC);
    const [filter, update] = User.findOneAndUpdate.mock.calls[0];
    expect(filter._id).toBe("507f1f77bcf86cd799439011");
    expect(update.$inc).toEqual({ "loginLock.failures": 1 });
  });

  test("an unknown username creates no state: it only does a dummy write against an id that matches nothing", async () => {
    const res = await loginWith(null, "whatever");
    expect(res.status).toBe(400);
    expect(res.body).toEqual(GENERIC);
    expect(User.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const filterId = User.findOneAndUpdate.mock.calls[0][0]._id;
    expect(String(filterId)).toMatch(/^[0-9a-f]{24}$/);
    expect(String(filterId)).not.toBe("507f1f77bcf86cd799439011");
  });

  test("a LOCKED account answers exactly like a wrong password, even with the right password, and counts nothing", async () => {
    const locked = makeUser({ loginLock: { failures: 0, level: 1, lockedUntil: new Date(Date.now() + 600_000) } });
    const res = await loginWith(locked, "Sup3rSecret!");
    expect(res.status).toBe(400);
    expect(res.body).toEqual(GENERIC);
    expect(res.body.token).toBeUndefined();
    // Only the dummy write: nothing aimed at the real account.
    expect(User.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(User.findOneAndUpdate.mock.calls[0][0]._id).not.toBe(locked._id);
  });

  test("wrong, unknown and locked produce byte-identical responses", async () => {
    const wrong = await loginWith(makeUser(), "wrong");
    const unknown = await loginWith(null, "wrong");
    const locked = await loginWith(
      makeUser({ loginLock: { lockedUntil: new Date(Date.now() + 600_000) } }),
      "Sup3rSecret!"
    );
    for (const r of [unknown, locked]) {
      expect(r.status).toBe(wrong.status);
      expect(r.text).toBe(wrong.text);
    }
  });

  test("a lock that has expired lets the right password in, and success clears the record", async () => {
    const expired = makeUser({ loginLock: { failures: 0, level: 2, lockedUntil: new Date(Date.now() - 1000) } });
    const res = await loginWith(expired, "Sup3rSecret!");
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(User.updateOne.mock.calls.some(([, u]) => u.$unset && u.$unset.loginLock === 1)).toBe(true);
  });

  test("a normal success on an account with no lock record writes nothing extra for the lock", async () => {
    const res = await loginWith(makeUser(), "Sup3rSecret!");
    expect(res.status).toBe(200);
    expect(User.updateOne.mock.calls.some(([, u]) => u.$unset)).toBe(false);
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("staff accounts are never locked by failed logins (dummy write only)", async () => {
    const admin = makeUser({ role: "admin", _id: "507f1f77bcf86cd799439022" });
    const res = await loginWith(admin, "wrong");
    expect(res.status).toBe(400);
    expect(User.findOneAndUpdate.mock.calls[0][0]._id).not.toBe(admin._id);
  });

  test("the 5th wrong password locks, and the sixth attempt is refused even with the right password", async () => {
    User.findOneAndUpdate
      .mockResolvedValueOnce({ loginLock: { failures: 5, level: 0 } })
      .mockResolvedValueOnce({ _id: "507f1f77bcf86cd799439011" });
    const fifth = await loginWith(makeUser(), "wrong");
    expect(fifth.status).toBe(400);
    expect(User.findOneAndUpdate).toHaveBeenCalledTimes(2); // count + lock claim
    const locked = makeUser({ loginLock: { failures: 0, level: 1, lockedUntil: new Date(Date.now() + 900_000) } });
    const sixth = await loginWith(locked, "Sup3rSecret!");
    expect(sixth.status).toBe(400);
    expect(sixth.body.token).toBeUndefined();
  });
});
