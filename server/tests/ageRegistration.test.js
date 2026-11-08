// Date of birth at registration, the Google pending step, DOB locking, the
// legacy "set once" endpoint and the admin-only change. Mocked models, fixed
// clock where the age matters. No real accounts or email.

jest.mock("../models/User", () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  findById: jest.fn(),
  updateOne: jest.fn(),
  exists: jest.fn(),
}));
jest.mock("../models/ReservedUsername", () => ({ findOne: jest.fn() }));
jest.mock("../models/JobseekerProfile", () => ({ create: jest.fn().mockResolvedValue({}) }));
jest.mock("../models/EmployerProfile", () => ({ create: jest.fn().mockResolvedValue({}) }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/notificationService", () => ({ notifyManyUsers: jest.fn().mockResolvedValue([]) }));
jest.mock("../services/mailService", () => ({
  isEmailConfigured: jest.fn().mockReturnValue(false),
  renderEmail: jest.fn(),
  sendMail: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({}),
  sendPasswordChangedEmail: jest.fn().mockResolvedValue({}),
  sendPasswordAddedEmail: jest.fn().mockResolvedValue({}),
  sendEmailVerification: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
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
const ReservedUsername = require("../models/ReservedUsername");
const { logAuditEvent } = require("../services/auditService");
const authController = require("../controllers/authController");
const userController = require("../controllers/userController");
const adminController = require("../controllers/adminController");

// What the audit log was told, without the raw request object (which of course
// carries whatever the client posted).
const auditEvents = () => logAuditEvent.mock.calls.map(([event]) => ({ ...event, req: undefined }));

const chain = (value) => ({ collation: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(value) }) });

// Real calendar-relative dates so the real clock is fine: a person who turned
// `years` years old `daysAgo` days ago.
const born = (years, daysAgo = 0) => {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate() - daysAgo));
  return d.toISOString().slice(0, 10);
};

const buildApp = (reqUser) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (reqUser) req.user = reqUser;
    req.app.set("io", null);
    next();
  });
  app.post("/register", authController.register);
  app.post("/register/employer", authController.registerEmployer);
  app.post("/google", authController.googleAuth);
  app.post("/google/complete", authController.googleComplete);
  app.put("/profile", authController.updateProfile);
  app.put("/onboarding", userController.completeOnboarding);
  app.post("/me/dob", userController.setMyDateOfBirth);
  app.put("/admin/users/:id/dob", adminController.changeUserDateOfBirth);
  return app;
};

const createdDoc = (extra = {}) => ({
  _id: "newUserId123",
  name: "Juan",
  email: "juan@example.com",
  role: "jobseeker",
  save: jest.fn().mockResolvedValue(undefined),
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  User.findOne.mockImplementation((query) =>
    query && Object.prototype.hasOwnProperty.call(query, "username") ? chain(null) : Promise.resolve(null)
  );
  User.find.mockReturnValue({ select: jest.fn().mockResolvedValue([]) });
  ReservedUsername.findOne.mockReturnValue(chain(null));
});

const payload = (dateOfBirth) => ({
  name: "Juan Dela Cruz",
  firstName: "Juan",
  surname: "Dela Cruz",
  email: "juan@example.com",
  password: "Sup3rSecret!",
  ...(dateOfBirth === undefined ? {} : { dateOfBirth }),
});

describe("POST /register: date of birth is required and checked on the server", () => {
  test("missing date of birth -> 400 DOB_REQUIRED, nothing created", async () => {
    const res = await request(buildApp()).post("/register").send(payload());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("DOB_REQUIRED");
    expect(User.create).not.toHaveBeenCalled();
  });

  test("14 years 364 days -> 400 AGE_UNDER_MINIMUM, nothing created, no audit, date not echoed", async () => {
    const dob = born(15, -1); // turns 15 tomorrow
    const res = await request(buildApp()).post("/register").send(payload(dob));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AGE_UNDER_MINIMUM");
    expect(JSON.stringify(res.body)).not.toContain(dob);
    expect(User.create).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  test("a malformed date -> 400 DOB_INVALID", async () => {
    const res = await request(buildApp()).post("/register").send(payload("31/12/2000"));
    expect(res.body.code).toBe("DOB_INVALID");
    expect(User.create).not.toHaveBeenCalled();
  });

  test.each([
    ["the 15th birthday", born(15), 15],
    ["17 years 364 days", born(18, -1), 17],
    ["the 18th birthday", born(18), 18],
    ["an adult", born(30), 30],
    ["31 years old (may register, just not apply to SPES)", born(31), 31],
  ])("%s -> account created with a locked date of birth", async (_label, dob) => {
    User.create.mockResolvedValue(createdDoc());
    const res = await request(buildApp()).post("/register").send(payload(dob));
    expect(res.status).toBe(201);
    const args = User.create.mock.calls[0][0];
    expect(args.dateOfBirth).toEqual(new Date(`${dob}T00:00:00.000Z`));
    expect(args.dobLockedAt).toBeInstanceOf(Date);
    expect(args.dobSource).toBe("registration");
  });

  test("the date of birth is never written to the audit log", async () => {
    User.create.mockResolvedValue(createdDoc());
    await request(buildApp()).post("/register").send(payload(born(20)));
    expect(JSON.stringify(auditEvents())).not.toContain(born(20));
  });
});

describe("POST /register/employer: 18+ attestation, no date of birth stored", () => {
  const base = { name: "Acme", email: "acme@example.com", password: "Sup3rSecret!" };

  test("without the attestation -> 400, nothing created", async () => {
    const res = await request(buildApp()).post("/register/employer").send(base);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("EMPLOYER_ADULT_ATTESTATION_REQUIRED");
    expect(User.create).not.toHaveBeenCalled();
  });

  test("with the attestation -> created, and no dateOfBirth is stored", async () => {
    User.create.mockResolvedValue(createdDoc({ role: "employer" }));
    const res = await request(buildApp()).post("/register/employer").send({ ...base, confirmAdult: true, dateOfBirth: "2000-01-01" });
    expect(res.status).toBe(201);
    expect(User.create.mock.calls[0][0]).not.toHaveProperty("dateOfBirth");
  });
});

describe("Google sign-in: a first-time jobseeker gets a pending step, nothing is created until the age passes", () => {
  const ticket = { getPayload: () => ({ sub: "g-sub-1", email: "kid@example.com", email_verified: true, name: "Kid" }) };

  const startGoogle = async (intent = "jobseeker") => {
    mockVerifyIdToken.mockResolvedValue(ticket);
    return request(buildApp()).post("/google").send({ credential: "cred", intent });
  };

  test("step 1 returns 202 DOB_REQUIRED + a short-lived token and creates nothing", async () => {
    const res = await startGoogle();
    expect(res.status).toBe(202);
    expect(res.body.code).toBe("DOB_REQUIRED");
    expect(res.body.token).toBeUndefined();
    expect(User.create).not.toHaveBeenCalled();

    const decoded = jwt.verify(res.body.pendingToken, process.env.JWT_SECRET);
    expect(decoded.purpose).toBe("google_signup");
    expect(decoded.email).toBe("kid@example.com");
    expect(decoded).not.toHaveProperty("dateOfBirth");
    expect(decoded.exp - decoded.iat).toBeLessThanOrEqual(10 * 60);
  });

  test("the pending token cannot be used as a login session", async () => {
    const res = await startGoogle();
    const decoded = jwt.verify(res.body.pendingToken, process.env.JWT_SECRET);
    expect(decoded.id).toBeUndefined(); // verifyToken looks users up by `id`
  });

  test("step 2 under 15 -> 400 AGE_UNDER_MINIMUM and nothing is created", async () => {
    const { pendingToken } = (await startGoogle()).body;
    const res = await request(buildApp()).post("/google/complete").send({ pendingToken, dateOfBirth: born(15, -1) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AGE_UNDER_MINIMUM");
    expect(User.create).not.toHaveBeenCalled();
  });

  test("step 2 with a valid date creates the account with a locked date of birth and returns a session", async () => {
    const { pendingToken } = (await startGoogle()).body;
    User.create.mockResolvedValue(
      createdDoc({ email: "kid@example.com", name: "Kid", hasCompletedOnboarding: false, onboardingComplete: false })
    );
    const res = await request(buildApp()).post("/google/complete").send({ pendingToken, dateOfBirth: born(16, 40) });
    expect(res.status).toBe(200);
    expect(res.body.isNewUser).toBe(true);
    expect(typeof res.body.token).toBe("string");
    const args = User.create.mock.calls[0][0];
    expect(args.dobSource).toBe("google_pending");
    expect(args.dobLockedAt).toBeInstanceOf(Date);
    expect(args.isEmailVerified).toBe(true);
  });

  test("step 2 rejects an expired, tampered, or wrong-purpose token", async () => {
    const expired = jwt.sign({ purpose: "google_signup", email: "a@b.co", googleId: "x", name: "A" }, process.env.JWT_SECRET, { expiresIn: -10 });
    const forged = jwt.sign({ purpose: "google_signup", email: "a@b.co", googleId: "x", name: "A" }, "another-secret");
    const wrong = jwt.sign({ id: "u1", role: "jobseeker" }, process.env.JWT_SECRET);
    for (const pendingToken of [expired, forged, wrong, ""]) {
      const res = await request(buildApp()).post("/google/complete").send({ pendingToken, dateOfBirth: born(20) });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("GOOGLE_PENDING_EXPIRED");
    }
    expect(User.create).not.toHaveBeenCalled();
  });

  test("step 2 refuses when the email was registered in the meantime", async () => {
    const { pendingToken } = (await startGoogle()).body;
    User.findOne.mockImplementation((query) =>
      query && Object.prototype.hasOwnProperty.call(query, "username") ? chain(null) : Promise.resolve({ _id: "existing" })
    );
    const res = await request(buildApp()).post("/google/complete").send({ pendingToken, dateOfBirth: born(20) });
    expect(res.status).toBe(409);
    expect(User.create).not.toHaveBeenCalled();
  });

  test("an employer button needs the 18+ attestation and stores no date of birth", async () => {
    const blocked = await startGoogle("employer");
    expect(blocked.status).toBe(400);
    expect(blocked.body.code).toBe("EMPLOYER_ADULT_ATTESTATION_REQUIRED");
    expect(User.create).not.toHaveBeenCalled();

    mockVerifyIdToken.mockResolvedValue(ticket);
    User.create.mockResolvedValue(createdDoc({ role: "employer", email: "kid@example.com" }));
    const ok = await request(buildApp()).post("/google").send({ credential: "cred", intent: "employer", confirmAdult: true });
    expect(ok.status).toBe(200);
    expect(User.create.mock.calls[0][0]).not.toHaveProperty("dateOfBirth");
  });
});

describe("the date of birth is locked after it is set", () => {
  const select = (doc) => ({ select: jest.fn().mockResolvedValue(doc) });
  const stored = (dob) => new Date(`${dob}T00:00:00.000Z`);

  test("updateProfile refuses a different date once one is stored", async () => {
    const dob = born(20);
    User.findById.mockReturnValue(select({ role: "jobseeker", dateOfBirth: stored(dob) }));
    const res = await request(buildApp({ id: "u1" })).put("/profile").send({ dateOfBirth: born(30) });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("DOB_LOCKED");
  });

  test("updateProfile ignores an unchanged date echoed back by a full-form save", async () => {
    const dob = born(20);
    User.findById.mockImplementation(() => ({
      ...select({ role: "jobseeker", dateOfBirth: stored(dob) }),
    }));
    User.findByIdAndUpdate = jest.fn().mockResolvedValue(null);
    const res = await request(buildApp({ id: "u1" })).put("/profile").send({ dateOfBirth: dob });
    expect(res.body.code).not.toBe("DOB_LOCKED");
  });

  test("onboarding never overwrites an existing date of birth", async () => {
    const dob = born(20);
    const doc = { _id: "u1", role: "jobseeker", dateOfBirth: stored(dob) };
    User.findById.mockResolvedValue(doc);
    const res = await request(buildApp({ id: "u1" })).put("/onboarding").send({ dateOfBirth: born(40), phone: "09171234567" });
    expect(res.body.code).not.toBe("DOB_INVALID");
    const touched = User.findByIdAndUpdate?.mock?.calls?.[0]?.[1];
    if (touched) expect(touched).not.toHaveProperty("dateOfBirth");
  });

  test("a legacy jobseeker with no date can set it once; it is then locked", async () => {
    User.findById.mockReturnValue(select({ role: "jobseeker", dateOfBirth: null }));
    User.updateOne.mockResolvedValue({});
    const res = await request(buildApp({ id: "u1" })).post("/me/dob").send({ dateOfBirth: born(19) });
    expect(res.status).toBe(200);
    expect(res.body.ageTier).toBe("adult18to30");
    const set = User.updateOne.mock.calls[0][1].$set;
    expect(set.dobLockedAt).toBeInstanceOf(Date);
    expect(set.dobSource).toBe("legacy_prompt");

    User.findById.mockReturnValue(select({ role: "jobseeker", dateOfBirth: stored(born(19)) }));
    const again = await request(buildApp({ id: "u1" })).post("/me/dob").send({ dateOfBirth: born(25) });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("DOB_LOCKED");
  });

  test("a legacy account that enters an under-15 date is flagged for review and the date is NOT stored", async () => {
    User.findById.mockReturnValue(select({ role: "jobseeker", dateOfBirth: null }));
    User.updateOne.mockResolvedValue({});
    const dob = born(15, -1);
    const res = await request(buildApp({ id: "u1" })).post("/me/dob").send({ dateOfBirth: dob });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AGE_UNDER_MINIMUM");
    const update = User.updateOne.mock.calls[0][1].$set;
    expect(update).toEqual({ ageReviewRequired: true });
    expect(JSON.stringify(auditEvents())).not.toContain(dob);
  });

  test("an admin changes a locked date only with a reason and proof reference; the audit stores tiers, not dates", async () => {
    const old = born(16, 40);
    const next = born(19);
    User.findById.mockReturnValue(select({ role: "jobseeker", dateOfBirth: stored(old) }));
    User.updateOne.mockResolvedValue({});

    const refused = await request(buildApp({ id: "a1", role: "admin" })).put("/admin/users/u1/dob").send({ dateOfBirth: next });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("DOB_CHANGE_PROOF_REQUIRED");

    const ok = await request(buildApp({ id: "a1", role: "admin" }))
      .put("/admin/users/u1/dob")
      .send({ dateOfBirth: next, reason: "Birth certificate shows a typing error", proofRef: "PSA-2026-001" });
    expect(ok.status).toBe(200);
    const event = auditEvents().find((a) => a.action === "user.dob.changed");
    expect(event.severity).toBe("warning");
    expect(event.metadata.previousTier).toBe("minor15to17");
    expect(event.metadata.newTier).toBe("adult18to30");
    expect(JSON.stringify(event)).not.toContain(old);
    expect(JSON.stringify(event)).not.toContain(next);
  });
});
