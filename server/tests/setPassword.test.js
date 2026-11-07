// Phase 1 — "add a password" for Google-only accounts (see
// markdowns/NOTIF_EMAIL_ID_OCR_AND_ACCOUNT_RECOVERY_PLAN.md §4.2).
//
// Mounts authController.setPassword directly behind a stub auth middleware
// (not the full authRoutes router, which also pulls in multer/nsrp/etc. —
// see tests/matchWeights.test.js for why that pattern is reserved for
// routes that actually need it). Follows the same mocked-models style as
// the rest of this suite.

jest.mock("../models/User", () => ({ findById: jest.fn() }));
jest.mock("../services/mailService", () => ({
  sendPasswordAddedEmail: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
}));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));

const mockVerifyIdToken = jest.fn();
jest.mock("google-auth-library", () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const { sendPasswordAddedEmail } = require("../services/mailService");
const { logAuditEvent } = require("../services/auditService");
const authController = require("../controllers/authController");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";

const USER_ID = "507f1f77bcf86cd799439011";
const GOOGLE_SUB = "google-sub-123";

const buildApp = () => {
  const app = express();
  app.use(express.json());
  // Stand-in for middleware/auth.js's verifyToken — this suite is about
  // setPassword's own logic, not JWT verification.
  app.use((req, _res, next) => {
    req.user = { id: USER_ID, role: "jobseeker" };
    next();
  });
  app.post("/set-password", authController.setPassword);
  return app;
};

const buildUserDoc = (overrides = {}) => ({
  _id: USER_ID,
  email: "jobseeker@example.com",
  name: "Juan Dela Cruz",
  role: "jobseeker",
  password: null,
  googleId: GOOGLE_SUB,
  tokenVersion: 0,
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe("POST /auth/set-password", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  test("503s when Google sign-in isn't configured", async () => {
    const previous = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;

    const res = await request(app).post("/set-password").send({ credential: "x", newPassword: "longenough1" });

    expect(res.status).toBe(503);
    process.env.GOOGLE_CLIENT_ID = previous;
  });

  test("400s when the credential is missing", async () => {
    const res = await request(app).post("/set-password").send({ newPassword: "longenough1" });
    expect(res.status).toBe(400);
    expect(User.findById).not.toHaveBeenCalled();
  });

  test("400s when the new password is too short", async () => {
    const res = await request(app).post("/set-password").send({ credential: "x", newPassword: "short" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least 8 characters/i);
  });

  test("400s when the account already has a password", async () => {
    User.findById.mockResolvedValue(buildUserDoc({ password: "$2a$10$existinghash" }));

    const res = await request(app)
      .post("/set-password")
      .send({ credential: "x", newPassword: "longenough1" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already has a password/i);
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  test("400s when the account has no linked Google id", async () => {
    User.findById.mockResolvedValue(buildUserDoc({ googleId: null }));

    const res = await request(app)
      .post("/set-password")
      .send({ credential: "x", newPassword: "longenough1" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/isn't linked to Google/i);
  });

  test("401s when the Google credential fails verification", async () => {
    User.findById.mockResolvedValue(buildUserDoc());
    mockVerifyIdToken.mockRejectedValue(new Error("bad token"));

    const res = await request(app)
      .post("/set-password")
      .send({ credential: "bad-credential", newPassword: "longenough1" });

    expect(res.status).toBe(401);
  });

  // The core guard this endpoint exists to enforce: a valid Google credential
  // for the WRONG account must not be accepted just because the caller is
  // authenticated as this user.
  test("401s when the credential's Google account doesn't match the one linked to this user", async () => {
    User.findById.mockResolvedValue(buildUserDoc({ googleId: GOOGLE_SUB }));
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ sub: "someone-elses-sub" }) });

    const res = await request(app)
      .post("/set-password")
      .send({ credential: "token-for-a-different-account", newPassword: "longenough1" });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/doesn't match/i);
  });

  test("sets a hashed password, bumps tokenVersion, emails, audits, and returns a fresh token", async () => {
    const userDoc = buildUserDoc();
    User.findById.mockResolvedValue(userDoc);
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ sub: GOOGLE_SUB }) });

    const res = await request(app)
      .post("/set-password")
      .send({ credential: "valid-fresh-credential", newPassword: "longenough1" });

    expect(res.status).toBe(200);
    expect(res.body.hasPassword).toBe(true);
    expect(typeof res.body.token).toBe("string");

    // A real bcrypt hash was stored, not the plaintext.
    expect(userDoc.password).not.toBe("longenough1");
    expect(await bcrypt.compare("longenough1", userDoc.password)).toBe(true);

    // Every other live session is forced to re-authenticate.
    expect(userDoc.tokenVersion).toBe(1);
    expect(userDoc.save).toHaveBeenCalledTimes(1);

    // The returned token is signed with the bumped tokenVersion, so this
    // session itself stays logged in.
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.tokenVersion).toBe(1);
    expect(decoded.id).toBe(USER_ID);

    expect(sendPasswordAddedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: userDoc.email })
    );
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.password.added", severity: "warning" })
    );
  });

  test("a mail-send failure does not fail the request", async () => {
    const userDoc = buildUserDoc();
    User.findById.mockResolvedValue(userDoc);
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ sub: GOOGLE_SUB }) });
    sendPasswordAddedEmail.mockRejectedValue(new Error("smtp down"));

    const res = await request(app)
      .post("/set-password")
      .send({ credential: "valid-fresh-credential", newPassword: "longenough1" });

    expect(res.status).toBe(200);
  });
});
