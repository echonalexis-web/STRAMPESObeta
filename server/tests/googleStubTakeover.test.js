// Account pre-hijacking: an attacker registers a password account with the
// victim's email (it stays unverified and cannot sign in). When the victim
// later uses Google sign-in, that stub used to be linked and marked verified
// with the attacker's password still on it. The stub is now deleted and the
// normal first-time Google sign-up runs instead.

jest.mock("../models/User", () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  findById: jest.fn(),
  deleteOne: jest.fn(),
  updateOne: jest.fn(),
  exists: jest.fn(),
}));
jest.mock("../models/ReservedUsername", () => ({ findOne: jest.fn() }));
jest.mock("../models/JobseekerProfile", () => ({ create: jest.fn().mockResolvedValue({}), deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }) }));
jest.mock("../models/EmployerProfile", () => ({ create: jest.fn().mockResolvedValue({}), deleteOne: jest.fn().mockResolvedValue({ deletedCount: 0 }) }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/notificationService", () => ({ notifyManyUsers: jest.fn().mockResolvedValue([]) }));
jest.mock("../services/mailService", () => ({
  isEmailConfigured: jest.fn().mockReturnValue(false),
  renderEmail: jest.fn(),
  sendMail: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
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

const mockVerifyIdToken = jest.fn();
jest.mock("google-auth-library", () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken: mockVerifyIdToken })),
}));

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const JobseekerProfile = require("../models/JobseekerProfile");
const EmployerProfile = require("../models/EmployerProfile");
const ReservedUsername = require("../models/ReservedUsername");
const { logAuditEvent } = require("../services/auditService");
const authController = require("../controllers/authController");

const EMAIL = "victim@example.com";
const GOOGLE_ID = "google-sub-123";

const chain = (value) => ({ collation: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(value) }) });

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.app.set("io", null); next(); });
  app.post("/google", authController.googleAuth);
  app.post("/google/complete", authController.googleComplete);
  return app;
};

const stub = (extra = {}) => ({
  _id: "stub-1",
  email: EMAIL,
  role: "jobseeker",
  password: "$2a$10$attackerchosenhashattackerchosenhashattackerchosenha",
  isEmailVerified: false,
  googleId: undefined,
  save: jest.fn().mockResolvedValue(undefined),
  ...extra,
});

const created = (extra = {}) => ({
  _id: "fresh-1",
  name: "Victim",
  email: EMAIL,
  googleId: GOOGLE_ID,
  role: "jobseeker",
  isEmailVerified: true,
  save: jest.fn().mockResolvedValue(undefined),
  ...extra,
});

// The account lookups by googleId/email return `found`; username availability
// lookups (assignSuggestedUsername) return nothing.
const lookupReturns = (found) => {
  User.findOne.mockImplementation((query) =>
    query && Object.prototype.hasOwnProperty.call(query, "username") ? chain(null) : Promise.resolve(found)
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ email: EMAIL, email_verified: true, sub: GOOGLE_ID, name: "Victim" }) });
  User.find.mockReturnValue({ select: jest.fn().mockResolvedValue([]) });
  User.deleteOne.mockResolvedValue({ deletedCount: 1 });
  ReservedUsername.findOne.mockReturnValue(chain(null));
  lookupReturns(null);
});

const actions = () => logAuditEvent.mock.calls.map(([e]) => e.action);

describe("googleAuth with an unverified password stub for the same email", () => {
  test("jobseeker: the stub is deleted and the date-of-birth step starts, never a session on the stub", async () => {
    const s = stub();
    lookupReturns(s);
    const res = await request(buildApp()).post("/google").send({ credential: "cred" });

    expect(User.deleteOne).toHaveBeenCalledWith({ _id: "stub-1", isEmailVerified: false, googleId: null });
    expect(JobseekerProfile.deleteOne).toHaveBeenCalledWith({ userId: "stub-1" });
    expect(actions()).toContain("auth.user.unverified_stub_replaced");
    expect(s.save).not.toHaveBeenCalled();
    expect(s.googleId).toBeUndefined();
    expect(res.status).toBe(202);
    expect(res.body.code).toBe("DOB_REQUIRED");
    expect(res.body.token).toBeUndefined();
  });

  test("employer stub: deleted and a fresh Google account is created", async () => {
    lookupReturns(stub({ role: "employer" }));
    User.create.mockResolvedValue(created({ role: "employer" }));
    const res = await request(buildApp()).post("/google").send({ credential: "cred", intent: "employer", confirmAdult: true });

    expect(User.deleteOne).toHaveBeenCalled();
    expect(EmployerProfile.deleteOne).toHaveBeenCalledWith({ userId: "stub-1" });
    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({ email: EMAIL, googleId: GOOGLE_ID, isEmailVerified: true }));
    expect(User.create.mock.calls[0][0]).not.toHaveProperty("password");
    expect(res.status).toBe(200);
    expect(jwt.verify(res.body.token, process.env.JWT_SECRET).id).toBe("fresh-1");
  });

  test("if the stub was verified in the meantime, nothing is deleted and the user is asked to retry", async () => {
    const s = stub();
    lookupReturns(s);
    User.deleteOne.mockResolvedValue({ deletedCount: 0 });
    const res = await request(buildApp()).post("/google").send({ credential: "cred" });

    expect(JobseekerProfile.deleteOne).not.toHaveBeenCalled();
    expect(actions()).not.toContain("auth.user.unverified_stub_replaced");
    expect(res.status).toBe(409);
    expect(s.save).not.toHaveBeenCalled();
  });
});

describe("googleAuth keeps linking real accounts", () => {
  test.each([
    ["a legacy account (isEmailVerified unset)", { isEmailVerified: undefined }],
    ["a verified password account", { isEmailVerified: true }],
  ])("%s is linked, not deleted", async (_label, extra) => {
    const s = stub(extra);
    lookupReturns(s);
    const res = await request(buildApp()).post("/google").send({ credential: "cred" });

    expect(User.deleteOne).not.toHaveBeenCalled();
    expect(s.googleId).toBe(GOOGLE_ID);
    expect(s.save).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  test("an unverified account under a different email is not treated as a stub", async () => {
    // Found via googleId, so it already has one and is not a stub.
    const s = stub({ email: "other@example.com", googleId: GOOGLE_ID });
    lookupReturns(s);
    const res = await request(buildApp()).post("/google").send({ credential: "cred" });
    expect(User.deleteOne).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  test("staff accounts are never deleted", async () => {
    const s = stub({ role: "admin" });
    lookupReturns(s);
    await request(buildApp()).post("/google").send({ credential: "cred" });
    expect(User.deleteOne).not.toHaveBeenCalled();
  });
});

describe("googleComplete", () => {
  const pending = () =>
    jwt.sign({ purpose: "google_signup", email: EMAIL, googleId: GOOGLE_ID, name: "Victim" }, process.env.JWT_SECRET, { expiresIn: "10m" });

  test("a stub registered during the pending window is replaced, not a 409", async () => {
    lookupReturns(stub());
    User.create.mockResolvedValue(created());
    const res = await request(buildApp()).post("/google/complete").send({ pendingToken: pending(), dateOfBirth: "2000-01-15" });

    expect(User.deleteOne).toHaveBeenCalledWith({ _id: "stub-1", isEmailVerified: false, googleId: null });
    expect(res.status).toBe(200);
    expect(jwt.verify(res.body.token, process.env.JWT_SECRET).id).toBe("fresh-1");
  });

  test("a real existing account still gets the 409", async () => {
    lookupReturns(stub({ isEmailVerified: true }));
    const res = await request(buildApp()).post("/google/complete").send({ pendingToken: pending(), dateOfBirth: "2000-01-15" });
    expect(User.deleteOne).not.toHaveBeenCalled();
    expect(res.status).toBe(409);
  });
});
