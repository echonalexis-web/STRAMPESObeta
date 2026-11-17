// rev 3: with the username sign-up feature on, a jobseeker needs a plausible
// phone number to finish onboarding (the browser asks for it; this is the server
// enforcing it). Format check only. Mocked models.

jest.mock("../models/User", () => ({
  findById: jest.fn(),
  findOne: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock("../models/ReservedUsername", () => ({ findOne: jest.fn() }));
jest.mock("../models/JobseekerProfile", () => ({ findOneAndUpdate: jest.fn().mockResolvedValue({}), findOne: jest.fn().mockResolvedValue({}), create: jest.fn() }));
jest.mock("../models/EmployerProfile", () => ({ findOneAndUpdate: jest.fn().mockResolvedValue({}), findOne: jest.fn().mockResolvedValue({}), create: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/notificationService", () => ({ notifyManyUsers: jest.fn().mockResolvedValue([]) }));
jest.mock("../services/mailService", () => new Proxy({}, { get: () => jest.fn().mockResolvedValue({}) }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const express = require("express");
const request = require("supertest");
const User = require("../models/User");
const authController = require("../controllers/authController");

const app = () => {
  const a = express();
  a.use(express.json());
  a.use((req, res, next) => {
    req.user = { id: "507f1f77bcf86cd799439011", role: "jobseeker" };
    next();
  });
  a.put("/profile", authController.updateProfile);
  return a;
};

const currentUser = (extra = {}) => ({ role: "jobseeker", password: "x", verificationStatus: "unverified", dateOfBirth: new Date(Date.UTC(2000, 0, 1)), phone: null, ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.USERNAME_SIGNUP_ENABLED = "true";
  User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(currentUser()) });
  User.findByIdAndUpdate.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: "u1", role: "jobseeker", toObject: () => ({}) }) });
});
afterAll(() => {
  delete process.env.USERNAME_SIGNUP_ENABLED;
});

const finish = (body) => request(app()).put("/profile").send({ onboardingComplete: true, ...body });

describe("finishing onboarding (flag on)", () => {
  test("no phone anywhere -> 400 PHONE_REQUIRED, and nothing is saved", async () => {
    const res = await finish({});
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "PHONE_REQUIRED", field: "phone" });
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("an invalid phone in the same request -> 400 with the specific phone code (field phone)", async () => {
    const res = await finish({ phone: "12345" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PHONE_PH_FORMAT");
    expect(res.body.field).toBe("phone");
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("a blank phone sent with the request replaces the saved one, so it is refused", async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(currentUser({ phone: "09171234567" })) });
    const res = await finish({ phone: "" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PHONE_REQUIRED");
  });

  test("a valid phone already on file lets the request through", async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(currentUser({ phone: "09171234567" })) });
    const res = await finish({});
    expect(res.status).not.toBe(400);
    expect(User.findByIdAndUpdate).toHaveBeenCalled();
    const update = User.findByIdAndUpdate.mock.calls[0][1];
    expect(JSON.stringify(update)).toContain("hasCompletedOnboarding");
  });

  test("a valid phone in the same request lets it through", async () => {
    const res = await finish({ phone: "+63 917 123 4567" });
    expect(res.status).not.toBe(400);
    expect(User.findByIdAndUpdate).toHaveBeenCalled();
  });

  test("the profile query now loads the phone", async () => {
    await finish({ phone: "09171234567" });
    expect(User.findById.mock.results[0].value.select.mock.calls[0][0]).toMatch(/\bphone\b/);
  });
});

describe("flag OFF or other roles: nothing changes", () => {
  test("flag off: finishing onboarding with no phone still works as before", async () => {
    process.env.USERNAME_SIGNUP_ENABLED = "false";
    const res = await finish({});
    expect(res.status).not.toBe(400);
    expect(User.findByIdAndUpdate).toHaveBeenCalled();
  });

  test("an employer finishing onboarding is not asked for a jobseeker phone", async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(currentUser({ role: "employer" })) });
    const res = await finish({});
    expect(res.status).not.toBe(400);
  });

  test("an ordinary profile edit (not finishing onboarding) with no phone is untouched", async () => {
    const res = await request(app()).put("/profile").send({ about: "Hello" });
    expect(res.status).not.toBe(400);
  });
});
