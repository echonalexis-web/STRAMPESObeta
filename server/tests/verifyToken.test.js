// E-17: verifyToken must tell a bad/expired token (401) apart from our own
// failures (503), and must keep the existing account-state 403 codes.

jest.mock("../models/User", () => ({ findById: jest.fn() }));
jest.mock("../models/SystemSettings", () => ({}));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const logger = require("../utils/logger");
const { verifyToken } = require("../middleware/auth");

const SECRET = "test-secret";
const USER_ID = "507f1f77bcf86cd799439011";

const buildApp = () => {
  const app = express();
  app.get("/protected", verifyToken, (req, res) => res.json({ ok: true, user: req.user }));
  return app;
};

const userRow = (overrides = {}) => ({
  _id: USER_ID,
  isActive: true,
  role: "jobseeker",
  tokenVersion: 0,
  staffRecoveryPending: false,
  ...overrides,
});

const mockUserLookup = (row) => User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(row) });

const sign = (payload = {}, opts = {}, secret = SECRET) =>
  jwt.sign({ id: USER_ID, role: "jobseeker", tokenVersion: 0, ...payload }, secret, opts);

describe("verifyToken status mapping (E-17)", () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = SECRET;
    mockUserLookup(userRow());
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  test("valid token passes through", async () => {
    const res = await request(buildApp()).get("/protected").set("Authorization", `Bearer ${sign()}`);

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("jobseeker");
  });

  test("missing token stays 401", async () => {
    const res = await request(buildApp()).get("/protected");

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("No token provided");
  });

  test("expired token is 401 TOKEN_EXPIRED, not 403", async () => {
    const expired = sign({}, { expiresIn: -10 });

    const res = await request(buildApp()).get("/protected").set("Authorization", `Bearer ${expired}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_EXPIRED");
    expect(User.findById).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("token signed with the wrong secret (forged) is 401 TOKEN_INVALID", async () => {
    const forged = sign({}, {}, "some-other-secret");

    const res = await request(buildApp()).get("/protected").set("Authorization", `Bearer ${forged}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_INVALID");
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("malformed token is 401 TOKEN_INVALID", async () => {
    const res = await request(buildApp()).get("/protected").set("Authorization", "Bearer not-a-jwt");

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_INVALID");
  });

  test("database failure during the user lookup is 503 and is logged, never an auth failure", async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockRejectedValue(new Error("MongoNetworkError: connection refused")) });
    const token = sign();

    const res = await request(buildApp()).get("/protected").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("AUTH_UNAVAILABLE");
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [, entry] = logger.error.mock.calls[0];
    expect(entry).toMatchObject({ operation: "GET /protected", userId: USER_ID, role: "jobseeker", status: 503 });
    expect(entry.error).toContain("connection refused");
    expect(entry.stack).toEqual(expect.any(String));
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(token);
  });

  test("missing JWT_SECRET is a server fault (503), not a bad token", async () => {
    const token = sign();
    delete process.env.JWT_SECRET;

    const res = await request(buildApp()).get("/protected").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(503);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test("deleted account keeps 403 ACCOUNT_DELETED", async () => {
    mockUserLookup(null);

    const res = await request(buildApp()).get("/protected").set("Authorization", `Bearer ${sign()}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_DELETED");
  });

  test("stale tokenVersion keeps 403 SESSION_EXPIRED", async () => {
    mockUserLookup(userRow({ tokenVersion: 3 }));

    const res = await request(buildApp()).get("/protected").set("Authorization", `Bearer ${sign({ tokenVersion: 1 })}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SESSION_EXPIRED");
  });

  test("suspended account keeps 403 ACCOUNT_SUSPENDED", async () => {
    mockUserLookup(userRow({ isActive: false, accountStatus: "suspended" }));

    const res = await request(buildApp()).get("/protected").set("Authorization", `Bearer ${sign()}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_SUSPENDED");
  });

  test("appeal-scoped token keeps 403 APPEAL_TOKEN_SCOPE", async () => {
    const res = await request(buildApp()).get("/protected").set("Authorization", `Bearer ${sign({ scope: "appeal" })}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("APPEAL_TOKEN_SCOPE");
  });
});
