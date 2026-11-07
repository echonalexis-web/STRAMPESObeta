// Registration-time username choice (register() and registerEmployer()).
// Mocks every model/service these two controllers touch, same pattern as
// tests/accountRecovery.test.js — there's no DB harness in this project.
// utils/username.js itself is NOT mocked (only the models it queries), so
// these exercise the real validation/availability wiring, not just "was a
// mock called with the right args".

jest.mock("../models/User", () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
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
  sendPasswordResetEmail: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
  sendPasswordChangedEmail: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
  sendPasswordAddedEmail: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
  sendEmailVerification: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
  sendEmailChangeVerification: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
  sendEmailChangeAlert: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
  sendRecoveryEmailVerification: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
  sendRecoveryEmailAlert: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
  sendBackupCodesGeneratedEmail: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
  sendBackupCodeRedeemedEmail: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
}));
jest.mock("../utils/logger", () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const express = require("express");
const request = require("supertest");
const User = require("../models/User");
const ReservedUsername = require("../models/ReservedUsername");
const authController = require("../controllers/authController");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

// A chained `.collation().select()` shape — what utils/username.js's
// isAvailable() expects back from User.findOne({ username }).
const chain = (resolvedValue) => ({
  collation: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(resolvedValue) }),
});

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.post("/register", authController.register);
  app.post("/register/employer", authController.registerEmployer);
  return app;
};

const createdDoc = (overrides = {}) => ({
  _id: "newUserId123",
  name: "Juan Dela Cruz",
  email: "juan@example.com",
  role: overrides.role || "jobseeker",
  username: overrides.username || null,
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

// User.findOne is called in two genuinely different shapes by the code
// under test: a plain `await User.findOne({ email })` for the
// pre-registration uniqueness check, and a chained
// `User.findOne({ username }).collation(...).select(...)` from
// utils/username.js's isAvailable() — used both by a chosen username AND,
// later, by the post-creation auto-suggestion fallback. Returning the same
// shape for both would break one or the other (a chained-shape object isn't
// awaitable as a plain value; a resolved promise has no .collation method).
// One implementation branches on which query shape was actually passed;
// each test only needs to set what the two outcomes should be.
let existingUserForEmail;
let existingUserForUsername;

beforeEach(() => {
  jest.clearAllMocks();
  existingUserForEmail = null;
  existingUserForUsername = null;
  User.findOne.mockImplementation((query) =>
    query && Object.prototype.hasOwnProperty.call(query, "username")
      ? chain(existingUserForUsername)
      : Promise.resolve(existingUserForEmail)
  );
  User.find.mockReturnValue({ select: jest.fn().mockResolvedValue([]) }); // registerEmployer's admin lookup
  ReservedUsername.findOne.mockReturnValue(chain(null));
});

describe("POST /register — username choice", () => {
  const basePayload = {
    name: "Juan Dela Cruz",
    firstName: "Juan",
    surname: "Dela Cruz",
    email: "juan@example.com",
    password: "Sup3rSecret!",
  };

  test("no username provided: account is created without one, and auto-suggestion is attempted afterward", async () => {
    User.create.mockResolvedValue(createdDoc());

    const res = await request(buildApp()).post("/register").send(basePayload);

    expect(res.status).toBe(201);
    const createArgs = User.create.mock.calls[0][0];
    expect(createArgs).not.toHaveProperty("username");
    // Auto-suggestion runs after creation and checks availability via the
    // chained username query — confirms the fallback was actually attempted,
    // not skipped.
    expect(User.findOne).toHaveBeenCalledWith(expect.objectContaining({ username: expect.anything() }));
  });

  test("a valid, available username is set directly on the created account, skipping auto-suggestion", async () => {
    User.create.mockResolvedValue(createdDoc({ username: "juan_delacruz" }));

    const res = await request(buildApp())
      .post("/register")
      .send({ ...basePayload, username: "Juan_DelaCruz" }); // mixed case on input

    expect(res.status).toBe(201);
    const createArgs = User.create.mock.calls[0][0];
    expect(createArgs.username).toBe("juan_delacruz"); // normalized
  });

  test("an invalid username format is rejected before any account is created", async () => {
    const res = await request(buildApp()).post("/register").send({ ...basePayload, username: "ab" });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe("username");
    expect(User.create).not.toHaveBeenCalled();
  });

  test("an already-taken username is rejected before any account is created", async () => {
    existingUserForUsername = { _id: "someone-else" };

    const res = await request(buildApp()).post("/register").send({ ...basePayload, username: "taken_name" });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe("username");
    expect(res.body.message).toMatch(/already taken/i);
    expect(User.create).not.toHaveBeenCalled();
  });

  test("a race where the username is taken between the check and creation surfaces the right field, not 'email exists'", async () => {
    // isAvailable() said it was free (existingUserForUsername stays null);
    // the database's own unique index is what actually catches the race.
    const dupError = Object.assign(new Error("E11000 duplicate key"), {
      code: 11000,
      keyPattern: { username: 1 },
    });
    User.create.mockRejectedValue(dupError);

    const res = await request(buildApp())
      .post("/register")
      .send({ ...basePayload, username: "raced_name" });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe("username");
    expect(res.body.message).toMatch(/already taken/i);
  });

  test("an unrelated duplicate-key error (email) still reports the email message, not username", async () => {
    const dupError = Object.assign(new Error("E11000 duplicate key"), {
      code: 11000,
      keyPattern: { email: 1 },
    });
    User.create.mockRejectedValue(dupError);

    const res = await request(buildApp())
      .post("/register")
      .send({ ...basePayload, username: "some_name" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Email already exists");
    expect(res.body.field).toBeUndefined();
  });
});

describe("POST /register/employer — username choice", () => {
  const basePayload = {
    name: "Acme Corp",
    email: "acme@example.com",
    password: "Sup3rSecret!",
  };

  test("a valid, available username is set directly on the created employer account", async () => {
    User.create.mockResolvedValue(createdDoc({ role: "employer", username: "acme_corp" }));

    const res = await request(buildApp())
      .post("/register/employer")
      .send({ ...basePayload, username: "acme_corp" });

    expect(res.status).toBe(201);
    expect(User.create.mock.calls[0][0].username).toBe("acme_corp");
  });

  test("an already-taken username is rejected before any account is created", async () => {
    existingUserForUsername = { _id: "someone-else" };

    const res = await request(buildApp())
      .post("/register/employer")
      .send({ ...basePayload, username: "taken_name" });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe("username");
    expect(User.create).not.toHaveBeenCalled();
  });
});
