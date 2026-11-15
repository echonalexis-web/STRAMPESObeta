// A staff (admin/superadmin) password change through PUT /auth/profile used to
// skip the shared password policy and left every existing session valid.
// It now applies the same rules and revocation as changePassword.

jest.mock("../models/User", () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
}));
jest.mock("../models/JobseekerProfile", () => ({}));
jest.mock("../models/EmployerProfile", () => ({}));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/notificationService", () => ({ notifyManyUsers: jest.fn().mockResolvedValue([]) }));
jest.mock("../services/accountAlertService", () => ({ notifyPasswordChanged: jest.fn().mockResolvedValue(undefined) }));
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

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const express = require("express");
const request = require("supertest");
const User = require("../models/User");
const { sendPasswordChangedEmail } = require("../services/mailService");
const { logAuditEvent } = require("../services/auditService");
const authController = require("../controllers/authController");

const CURRENT = "CurrentStaff9#x";
let staff;
let savedFlag;

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: "staff-1" };
    req.app.set("io", null);
    next();
  });
  app.put("/profile", authController.updateProfile);
  return app;
};

beforeAll(async () => {
  savedFlag = process.env.USERNAME_SIGNUP_ENABLED;
  process.env.USERNAME_SIGNUP_ENABLED = "true";
  staff = { _id: "staff-1", role: "admin", username: "pesoadmin", email: "admin@example.com", password: await bcrypt.hash(CURRENT, 4), tokenVersion: 4 };
});
afterAll(() => {
  if (savedFlag === undefined) delete process.env.USERNAME_SIGNUP_ENABLED;
  else process.env.USERNAME_SIGNUP_ENABLED = savedFlag;
});

beforeEach(() => {
  jest.clearAllMocks();
  User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ ...staff }) });
  User.findByIdAndUpdate.mockImplementation(async (_id, update) =>
    update && update.$inc ? { ...staff, tokenVersion: staff.tokenVersion + update.$inc.tokenVersion } : null
  );
});

const passwordWrites = () => User.findByIdAndUpdate.mock.calls.filter(([, update]) => update && (update.password || update.$set?.password));

test.each([
  ["a common password", "Password1!", "PASSWORD_TOO_COMMON"],
  ["one containing the username", "Pesoadmin99!x", "PASSWORD_SAME_AS_USERNAME"],
])("%s is refused and nothing is written", async (_label, newPassword, code) => {
  const res = await request(buildApp()).put("/profile").send({ name: "Admin", currentPassword: CURRENT, newPassword });
  expect(res.status).toBe(400);
  expect(res.body.code).toBe(code);
  expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
});

test("reusing the current password is refused", async () => {
  const res = await request(buildApp()).put("/profile").send({ name: "Admin", currentPassword: CURRENT, newPassword: CURRENT });
  expect(res.status).toBe(400);
  expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
});

test("a wrong current password is refused", async () => {
  const res = await request(buildApp()).put("/profile").send({ name: "Admin", currentPassword: "Wrong9#xyzab", newPassword: "Zq7!mNvKwpL" });
  expect(res.status).toBe(400);
  expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
});

test("a valid change revokes old sessions and returns a fresh token", async () => {
  const res = await request(buildApp()).put("/profile").send({ name: "Admin", currentPassword: CURRENT, newPassword: "Zq7!mNvKwpL" });
  expect(res.status).toBe(200);

  const writes = passwordWrites();
  expect(writes).toHaveLength(1);
  const update = writes[0][1];
  expect(update.$inc).toEqual({ tokenVersion: 1 });
  expect(await bcrypt.compare("Zq7!mNvKwpL", update.$set.password)).toBe(true);
  expect(update.$set.mustChangePassword).toBe(false);

  const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
  expect(decoded).toMatchObject({ id: "staff-1", role: "admin", tokenVersion: 5 });

  expect(sendPasswordChangedEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "admin@example.com" }));
  expect(logAuditEvent.mock.calls.map(([e]) => e.action)).toContain("user.password.changed");
});

test("a profile save without a new password issues no token", async () => {
  const res = await request(buildApp()).put("/profile").send({ name: "Admin" });
  expect(res.status).toBe(200);
  expect(res.body.token).toBeUndefined();
  expect(passwordWrites()).toHaveLength(0);
});
