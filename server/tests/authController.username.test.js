// Phase 3 — username as a second sign-in identifier. Route-level coverage
// for authController.login's new identifier resolution, plus
// checkUsernameAvailable and setUsername. Mounts the controller functions
// directly behind a minimal express app (same pattern as
// tests/setPassword.test.js) rather than the full authRoutes router, which
// also pulls in multer/nsrp middleware unrelated to this feature.
//
// utils/username.js itself is NOT mocked — only the models it queries
// (models/User, models/ReservedUsername) — so these tests exercise the
// real wiring between authController and that module, not just "was a
// mock called with the right args". Its own unit tests live in
// tests/username.test.js.

jest.mock("../models/User", () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  // login() fire-and-forgets a lastLoginAt update on every successful login.
  updateOne: jest.fn().mockResolvedValue({}),
}));
jest.mock("../models/ReservedUsername", () => ({ findOne: jest.fn(), create: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const express = require("express");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const ReservedUsername = require("../models/ReservedUsername");
const { logAuditEvent } = require("../services/auditService");
const authController = require("../controllers/authController");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const USER_ID = "507f1f77bcf86cd799439011";
const REAL_PASSWORD = "CorrectHorse123";
let REAL_HASH;

beforeAll(() => {
  REAL_HASH = bcrypt.hashSync(REAL_PASSWORD, 10);
});

// Two distinct chain shapes, matching two distinct real call sites:
// login()'s username branch awaits straight off .collation() (one link —
// findOne().collation()), while utils/username.js's isAvailable adds a
// further .select("_id") (two links — findOne().collation().select()).
// Using the wrong one makes `user`/`takenBy` resolve to the mock query
// object itself rather than the intended value, so these must not be mixed up.
const loginChain = (resolvedValue) => ({ collation: jest.fn().mockResolvedValue(resolvedValue) });
const chain = (resolvedValue) => ({
  collation: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(resolvedValue) }),
});

const buildPublicApp = () => {
  const app = express();
  app.use(express.json());
  app.post("/login", authController.login);
  app.get("/username-available", authController.checkUsernameAvailable);
  return app;
};

const buildProtectedApp = (userId = USER_ID) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId, role: "jobseeker" };
    next();
  });
  app.post("/username", authController.setUsername);
  return app;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST /login — username resolution", () => {
  const activeUser = (overrides = {}) => ({
    _id: USER_ID,
    email: "jane@example.com",
    username: "jane_doe",
    password: REAL_HASH,
    role: "jobseeker",
    tokenVersion: 0,
    isActive: true,
    accountStatus: "active",
    isEmailVerified: true,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  test("an email-shaped identifier resolves via User.findOne({email}) — no collation chain", async () => {
    User.findOne.mockResolvedValue(activeUser());

    const res = await request(buildPublicApp())
      .post("/login")
      .send({ identifier: "jane@example.com", password: REAL_PASSWORD });

    expect(res.status).toBe(200);
    expect(User.findOne).toHaveBeenCalledWith({ email: "jane@example.com" });
    expect(res.body.user.username).toBe("jane_doe");
  });

  test("a username-shaped identifier resolves via the case-insensitive collation path", async () => {
    User.findOne.mockReturnValue(loginChain(activeUser()));

    const res = await request(buildPublicApp())
      .post("/login")
      .send({ identifier: "Jane_Doe", password: REAL_PASSWORD });

    expect(res.status).toBe(200);
    expect(User.findOne).toHaveBeenCalledWith({ username: "jane_doe" });
  });

  test("the legacy `email` field still works unchanged (back-compat)", async () => {
    User.findOne.mockResolvedValue(activeUser());

    const res = await request(buildPublicApp())
      .post("/login")
      .send({ email: "jane@example.com", password: REAL_PASSWORD });

    expect(res.status).toBe(200);
  });

  // The actual security property this phase must not break: an unknown
  // identifier still pays the same bcrypt cost against a dummy hash, so
  // "no such account" and "wrong password" are indistinguishable by timing
  // or response text — now true for a bogus USERNAME too, not just email.
  test("an unknown username still compares against the dummy hash and returns the generic message", async () => {
    User.findOne.mockReturnValue(loginChain(null));
    const compareSpy = jest.spyOn(bcrypt, "compare");

    const res = await request(buildPublicApp())
      .post("/login")
      .send({ identifier: "nobody_here", password: "whatever" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid username/email or password");
    expect(compareSpy).toHaveBeenCalledWith("whatever", expect.stringMatching(/^\$2[aby]\$/));
    compareSpy.mockRestore();
  });

  test("a correct username but wrong password is rejected with the generic message", async () => {
    User.findOne.mockReturnValue(loginChain(activeUser()));

    const res = await request(buildPublicApp())
      .post("/login")
      .send({ identifier: "jane_doe", password: "totally-wrong" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid username/email or password");
  });
});

describe("GET /username-available", () => {
  test("an available, well-formed candidate", async () => {
    User.findOne.mockReturnValue(chain(null));
    ReservedUsername.findOne.mockReturnValue(chain(null));

    const res = await request(buildPublicApp()).get("/username-available").query({ u: "free_name" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true, normalized: "free_name" });
  });

  test("a taken candidate", async () => {
    User.findOne.mockReturnValue(chain({ _id: "someone-else" }));
    ReservedUsername.findOne.mockReturnValue(chain(null));

    const res = await request(buildPublicApp()).get("/username-available").query({ u: "taken_name" });

    expect(res.body.available).toBe(false);
  });

  test("a malformed candidate is reported unavailable with a reason, not a DB lookup", async () => {
    const res = await request(buildPublicApp()).get("/username-available").query({ u: "ad" });

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toMatch(/3-30 characters/);
    expect(User.findOne).not.toHaveBeenCalled();
  });
});

describe("POST /username (setUsername)", () => {
  const userDoc = (overrides = {}) => ({
    _id: USER_ID,
    role: "jobseeker",
    username: null,
    usernameChangedAt: null,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  test("rejects a malformed username with 400 before touching the DB", async () => {
    const res = await request(buildProtectedApp()).post("/username").send({ username: "ab" });

    expect(res.status).toBe(400);
    expect(User.findById).not.toHaveBeenCalled();
  });

  test("sets a username for the first time with no cooldown check blocking it", async () => {
    const doc = userDoc();
    User.findById.mockResolvedValue(doc);
    User.findOne.mockReturnValue(chain(null));
    ReservedUsername.findOne.mockReturnValue(chain(null));

    const res = await request(buildProtectedApp()).post("/username").send({ username: "new_jane" });

    expect(res.status).toBe(200);
    expect(doc.username).toBe("new_jane");
    expect(doc.usernameChangedAt).toBeInstanceOf(Date);
    expect(doc.save).toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.username.changed" })
    );
    // No previous username — nothing to tombstone.
    expect(ReservedUsername.create).not.toHaveBeenCalled();
  });

  test("is a no-op (200, no write) when resubmitting the username already set", async () => {
    const doc = userDoc({ username: "already_mine" });
    User.findById.mockResolvedValue(doc);

    const res = await request(buildProtectedApp()).post("/username").send({ username: "Already_Mine" });

    expect(res.status).toBe(200);
    expect(doc.save).not.toHaveBeenCalled();
  });

  test("blocks a second change inside the 30-day cooldown", async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const doc = userDoc({ username: "old_name", usernameChangedAt: fiveDaysAgo });
    User.findById.mockResolvedValue(doc);

    const res = await request(buildProtectedApp()).post("/username").send({ username: "new_name" });

    expect(res.status).toBe(400);
    expect(res.body.nextAllowedAt).toBeDefined();
    expect(doc.save).not.toHaveBeenCalled();
  });

  test("rejects an already-taken username", async () => {
    const doc = userDoc();
    User.findById.mockResolvedValue(doc);
    User.findOne.mockReturnValue(chain({ _id: "someone-else" }));
    ReservedUsername.findOne.mockReturnValue(chain(null));

    const res = await request(buildProtectedApp()).post("/username").send({ username: "taken_name" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already taken/i);
    expect(doc.save).not.toHaveBeenCalled();
  });

  test("tombstones the released username on a successful change, without blocking the response on it", async () => {
    const doc = userDoc({ username: "old_name" });
    User.findById.mockResolvedValue(doc);
    User.findOne.mockReturnValue(chain(null));
    ReservedUsername.findOne.mockReturnValue(chain(null));
    ReservedUsername.create.mockResolvedValue({});

    const res = await request(buildProtectedApp()).post("/username").send({ username: "new_name" });

    expect(res.status).toBe(200);
    expect(ReservedUsername.create).toHaveBeenCalledWith(
      expect.objectContaining({ username: "old_name", releasedBy: USER_ID, reason: "changed" })
    );
  });

  test("a tombstone write failure never fails the username change itself", async () => {
    const doc = userDoc({ username: "old_name" });
    User.findById.mockResolvedValue(doc);
    User.findOne.mockReturnValue(chain(null));
    ReservedUsername.findOne.mockReturnValue(chain(null));
    ReservedUsername.create.mockRejectedValue(new Error("duplicate tombstone"));

    const res = await request(buildProtectedApp()).post("/username").send({ username: "new_name" });

    expect(res.status).toBe(200);
  });

  test("a duplicate-key race at save time surfaces the same clean 'already taken' message", async () => {
    const doc = userDoc();
    doc.save = jest.fn().mockRejectedValue(Object.assign(new Error("E11000"), { code: 11000 }));
    User.findById.mockResolvedValue(doc);
    User.findOne.mockReturnValue(chain(null)); // isAvailable() says free — another request won the race after
    ReservedUsername.findOne.mockReturnValue(chain(null));

    const res = await request(buildProtectedApp()).post("/username").send({ username: "raced_name" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already taken/i);
  });
});
