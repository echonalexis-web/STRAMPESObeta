// Who can reach soft delete / restore / preview, on both /api and /api/v1 style mounts.

jest.mock("../models/User", () => ({ findById: jest.fn() }));
jest.mock("../models/SystemSettings", () => ({ getSingleton: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue() }));
jest.mock("../services/userDeletionService", () => {
  const actual = jest.requireActual("../services/userDeletionService");
  return { ...actual, softDeleteUser: jest.fn(), restoreUser: jest.fn(), getGraceDays: jest.fn() };
});

// Budgets are built when the router loads, so this must be set before the require below.
process.env.DISABLE_RATE_LIMITS = "true";

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const svc = require("../services/userDeletionService");
const { logAuditEvent } = require("../services/auditService");

const ACTOR = "111111111111111111111111";
const TARGET = "222222222222222222222222";

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.app.set("io", null); next(); });
const router = require("../routes/adminRoutes");
app.use("/api/admin", router);
app.use("/api/v1/admin", router);

const as = (role) => {
  User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ role, isActive: true, tokenVersion: 0 }) });
  return "Bearer " + jwt.sign({ id: ACTOR }, process.env.JWT_SECRET);
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.JWT_SECRET = "local-test-secret";
  process.env.DISABLE_RATE_LIMITS = "true";
  svc.softDeleteUser.mockResolvedValue({
    user: { role: "jobseeker" }, summary: {}, deletedAt: new Date(), purgeAfter: new Date(), graceDays: 30, reason: "other", note: null,
  });
  svc.restoreUser.mockResolvedValue({ user: {} });
  svc.getGraceDays.mockResolvedValue(30);
});

const calls = [
  ["DELETE", `/users/${TARGET}`, { reason: "other", confirm: "x" }],
  ["POST", `/users/${TARGET}/restore`, {}],
  ["GET", `/users/${TARGET}/delete-preview`, undefined],
];
const send = (prefix, [method, path, body], token) => {
  let r = request(app)[method.toLowerCase()](`${prefix}${path}`);
  if (token) r = r.set("Authorization", token);
  return body ? r.send(body) : r;
};

describe.each(["/api/admin", "/api/v1/admin"])("%s soft delete routes", (prefix) => {
  test.each(calls)("%s %s rejects a request with no token", async (...call) => {
    const res = await send(prefix, call, null);
    expect([401, 403]).toContain(res.status);
    expect(svc.softDeleteUser).not.toHaveBeenCalled();
    expect(svc.restoreUser).not.toHaveBeenCalled();
  });

  test.each(calls)("%s %s is 403 for admin, employer and jobseeker", async (...call) => {
    for (const role of ["admin", "employer", "jobseeker"]) {
      const res = await send(prefix, call, as(role));
      expect(res.status).toBe(403);
    }
    expect(svc.softDeleteUser).not.toHaveBeenCalled();
    expect(svc.restoreUser).not.toHaveBeenCalled();
  });

  test("a superadmin can delete (audited) and restore", async () => {
    const del = await send(prefix, calls[0], as("superadmin"));
    expect(del.status).toBe(200);
    expect(del.body).not.toHaveProperty("user");
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.user.soft_deleted" }));

    const restore = await send(prefix, calls[1], as("superadmin"));
    expect(restore.status).toBe(200);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.user.restored" }));
  });

  test("the preview is read only and returns no personal fields beyond the confirmation target", async () => {
    svc.softDeleteUser.mockResolvedValue({ user: { role: "jobseeker", name: "Juan", username: "juan.dc", email: null, password: "x" }, summary: { applications: 1 } });
    const res = await send(prefix, calls[2], as("superadmin"));
    expect(res.status).toBe(200);
    expect(svc.softDeleteUser).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    expect(JSON.stringify(res.body)).not.toMatch(/password/);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
