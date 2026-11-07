// E-03: devResetUrl / devVerifyUrl must never be returned unless
// EXPOSE_DEV_LINKS=true — in particular not when NODE_ENV is unset or
// anything other than "production".

jest.mock("../models/User", () => ({ findOne: jest.fn() }));
jest.mock("../services/mailService", () => ({
  sendPasswordResetEmail: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
  sendEmailVerification: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
}));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));

const express = require("express");
const request = require("supertest");

const User = require("../models/User");
const authController = require("../controllers/authController");

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.post("/forgot-password", authController.forgotPassword);
  app.post("/resend-verification", authController.resendEmailVerification);
  return app;
};

const buildUserDoc = (overrides = {}) => ({
  _id: "507f1f77bcf86cd799439011",
  email: "jobseeker@example.com",
  name: "Juan Dela Cruz",
  role: "jobseeker",
  isEmailVerified: false,
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe("dev link exposure (E-03)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    User.findOne.mockResolvedValue(buildUserDoc());
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const nodeEnvs = [undefined, "development", "test", "production"];

  test.each(nodeEnvs)("forgot-password omits devResetUrl by default (NODE_ENV=%s)", async (nodeEnv) => {
    delete process.env.EXPOSE_DEV_LINKS;
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;

    const res = await request(buildApp()).post("/forgot-password").send({ email: "jobseeker@example.com" });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("devResetUrl");
  });

  test.each(nodeEnvs)("resend-verification omits devVerifyUrl by default (NODE_ENV=%s)", async (nodeEnv) => {
    delete process.env.EXPOSE_DEV_LINKS;
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;

    const res = await request(buildApp()).post("/resend-verification").send({ email: "jobseeker@example.com" });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("devVerifyUrl");
  });

  test.each(["false", "1", "TRUE", ""])("a non-exact flag value (%p) does not expose the link", async (value) => {
    process.env.EXPOSE_DEV_LINKS = value;

    const res = await request(buildApp()).post("/forgot-password").send({ email: "jobseeker@example.com" });

    expect(res.body).not.toHaveProperty("devResetUrl");
  });

  test("EXPOSE_DEV_LINKS=true returns both links", async () => {
    process.env.EXPOSE_DEV_LINKS = "true";

    const forgot = await request(buildApp()).post("/forgot-password").send({ email: "jobseeker@example.com" });
    const resend = await request(buildApp()).post("/resend-verification").send({ email: "jobseeker@example.com" });

    expect(forgot.body.devResetUrl).toMatch(/\/reset-password\?token=/);
    expect(resend.body.devVerifyUrl).toMatch(/\/confirm-email\?token=/);
  });
});
