// White-box branch coverage for server/middleware/auth.js.
// verifyToken.test.js already covers the 401/503 mapping; this file covers the
// remaining branches: recovery scope, staff/deactivated/banned states,
// verifyAppealToken, verifyRecoveryToken, role guards, isVerifiedEmployer and
// optionalAuth.

jest.mock("../models/User", () => ({ findById: jest.fn() }));
jest.mock("../models/SystemSettings", () => ({ getSingleton: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const SystemSettings = require("../models/SystemSettings");
const auth = require("../middleware/auth");

const SECRET = "test-secret";
const USER_ID = "507f1f77bcf86cd799439011";

const sign = (payload = {}, opts = {}) =>
  jwt.sign({ id: USER_ID, role: "jobseeker", tokenVersion: 0, ...payload }, SECRET, opts);

const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const mockUser = (row) => User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(row) });
const row = (o = {}) => ({ _id: USER_ID, isActive: true, role: "jobseeker", tokenVersion: 0, ...o });

const appWith = (...mw) => {
  const app = express();
  app.get("/x", ...mw, (req, res) => res.json({ ok: true, user: req.user }));
  return app;
};

// Calls a role guard directly with a fake req/res so no HTTP is needed.
const runGuard = (guard, user) => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const next = jest.fn();
  return Promise.resolve(guard({ user }, res, next)).then(() => ({ res, next }));
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.JWT_SECRET = SECRET;
  mockUser(row());
});

describe("verifyToken: remaining branches", () => {
  test("WB-AUTH-01 recovery-scoped token is rejected with RECOVERY_TOKEN_SCOPE", async () => {
    const res = await request(appWith(auth.verifyToken)).get("/x").set(bearer(sign({ scope: "recovery" })));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("RECOVERY_TOKEN_SCOPE");
    expect(User.findById).not.toHaveBeenCalled();
  });

  test("WB-AUTH-02 staffRecoveryPending invalidates a matching tokenVersion", async () => {
    mockUser(row({ staffRecoveryPending: true }));
    const res = await request(appWith(auth.verifyToken)).get("/x").set(bearer(sign()));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SESSION_EXPIRED");
  });

  test("WB-AUTH-03 token without a tokenVersion claim matches a user with no tokenVersion", async () => {
    mockUser(row({ tokenVersion: undefined }));
    const token = jwt.sign({ id: USER_ID, role: "jobseeker" }, SECRET);
    const res = await request(appWith(auth.verifyToken)).get("/x").set(bearer(token));
    expect(res.status).toBe(200);
  });

  test.each(["admin", "superadmin"])("WB-AUTH-04 disabled %s gets ACCOUNT_DISABLED, no appeal path", async (role) => {
    mockUser(row({ isActive: false, role, accountStatus: "suspended" }));
    const res = await request(appWith(auth.verifyToken)).get("/x").set(bearer(sign({ role })));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_DISABLED");
  });

  test("WB-AUTH-05 self-deactivated account gets ACCOUNT_DEACTIVATED", async () => {
    mockUser(row({ isActive: false, accountStatus: "deactivated" }));
    const res = await request(appWith(auth.verifyToken)).get("/x").set(bearer(sign()));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_DEACTIVATED");
  });

  test("WB-AUTH-06 banned account reports accountStatus banned with reason", async () => {
    mockUser(row({ isActive: false, accountStatus: "banned", suspensionReason: "fraud", suspendedAt: "2026-01-01" }));
    const res = await request(appWith(auth.verifyToken)).get("/x").set(bearer(sign()));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      code: "ACCOUNT_SUSPENDED",
      accountStatus: "banned",
      suspensionReason: "fraud",
      suspendedAt: "2026-01-01",
    });
  });

  test("WB-AUTH-07 suspended account without reason returns nulls", async () => {
    mockUser(row({ isActive: false, accountStatus: "suspended" }));
    const res = await request(appWith(auth.verifyToken)).get("/x").set(bearer(sign()));
    expect(res.body.accountStatus).toBe("suspended");
    expect(res.body.suspensionReason).toBeNull();
    expect(res.body.suspendedAt).toBeNull();
  });

  test("WB-AUTH-08 DB role overrides the role claim inside the token", async () => {
    mockUser(row({ role: "jobseeker", verificationStatus: "none" }));
    const res = await request(appWith(auth.verifyToken)).get("/x").set(bearer(sign({ role: "superadmin" })));
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("jobseeker");
  });

  test("WB-AUTH-09 ageReviewRequired is only true when strictly true", async () => {
    mockUser(row({ ageReviewRequired: "yes" }));
    const res = await request(appWith(auth.verifyToken)).get("/x").set(bearer(sign()));
    expect(res.body.user.ageReviewRequired).toBe(false);
    mockUser(row({ ageReviewRequired: true }));
    const res2 = await request(appWith(auth.verifyToken)).get("/x").set(bearer(sign()));
    expect(res2.body.user.ageReviewRequired).toBe(true);
  });

  test("WB-AUTH-10 Authorization header with only the scheme (no token) is 401", async () => {
    const res = await request(appWith(auth.verifyToken)).get("/x").set("Authorization", "Bearer");
    expect(res.status).toBe(401);
  });
});

describe("verifyAppealToken", () => {
  const appeal = (o = {}, opts = {}) => sign({ scope: "appeal", ...o }, opts);

  test("WB-AUTH-11 no token is 401", async () => {
    const res = await request(appWith(auth.verifyAppealToken)).get("/x");
    expect(res.status).toBe(401);
  });

  test("WB-AUTH-12 normal (unscoped) token is rejected", async () => {
    const res = await request(appWith(auth.verifyAppealToken)).get("/x").set(bearer(sign()));
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("Invalid appeal session");
  });

  test("WB-AUTH-13 unknown user is 401", async () => {
    mockUser(null);
    const res = await request(appWith(auth.verifyAppealToken)).get("/x").set(bearer(appeal()));
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("User not found");
  });

  test("WB-AUTH-14 stale tokenVersion is 403", async () => {
    mockUser(row({ tokenVersion: 2 }));
    const res = await request(appWith(auth.verifyAppealToken)).get("/x").set(bearer(appeal({ tokenVersion: 1 })));
    expect(res.status).toBe(403);
  });

  test("WB-AUTH-15 valid appeal token sets a minimal appeal-scoped req.user", async () => {
    const res = await request(appWith(auth.verifyAppealToken)).get("/x").set(bearer(appeal()));
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: USER_ID, _id: USER_ID, scope: "appeal" });
  });

  test("WB-AUTH-16 expired or forged token is 403", async () => {
    const res = await request(appWith(auth.verifyAppealToken)).get("/x").set(bearer(appeal({}, { expiresIn: -10 })));
    expect(res.status).toBe(403);
    const res2 = await request(appWith(auth.verifyAppealToken)).get("/x").set(bearer("garbage"));
    expect(res2.status).toBe(403);
  });
});

describe("verifyRecoveryToken", () => {
  const rec = (o = {}, opts = {}) => sign({ scope: "recovery", ...o }, opts);

  test("WB-AUTH-17 no token is 401", async () => {
    const res = await request(appWith(auth.verifyRecoveryToken)).get("/x");
    expect(res.status).toBe(401);
  });

  test("WB-AUTH-18 normal and appeal tokens are rejected", async () => {
    const r1 = await request(appWith(auth.verifyRecoveryToken)).get("/x").set(bearer(sign()));
    const r2 = await request(appWith(auth.verifyRecoveryToken)).get("/x").set(bearer(sign({ scope: "appeal" })));
    expect(r1.status).toBe(403);
    expect(r2.status).toBe(403);
  });

  test("WB-AUTH-19 unknown user is 401", async () => {
    mockUser(null);
    const res = await request(appWith(auth.verifyRecoveryToken)).get("/x").set(bearer(rec()));
    expect(res.status).toBe(401);
  });

  test("WB-AUTH-20 stale recovery token (tokenVersion bumped) is 403", async () => {
    mockUser(row({ tokenVersion: 5 }));
    const res = await request(appWith(auth.verifyRecoveryToken)).get("/x").set(bearer(rec({ tokenVersion: 4 })));
    expect(res.status).toBe(403);
  });

  test("WB-AUTH-21 valid recovery token sets recovery-scoped req.user with DB role", async () => {
    mockUser(row({ role: "admin" }));
    const res = await request(appWith(auth.verifyRecoveryToken)).get("/x").set(bearer(rec()));
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: USER_ID, _id: USER_ID, role: "admin", scope: "recovery" });
  });

  test("WB-AUTH-22 expired or forged token is 403", async () => {
    const res = await request(appWith(auth.verifyRecoveryToken)).get("/x").set(bearer(rec({}, { expiresIn: -10 })));
    expect(res.status).toBe(403);
    const res2 = await request(appWith(auth.verifyRecoveryToken)).get("/x").set(bearer("garbage"));
    expect(res2.status).toBe(403);
  });
});

describe("role guards", () => {
  const cases = [
    ["isJobseeker", ["jobseeker", "employee", "resident"], ["employer", "admin", "superadmin"]],
    ["isEmployee", ["employee"], ["jobseeker", "resident", "employer", "admin"]],
    ["isEmployer", ["employer"], ["jobseeker", "employee", "admin", "superadmin"]],
    ["isEmployeeOrJobseeker", ["jobseeker", "employee", "resident"], ["employer", "admin"]],
    ["isAdmin", ["admin", "superadmin"], ["jobseeker", "employer", "employee"]],
    ["isSuperadmin", ["superadmin"], ["admin", "employer", "jobseeker"]],
  ];

  test.each(cases)("WB-ROLE %s allows only the intended roles", async (name, allowed, denied) => {
    for (const role of allowed) {
      const { res, next } = await runGuard(auth[name], { role });
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    }
    for (const role of denied) {
      const { res, next } = await runGuard(auth[name], { role });
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    }
  });

  test("WB-ROLE-07 authorizeRoles allows listed roles, denies others and an empty list", async () => {
    const guard = auth.authorizeRoles("admin", "employer");
    expect((await runGuard(guard, { role: "employer" })).next).toHaveBeenCalled();
    const denied = await runGuard(guard, { role: "jobseeker" });
    expect(denied.next).not.toHaveBeenCalled();
    expect(denied.res.status).toHaveBeenCalledWith(403);
    const none = await runGuard(auth.authorizeRoles(), { role: "admin" });
    expect(none.res.status).toHaveBeenCalledWith(403);
  });

  test("WB-ROLE-08 a role string that is a substring of an allowed one does not match", async () => {
    const { next, res } = await runGuard(auth.authorizeRoles("superadmin"), { role: "admin" });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe("isVerifiedEmployer", () => {
  test("WB-VER-01 non-employer is 403 before settings are read", async () => {
    const { res, next } = await runGuard(auth.isVerifiedEmployer, { role: "jobseeker" });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    expect(SystemSettings.getSingleton).not.toHaveBeenCalled();
  });

  test("WB-VER-02 verification required and employer verified passes", async () => {
    SystemSettings.getSingleton.mockResolvedValue({ requireEmployerVerification: true });
    const { next } = await runGuard(auth.isVerifiedEmployer, { role: "employer", verificationStatus: "verified" });
    expect(next).toHaveBeenCalled();
  });

  test.each(["pending", "rejected", undefined])("WB-VER-03 verification required, status %s is 403", async (status) => {
    SystemSettings.getSingleton.mockResolvedValue({ requireEmployerVerification: true });
    const { res, next } = await runGuard(auth.isVerifiedEmployer, { role: "employer", verificationStatus: status });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test("WB-VER-04 superadmin turned verification off: unverified employer passes", async () => {
    SystemSettings.getSingleton.mockResolvedValue({ requireEmployerVerification: false });
    const { next } = await runGuard(auth.isVerifiedEmployer, { role: "employer", verificationStatus: "pending" });
    expect(next).toHaveBeenCalled();
  });

  test("WB-VER-05 settings lookup failure fails safe (still required)", async () => {
    SystemSettings.getSingleton.mockRejectedValue(new Error("db down"));
    const { res, next } = await runGuard(auth.isVerifiedEmployer, { role: "employer", verificationStatus: "pending" });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test("WB-VER-06 missing flag in settings defaults to required", async () => {
    SystemSettings.getSingleton.mockResolvedValue({});
    const { res } = await runGuard(auth.isVerifiedEmployer, { role: "employer", verificationStatus: "pending" });
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe("optionalAuth", () => {
  test("WB-OPT-01 no token continues anonymously", async () => {
    const res = await request(appWith(auth.optionalAuth)).get("/x");
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });

  test("WB-OPT-02 valid token populates req.user from DB", async () => {
    mockUser(row({ role: "employer", verificationStatus: "verified" }));
    const res = await request(appWith(auth.optionalAuth)).get("/x").set(bearer(sign()));
    expect(res.body.user).toMatchObject({ id: USER_ID, role: "employer", verificationStatus: "verified" });
  });

  test("WB-OPT-03 unknown user, inactive user and stale tokenVersion all degrade to anonymous", async () => {
    mockUser(null);
    expect((await request(appWith(auth.optionalAuth)).get("/x").set(bearer(sign()))).body.user).toBeNull();
    mockUser(row({ isActive: false }));
    expect((await request(appWith(auth.optionalAuth)).get("/x").set(bearer(sign()))).body.user).toBeNull();
    mockUser(row({ tokenVersion: 9 }));
    expect((await request(appWith(auth.optionalAuth)).get("/x").set(bearer(sign({ tokenVersion: 1 })))).body.user).toBeNull();
  });

  test("WB-OPT-04 invalid token and DB error degrade to anonymous (never block)", async () => {
    const bad = await request(appWith(auth.optionalAuth)).get("/x").set(bearer("garbage"));
    expect(bad.status).toBe(200);
    expect(bad.body.user).toBeNull();
    User.findById.mockReturnValue({ select: jest.fn().mockRejectedValue(new Error("db down")) });
    const dbErr = await request(appWith(auth.optionalAuth)).get("/x").set(bearer(sign()));
    expect(dbErr.status).toBe(200);
    expect(dbErr.body.user).toBeNull();
  });
});
