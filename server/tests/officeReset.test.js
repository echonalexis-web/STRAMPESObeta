// Staff-assisted password reset at the counter (rev 3). Mocked models, no real mail.

jest.mock("../models/User", () => ({ findById: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock("../models/RateLimitCounter", () => ({ findOneAndUpdate: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/sessionService", () => ({ forceLogout: jest.fn() }));
jest.mock("../services/accountAlertService", () => ({ notifyPasswordResetByStaff: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/mailService", () => ({ sendPasswordChangedEmail: jest.fn().mockResolvedValue({}) }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const express = require("express");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const RateLimitCounter = require("../models/RateLimitCounter");
const { logAuditEvent } = require("../services/auditService");
const { forceLogout } = require("../services/sessionService");
const { notifyPasswordResetByStaff } = require("../services/accountAlertService");
const { sendPasswordChangedEmail } = require("../services/mailService");
const { generateTemporaryPassword } = require("../services/officeResetService");
const { validatePassword } = require("../utils/passwordPolicy");
const { resetPasswordAtCounter } = require("../controllers/officeResetController");
const { staffResetBudget } = require("../middleware/budgets");

const STAFF_ID = "507f1f77bcf86cd799439001";
const TARGET_ID = "507f1f77bcf86cd799439002";
const STAFF_PASSWORD = "Staff#Password1";

let staffHash;
beforeAll(async () => {
  staffHash = await bcrypt.hash(STAFF_PASSWORD, 4);
});

const target = (extra = {}) => ({
  _id: TARGET_ID,
  role: "jobseeker",
  isActive: true,
  username: "juan_dc",
  name: "Juan",
  dateOfBirth: new Date(Date.UTC(2000, 0, 15)),
  ...extra,
});
const selectable = (value) => ({ select: jest.fn().mockResolvedValue(value) });

const app = (role = "admin") => {
  const a = express();
  a.use(express.json());
  a.use((req, res, next) => {
    req.user = { id: STAFF_ID, role };
    next();
  });
  a.post("/users/:id/reset-password", resetPasswordAtCounter);
  return a;
};

const goodBody = {
  reason: "Showed a valid Passport at the counter",
  idChecked: true,
  idTypePresented: "Passport",
  staffPassword: STAFF_PASSWORD,
};
const post = (body = goodBody, role) => request(app(role)).post(`/users/${TARGET_ID}/reset-password`).send(body);

beforeEach(() => {
  jest.clearAllMocks();
  process.env.USERNAME_SIGNUP_ENABLED = "true";
  User.findById.mockImplementation((id) =>
    selectable(String(id) === STAFF_ID ? { _id: STAFF_ID, role: "admin", password: staffHash } : target())
  );
  User.findOneAndUpdate.mockImplementation(async (filter, update) => ({ _id: TARGET_ID, mustChangePassword: update.$set.mustChangePassword }));
});
afterAll(() => {
  delete process.env.USERNAME_SIGNUP_ENABLED;
});

describe("temporary password", () => {
  test("always meets the policy, is 14 characters, and never contains the username", () => {
    for (let i = 0; i < 300; i += 1) {
      const p = generateTemporaryPassword({ username: "juan_dc", dateOfBirth: new Date(Date.UTC(2000, 0, 15)) });
      expect(p).toHaveLength(14);
      expect(validatePassword({ password: p, username: "juan_dc", usernameOnly: true }).ok).toBe(true);
      expect(p.toLowerCase()).not.toContain("juan_dc");
      expect(p).not.toMatch(/[0O1lI]/);
    }
  });

  test("is different every time", () => {
    const set = new Set(Array.from({ length: 50 }, () => generateTemporaryPassword({})));
    expect(set.size).toBe(50);
  });
});

describe("POST /users/:id/reset-password", () => {
  test("resets: temporary password hashed, forced change, sessions out, lock and code cleared, backup codes invalidated", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(true);
    expect(res.headers["cache-control"]).toMatch(/no-store/);

    const temp = res.body.temporaryPassword;
    expect(temp).toHaveLength(14);
    const [filter, update] = User.findOneAndUpdate.mock.calls[0];
    expect(filter._id).toBe(TARGET_ID);
    expect(filter.role.$in).toEqual(expect.arrayContaining(["jobseeker"]));
    expect(await bcrypt.compare(temp, update.$set.password)).toBe(true); // stored only as a hash
    expect(update.$set.password).not.toBe(temp);
    expect(update.$set).toMatchObject({ mustChangePassword: true, backupCodes: [], backupCodesGeneratedAt: null, passwordResetToken: null });
    expect(update.$unset).toEqual({ loginLock: 1, emailCode: 1 });
    expect(update.$inc).toEqual({ tokenVersion: 1 });

    expect(forceLogout).toHaveBeenCalledWith(undefined, TARGET_ID, expect.objectContaining({ code: "SESSION_EXPIRED" }));
    expect(notifyPasswordResetByStaff).toHaveBeenCalledWith(TARGET_ID, expect.anything());
  });

  test("the audit event has the actor, the ID type and the reason, and never the passwords or the date of birth", async () => {
    const res = await post();
    const event = logAuditEvent.mock.calls[0][0];
    expect(event).toMatchObject({ action: "auth.password.reset_by_staff", actorId: STAFF_ID, targetUserId: TARGET_ID, severity: "critical" });
    expect(event.metadata).toEqual({ idType: "Passport", reason: "Showed a valid Passport at the counter" });
    const text = JSON.stringify({ ...event, req: undefined });
    expect(text).not.toContain(res.body.temporaryPassword);
    expect(text).not.toContain(STAFF_PASSWORD);
    expect(text).not.toMatch(/2000-01-15/);
  });

  test("a staff member's own password is required", async () => {
    const wrong = await post({ ...goodBody, staffPassword: "nope" });
    expect(wrong.status).toBe(403);
    expect(wrong.body.code).toBe("STAFF_PASSWORD_INCORRECT");
    const missing = await post({ ...goodBody, staffPassword: undefined });
    expect(missing.status).toBe(403);
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test.each([
    ["no reason", { reason: undefined }, "RESET_REASON_REQUIRED"],
    ["a short reason", { reason: "too short" }, "RESET_REASON_REQUIRED"],
    ["the ID check not confirmed", { idChecked: false }, "ID_CHECK_REQUIRED"],
    ["the ID check as a string", { idChecked: "true" }, "ID_CHECK_REQUIRED"],
    ["no ID type", { idTypePresented: undefined }, "ID_TYPE_REQUIRED"],
    ["an unknown ID type", { idTypePresented: "Library card" }, "ID_TYPE_REQUIRED"],
  ])("refused with %s", async (_, override, code) => {
    const res = await post({ ...goodBody, ...override });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(code);
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("works for the admin and the superadmin (both are PESO staff behind the admin guard)", async () => {
    expect((await post(goodBody, "admin")).status).toBe(200);
    expect((await post(goodBody, "superadmin")).status).toBe(200);
  });

  test("only jobseeker accounts: staff and employers are refused", async () => {
    for (const role of ["admin", "superadmin", "employer"]) {
      User.findById.mockImplementation((id) =>
        selectable(String(id) === STAFF_ID ? { _id: STAFF_ID, role: "admin", password: staffHash } : target({ role }))
      );
      const res = await post();
      expect(res.status).toBe(404);
    }
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("not for a suspended account or one with a PESO recovery in progress", async () => {
    const setTarget = (extra) =>
      User.findById.mockImplementation((id) =>
        selectable(String(id) === STAFF_ID ? { _id: STAFF_ID, role: "admin", password: staffHash } : target(extra))
      );
    setTarget({ isActive: false });
    expect((await post()).status).toBe(409);
    setTarget({ staffRecoveryPending: true });
    expect((await post()).status).toBe(409);
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("flag OFF: an account with an email is unreachable, an account with no email can still be helped", async () => {
    process.env.USERNAME_SIGNUP_ENABLED = "false";
    const setTarget = (extra) =>
      User.findById.mockImplementation((id) =>
        selectable(String(id) === STAFF_ID ? { _id: STAFF_ID, role: "admin", password: staffHash } : target(extra))
      );
    setTarget({ email: "juan@example.com" });
    expect((await post()).status).toBe(404);
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();

    setTarget({});
    expect((await post()).status).toBe(200);
  });

  test("an account that has an email also gets a notice mail; one without does not", async () => {
    User.findById.mockImplementation((id) =>
      selectable(String(id) === STAFF_ID ? { _id: STAFF_ID, role: "admin", password: staffHash } : target({ email: "juan@example.com" }))
    );
    await post();
    expect(sendPasswordChangedEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "juan@example.com" }));

    jest.clearAllMocks();
    User.findById.mockImplementation((id) =>
      selectable(String(id) === STAFF_ID ? { _id: STAFF_ID, role: "admin", password: staffHash } : target())
    );
    User.findOneAndUpdate.mockResolvedValue({ _id: TARGET_ID, mustChangePassword: true });
    await post();
    expect(sendPasswordChangedEmail).not.toHaveBeenCalled();
  });
});

describe("per-admin hourly cap and route placement", () => {
  test("the cap is per staff member and always on (not flag dependent)", async () => {
    process.env.USERNAME_SIGNUP_ENABLED = "false";
    process.env.STAFF_RESET_HOURLY_CAP = "2";
    const { buildAccountBudget } = require("../middleware/accountBudget");
    let n = 0;
    const model = { findOneAndUpdate: jest.fn(async () => ({ count: ++n })) };
    const budget = buildAccountBudget({ name: "staff-reset-test", windowMs: 3600000, envName: "STAFF_RESET_HOURLY_CAP", defaultMax: 20, code: "RATE_LIMITED", message: "m", alwaysOn: true, model });
    const run = async () => {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), set: jest.fn() };
      const next = jest.fn();
      await budget({ user: { id: STAFF_ID } }, res, next);
      return { res, next };
    };
    expect((await run()).next).toHaveBeenCalledWith();
    expect((await run()).next).toHaveBeenCalledWith();
    expect((await run()).res.status).toHaveBeenCalledWith(429);
    delete process.env.STAFF_RESET_HOURLY_CAP;
  });

  test("the real admin route has the budget before the controller, behind the admin guard", () => {
    const adminRoutes = require("../routes/adminRoutes");
    const layer = adminRoutes.stack.find((l) => l.route && l.route.path === "/users/:id/reset-password" && l.route.methods.post);
    expect(layer).toBeTruthy();
    const handles = layer.route.stack.map((l) => l.handle);
    expect(handles).toContain(staffResetBudget);
    expect(handles.indexOf(staffResetBudget)).toBeLessThan(handles.indexOf(resetPasswordAtCounter));
    const firstRoute = adminRoutes.stack.findIndex((l) => l.route);
    expect(adminRoutes.stack.slice(0, firstRoute).length).toBeGreaterThanOrEqual(2); // protect + isAdmin
  });
});
