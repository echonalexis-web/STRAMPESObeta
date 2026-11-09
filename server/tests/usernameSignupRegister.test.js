// Username-only sign-up, Group A (phases 0 and 1): flag, model, register, login
// shape, limiter, scripts. Mocked models, no database, no real mail.

jest.mock("../models/User", () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  updateOne: jest.fn().mockResolvedValue({}),
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

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");

const User = require("../models/User");
const ReservedUsername = require("../models/ReservedUsername");
const JobseekerProfile = require("../models/JobseekerProfile");
const { logAuditEvent } = require("../services/auditService");
const mailService = require("../services/mailService");
const authController = require("../controllers/authController");
const { validateUserRegistration, sanitizeRequestBody } = require("../middleware/validation");
const { rejectUsernameSignupWhenDisabled, requireUsernameSignupEnabled } = require("../middleware/signupFlag");
const { buildRegisterLimiters } = require("../middleware/registerLimiter");
const { isUsernameSignupEnabled, hasVerifiedEmail } = require("../utils/usernameSignup");
const { getManilaToday } = require("../utils/age");

const chain = (value) => ({ collation: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(value) }) });

// Same middleware order as routes/authRoutes.js for POST /register.
const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.post(
    "/register",
    rejectUsernameSignupWhenDisabled,
    sanitizeRequestBody,
    validateUserRegistration,
    authController.register
  );
  // The employer route shares the validator but must ignore signupMode.
  app.post("/register/employer", validateUserRegistration, (req, res) => res.status(201).json({ reached: true }));
  app.post("/login", authController.login);
  return app;
};

const dobYearsAgo = (years) => {
  const t = getManilaToday();
  return `${t.year - years}-01-01`;
};

const usernamePayload = (overrides = {}) => ({
  signupMode: "username",
  name: "Juan Dela Cruz",
  firstName: "Juan",
  surname: "Dela Cruz",
  username: "juan_dc",
  password: "Sup3rSecret!",
  dateOfBirth: "2000-01-01",
  ...overrides,
});

const createdDoc = (overrides = {}) => ({
  _id: "newUserId123",
  name: "Juan Dela Cruz",
  role: "jobseeker",
  username: "juan_dc",
  tokenVersion: 0,
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

let existingUserForEmail;
let existingUserForUsername;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.USERNAME_SIGNUP_ENABLED = "true";
  existingUserForEmail = null;
  existingUserForUsername = null;
  User.findOne.mockImplementation((query) =>
    query && Object.prototype.hasOwnProperty.call(query, "username")
      ? chain(existingUserForUsername)
      : Promise.resolve(existingUserForEmail)
  );
  ReservedUsername.findOne.mockReturnValue(chain(null));
});

afterAll(() => {
  delete process.env.USERNAME_SIGNUP_ENABLED;
});

describe("feature flag and helpers", () => {
  test("flag is read at call time and only 'true' enables it", () => {
    delete process.env.USERNAME_SIGNUP_ENABLED;
    expect(isUsernameSignupEnabled()).toBe(false);
    process.env.USERNAME_SIGNUP_ENABLED = "1";
    expect(isUsernameSignupEnabled()).toBe(false);
    process.env.USERNAME_SIGNUP_ENABLED = " TRUE ";
    expect(isUsernameSignupEnabled()).toBe(true);
  });

  test("hasVerifiedEmail: legacy undefined is verified, only a literal false or a missing email is not", () => {
    expect(hasVerifiedEmail({ email: "a@b.co" })).toBe(true);
    expect(hasVerifiedEmail({ email: "a@b.co", isEmailVerified: true })).toBe(true);
    expect(hasVerifiedEmail({ email: "a@b.co", isEmailVerified: false })).toBe(false);
    expect(hasVerifiedEmail({ username: "x" })).toBe(false);
    expect(hasVerifiedEmail({ email: "", isEmailVerified: true })).toBe(false);
    expect(hasVerifiedEmail(null)).toBe(false);
  });

  test("requireUsernameSignupEnabled hides a feature route with 404 while the flag is off", async () => {
    const app = express();
    app.get("/x", requireUsernameSignupEnabled, (req, res) => res.json({ ok: true }));
    process.env.USERNAME_SIGNUP_ENABLED = "false";
    expect((await request(app).get("/x")).status).toBe(404);
    process.env.USERNAME_SIGNUP_ENABLED = "true";
    expect((await request(app).get("/x")).status).toBe(200);
  });
});

describe("flag OFF: nothing new is reachable", () => {
  beforeEach(() => {
    process.env.USERNAME_SIGNUP_ENABLED = "false";
  });

  test("username-mode register is refused with SIGNUP_DISABLED and touches nothing", async () => {
    const res = await request(buildApp()).post("/register").send(usernamePayload());
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SIGNUP_DISABLED");
    expect(User.findOne).not.toHaveBeenCalled();
    expect(User.create).not.toHaveBeenCalled();
    expect(JobseekerProfile.create).not.toHaveBeenCalled();
  });

  test("the controller refuses on its own too (defence in depth)", async () => {
    const app = express();
    app.use(express.json());
    app.post("/register", authController.register);
    const res = await request(app).post("/register").send(usernamePayload());
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SIGNUP_DISABLED");
    expect(User.create).not.toHaveBeenCalled();
  });

  test("email-mode register still works exactly as before", async () => {
    User.create.mockResolvedValue(createdDoc({ email: "juan@example.com" }));
    const res = await request(buildApp())
      .post("/register")
      .send({
        name: "Juan Dela Cruz",
        email: "juan@example.com",
        password: "Sup3rSecret!",
        dateOfBirth: "2000-01-01",
      });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeUndefined();
    expect(res.body.message).toMatch(/verify/i);
  });

  test("a stray signupMode other than 'username' is treated as email mode", async () => {
    const res = await request(buildApp())
      .post("/register")
      .send({ name: "Juan Dela Cruz", signupMode: "weird", password: "Sup3rSecret!", dateOfBirth: "2000-01-01" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/valid email/i);
  });
});

describe("POST /register, username mode (flag on)", () => {
  test("creates the account with no email key, sends no mail, returns a session", async () => {
    User.create.mockResolvedValue(createdDoc());
    const res = await request(buildApp()).post("/register").send(usernamePayload());

    expect(res.status).toBe(201);
    const args = User.create.mock.calls[0][0];
    expect(args).not.toHaveProperty("email");
    expect(args.username).toBe("juan_dc");
    expect(args.role).toBe("jobseeker");
    expect(args.dobSource).toBe("registration");
    expect(args.password).not.toBe("Sup3rSecret!"); // hashed

    expect(mailService.sendEmailVerification).not.toHaveBeenCalled();
    expect(mailService.sendMail).not.toHaveBeenCalled();

    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded).toMatchObject({ id: "newUserId123", role: "jobseeker", tokenVersion: 0 });
    expect(res.body.user).toMatchObject({ username: "juan_dc", email: null, hasVerifiedEmail: false });
    expect(res.body.user.isEmailVerified).toBe(true); // legacy field: never a literal false here
    expect(JSON.stringify(res.body)).not.toMatch(/"password"/);
    expect(JobseekerProfile.create).toHaveBeenCalledWith({ userId: "newUserId123" });
  });

  test("an email sent in username mode is ignored: never queried, never stored", async () => {
    User.create.mockResolvedValue(createdDoc());
    await request(buildApp()).post("/register").send(usernamePayload({ email: "someone@example.com" }));
    expect(User.create.mock.calls[0][0]).not.toHaveProperty("email");
    expect(User.findOne).not.toHaveBeenCalledWith(expect.objectContaining({ email: expect.anything() }));
  });

  test("under 15: rejected with AGE_UNDER_MINIMUM BEFORE any username or email lookup; nothing stored", async () => {
    const res = await request(buildApp()).post("/register").send(usernamePayload({ dateOfBirth: dobYearsAgo(10) }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AGE_UNDER_MINIMUM");
    expect(User.findOne).not.toHaveBeenCalled();
    expect(ReservedUsername.findOne).not.toHaveBeenCalled();
    expect(User.create).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  test("email mode: under 15 is now also rejected before the email lookup", async () => {
    const res = await request(buildApp())
      .post("/register")
      .send({ name: "Juan Dela Cruz", email: "juan@example.com", password: "Sup3rSecret!", dateOfBirth: dobYearsAgo(10) });
    expect(res.body.code).toBe("AGE_UNDER_MINIMUM");
    expect(User.findOne).not.toHaveBeenCalled();
  });

  test("15 years old is allowed", async () => {
    User.create.mockResolvedValue(createdDoc());
    const res = await request(buildApp()).post("/register").send(usernamePayload({ dateOfBirth: dobYearsAgo(16) }));
    expect(res.status).toBe(201);
  });

  test("missing date of birth -> DOB_REQUIRED", async () => {
    const payload = usernamePayload();
    delete payload.dateOfBirth;
    const res = await request(buildApp()).post("/register").send(payload);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("DOB_REQUIRED");
    expect(User.create).not.toHaveBeenCalled();
  });

  test("missing username -> USERNAME_INVALID, nothing created, no auto-suggestion", async () => {
    const payload = usernamePayload();
    delete payload.username;
    const res = await request(buildApp()).post("/register").send(payload);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "USERNAME_INVALID", field: "username" });
    expect(User.create).not.toHaveBeenCalled();
  });

  test("invalid username format -> USERNAME_INVALID", async () => {
    const res = await request(buildApp()).post("/register").send(usernamePayload({ username: "ab" }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("USERNAME_INVALID");
    expect(User.create).not.toHaveBeenCalled();
  });

  test("username taken (case-insensitive lookup result) -> USERNAME_TAKEN path via isAvailable", async () => {
    existingUserForUsername = { _id: "other" };
    const res = await request(buildApp()).post("/register").send(usernamePayload({ username: "Taken_Name" }));
    expect(res.status).toBe(400);
    expect(res.body.field).toBe("username");
    expect(User.create).not.toHaveBeenCalled();
  });

  test("race on the username index -> USERNAME_TAKEN", async () => {
    User.create.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000, keyPattern: { username: 1 } }));
    const res = await request(buildApp()).post("/register").send(usernamePayload());
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "USERNAME_TAKEN", field: "username" });
  });

  test("an E11000 on the email index in username mode (old full index still present) is a server error, NOT reported as 'Email already exists'", async () => {
    User.create.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000, keyPattern: { email: 1 } }));
    const res = await request(buildApp()).post("/register").send(usernamePayload());
    expect(res.status).toBe(500); // a stale full email index, not a user mistake
    expect(res.body.message).not.toMatch(/email already exists/i);
  });

  test("audit event records signupMode and no date of birth or password", async () => {
    User.create.mockResolvedValue(createdDoc());
    await request(buildApp()).post("/register").send(usernamePayload());
    const event = logAuditEvent.mock.calls[0][0];
    expect(event.action).toBe("auth.user.registered");
    expect(event.metadata).toEqual({ signupMode: "username" });
    expect(JSON.stringify({ ...event, req: undefined })).not.toMatch(/2000-01-01|Sup3rSecret/);
  });
});

describe("POST /register, email mode keeps its contract", () => {
  const emailPayload = {
    name: "Juan Dela Cruz",
    email: "Juan@Example.com",
    password: "Sup3rSecret!",
    dateOfBirth: "2000-01-01",
  };

  test("duplicate email still returns 'Email already exists'", async () => {
    existingUserForEmail = { _id: "x" };
    const res = await request(buildApp()).post("/register").send(emailPayload);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Email already exists");
  });

  test("race on the email index still returns 'Email already exists'", async () => {
    User.create.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000, keyPattern: { email: 1 } }));
    const res = await request(buildApp()).post("/register").send(emailPayload);
    expect(res.body.message).toBe("Email already exists");
  });

  test("a username race in email mode keeps the old response shape (no code field)", async () => {
    User.create.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000, keyPattern: { username: 1 } }));
    const res = await request(buildApp()).post("/register").send({ ...emailPayload, username: "juan_dc" });
    expect(res.body).toEqual({ message: "That username is already taken.", field: "username" });
  });

  test("success normalizes the email and still returns no token", async () => {
    User.create.mockResolvedValue(createdDoc({ email: "juan@example.com" }));
    const res = await request(buildApp()).post("/register").send(emailPayload);
    expect(res.status).toBe(201);
    expect(User.create.mock.calls[0][0].email).toBe("juan@example.com");
    expect(res.body.token).toBeUndefined();
  });
});

describe("login response shape", () => {
  const bcrypt = require("bcryptjs");

  const loginAs = async (userDoc) => {
    const password = await bcrypt.hash("Sup3rSecret!", 4);
    User.findOne.mockReturnValue({
      collation: jest.fn().mockResolvedValue({ ...userDoc, password }),
    });
    return request(buildApp()).post("/login").send({ identifier: "juan_dc", password: "Sup3rSecret!" });
  };

  test("username-only account: email null, hasVerifiedEmail false, still signs in", async () => {
    const res = await loginAs({ _id: "u1", name: "J", role: "jobseeker", username: "juan_dc", tokenVersion: 0, save: jest.fn() });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: null, username: "juan_dc", hasVerifiedEmail: false, isEmailVerified: true });
  });

  test("legacy account (isEmailVerified undefined) reports a verified email", async () => {
    const res = await loginAs({
      _id: "u2",
      name: "J",
      role: "jobseeker",
      email: "a@b.co",
      username: "juan_dc",
      tokenVersion: 0,
      save: jest.fn(),
    });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: "a@b.co", hasVerifiedEmail: true, isEmailVerified: true });
  });

  test("unverified email-mode account is still blocked at login", async () => {
    const res = await loginAs({
      _id: "u3",
      name: "J",
      role: "jobseeker",
      email: "a@b.co",
      isEmailVerified: false,
      tokenVersion: 0,
      save: jest.fn(),
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_NOT_VERIFIED");
  });
});

describe("employer route ignores signupMode", () => {
  test("signupMode username on /register/employer still requires an email", async () => {
    const res = await request(buildApp())
      .post("/register/employer")
      .send({ name: "Acme Hiring", password: "Sup3rSecret!", signupMode: "username" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/valid email/i);
  });

  test("the same body with an email passes validation", async () => {
    const res = await request(buildApp())
      .post("/register/employer")
      .send({ name: "Acme Hiring", email: "hr@acme.com", password: "Sup3rSecret!", signupMode: "username" });
    expect(res.status).toBe(201);
  });
});

describe("register limiter", () => {
  const buildLimited = (hourly) => {
    process.env.SIGNUP_LIMIT_PER_HOUR = String(hourly);
    const app = express();
    app.use(express.json());
    const limiters = buildRegisterLimiters((opts) => rateLimit(opts));
    app.use("/auth/register", limiters);
    app.post("/auth/register", (req, res) => res.status(req.body.fail ? 400 : 201).json({}));
    app.post("/auth/register/employer", (req, res) => res.status(201).json({}));
    return app;
  };

  afterEach(() => {
    delete process.env.SIGNUP_LIMIT_PER_HOUR;
  });

  test("counts successful sign-ups only, then answers 429 RATE_LIMITED", async () => {
    const app = buildLimited(2);
    expect((await request(app).post("/auth/register").send({})).status).toBe(201);
    expect((await request(app).post("/auth/register").send({ fail: true })).status).toBe(400); // failures are free
    expect((await request(app).post("/auth/register").send({})).status).toBe(201);
    const blocked = await request(app).post("/auth/register").send({});
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("RATE_LIMITED");
  });

  test("does not count /register/employer", async () => {
    const app = buildLimited(1);
    for (let i = 0; i < 3; i += 1) {
      expect((await request(app).post("/auth/register/employer").send({})).status).toBe(201);
    }
  });

  test("inactive while the flag is off", async () => {
    process.env.USERNAME_SIGNUP_ENABLED = "false";
    const app = buildLimited(1);
    for (let i = 0; i < 3; i += 1) {
      expect((await request(app).post("/auth/register").send({})).status).toBe(201);
    }
  });

  test("an invalid limit variable falls back to the default (30)", async () => {
    const app = buildLimited("abc");
    for (let i = 0; i < 5; i += 1) {
      expect((await request(app).post("/auth/register").send({})).status).toBe(201);
    }
  });
});

describe("mail guard", () => {
  test("sendMail with no recipient does nothing and never throws", async () => {
    const real = jest.requireActual("../services/mailService");
    const results = await Promise.all([
      real.sendMail({ to: undefined, subject: "s", text: "t" }),
      real.sendMail({ to: "   ", subject: "s", text: "t" }),
    ]);
    results.forEach((r) => expect(r).toEqual({ delivered: false, channel: "skipped" }));
  });
});
