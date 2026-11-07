// Phase 4 — recovery email + backup codes (see
// markdowns/NOTIF_EMAIL_ID_OCR_AND_ACCOUNT_RECOVERY_PLAN.md §4.3/§4.4).
// Mounts controller functions directly behind minimal express apps, same
// pattern as tests/setPassword.test.js and tests/authController.username.test.js.

jest.mock("../models/User", () => ({ findOne: jest.fn(), findById: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/mailService", () => ({
  sendPasswordChangedEmail: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
  sendRecoveryEmailVerification: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
  sendRecoveryEmailAlert: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
  sendBackupCodesGeneratedEmail: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
  sendBackupCodeRedeemedEmail: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
  // Unrelated exports authController also pulls in — stub so requiring it doesn't blow up.
  isEmailConfigured: jest.fn().mockReturnValue(false),
  renderEmail: jest.fn(),
  sendPasswordAddedEmail: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
  sendEmailVerification: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
  sendEmailChangeVerification: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
  sendEmailChangeAlert: jest.fn().mockResolvedValue({ delivered: false, channel: "console" }),
}));
jest.mock("../utils/logger", () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const express = require("express");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const { logAuditEvent } = require("../services/auditService");
const mailService = require("../services/mailService");
const authController = require("../controllers/authController");
const { verifyRecoveryToken, verifyToken } = require("../middleware/auth");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const USER_ID = "507f1f77bcf86cd799439011";
const REAL_PASSWORD = "CorrectHorse123";
let REAL_HASH;

beforeAll(() => {
  REAL_HASH = bcrypt.hashSync(REAL_PASSWORD, 10);
});

beforeEach(() => {
  jest.clearAllMocks();
});

const buildProtectedApp = (userId = USER_ID) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId, role: "jobseeker" };
    next();
  });
  app.post("/recovery-email/request", authController.requestRecoveryEmail);
  app.post("/backup-codes/generate", authController.generateBackupCodes);
  return app;
};

const buildPublicApp = () => {
  const app = express();
  app.use(express.json());
  app.post("/recovery-email/confirm", authController.confirmRecoveryEmail);
  app.post("/recover/backup-code", authController.redeemBackupCode);
  app.post("/forgot-password", authController.forgotPassword);
  return app;
};

// Real middleware under test, not a stub — these two must actually enforce
// the recovery-token scope boundary.
const buildRecoveryScopedApp = () => {
  const app = express();
  app.use(express.json());
  app.post("/recover/set-password", verifyRecoveryToken, authController.recoverSetPassword);
  app.get("/protected", verifyToken, (req, res) => res.json({ ok: true }));
  return app;
};

const userDoc = (overrides = {}) => ({
  _id: USER_ID,
  name: "Jane Doe",
  email: "jane@example.com",
  role: "jobseeker",
  password: REAL_HASH,
  tokenVersion: 0,
  recoveryEmail: null,
  recoveryEmailVerifiedAt: null,
  backupCodes: [],
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

// A mock return value usable BOTH as `await User.findById(id)` (every
// controller in this file does this directly, no chain) AND as
// `await User.findById(id).select(fields)` (verifyRecoveryToken in
// middleware/auth.js chains .select() before awaiting) — a plain
// mockResolvedValue satisfies only the first shape and throws
// ".select is not a function" under the second.
const findableDoc = (doc) => ({
  select: jest.fn().mockResolvedValue(doc),
  then: (onFulfilled, onRejected) => Promise.resolve(doc).then(onFulfilled, onRejected),
});

describe("POST /recovery-email/request", () => {
  test("rejects an invalid email format", async () => {
    const res = await request(buildProtectedApp())
      .post("/recovery-email/request")
      .send({ recoveryEmail: "not-an-email", currentPassword: REAL_PASSWORD });
    expect(res.status).toBe(400);
  });

  test("rejects a recovery email identical to the primary address", async () => {
    User.findById.mockResolvedValue(userDoc());
    const res = await request(buildProtectedApp())
      .post("/recovery-email/request")
      .send({ recoveryEmail: "jane@example.com", currentPassword: REAL_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/different from your sign-in email/i);
  });

  test("a Google-only account (no password) is told to add one first", async () => {
    User.findById.mockResolvedValue(userDoc({ password: null }));
    const res = await request(buildProtectedApp())
      .post("/recovery-email/request")
      .send({ recoveryEmail: "backup@example.com", currentPassword: "" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/set a password first/i);
    expect(mailService.sendRecoveryEmailVerification).not.toHaveBeenCalled();
  });

  test("rejects the wrong current password", async () => {
    User.findById.mockResolvedValue(userDoc());
    const res = await request(buildProtectedApp())
      .post("/recovery-email/request")
      .send({ recoveryEmail: "backup@example.com", currentPassword: "wrong-password" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/current password is incorrect/i);
  });

  test("rejects an email already used as another account's recovery email", async () => {
    User.findById.mockResolvedValue(userDoc());
    User.findOne.mockResolvedValue({ _id: "someone-else" });
    const res = await request(buildProtectedApp())
      .post("/recovery-email/request")
      .send({ recoveryEmail: "backup@example.com", currentPassword: REAL_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already set as the recovery email/i);
  });

  test("succeeds: sets pending fields, emails the new address AND alerts the primary one", async () => {
    const doc = userDoc();
    User.findById.mockResolvedValue(doc);
    User.findOne.mockResolvedValue(null);

    const res = await request(buildProtectedApp())
      .post("/recovery-email/request")
      .send({ recoveryEmail: "backup@example.com", currentPassword: REAL_PASSWORD });

    expect(res.status).toBe(200);
    expect(doc.recoveryEmail).toBe("backup@example.com");
    expect(doc.recoveryEmailVerifiedAt).toBeNull();
    expect(doc.recoveryEmailToken).toBeTruthy();
    expect(doc.save).toHaveBeenCalled();

    expect(mailService.sendRecoveryEmailVerification).toHaveBeenCalledWith(
      expect.objectContaining({ to: "backup@example.com" })
    );
    expect(mailService.sendRecoveryEmailAlert).toHaveBeenCalledWith(
      expect.objectContaining({ to: "jane@example.com", action: "added" })
    );
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.recovery_email.requested" })
    );
  });

  test("reports 'replaced' (not 'added') in the alert when a recovery email already existed", async () => {
    const doc = userDoc({ recoveryEmail: "old-backup@example.com", recoveryEmailVerifiedAt: new Date() });
    User.findById.mockResolvedValue(doc);
    User.findOne.mockResolvedValue(null);

    await request(buildProtectedApp())
      .post("/recovery-email/request")
      .send({ recoveryEmail: "new-backup@example.com", currentPassword: REAL_PASSWORD });

    expect(mailService.sendRecoveryEmailAlert).toHaveBeenCalledWith(
      expect.objectContaining({ action: "replaced" })
    );
    // The new address starts unverified again even though the old one was verified.
    expect(doc.recoveryEmailVerifiedAt).toBeNull();
  });
});

describe("POST /recovery-email/confirm", () => {
  test("rejects a missing token/email", async () => {
    const res = await request(buildPublicApp()).post("/recovery-email/confirm").send({});
    expect(res.status).toBe(400);
  });

  test("rejects an invalid or expired token", async () => {
    User.findOne.mockResolvedValue(null);
    const res = await request(buildPublicApp())
      .post("/recovery-email/confirm")
      .send({ token: "bad", email: "backup@example.com" });
    expect(res.status).toBe(400);
  });

  test("confirms a valid token", async () => {
    const doc = userDoc({ recoveryEmail: "backup@example.com" });
    User.findOne.mockResolvedValue(doc);

    const res = await request(buildPublicApp())
      .post("/recovery-email/confirm")
      .send({ token: "goodtoken", email: "backup@example.com" });

    expect(res.status).toBe(200);
    expect(doc.recoveryEmailVerifiedAt).toBeInstanceOf(Date);
    expect(doc.recoveryEmailToken).toBeNull();
  });
});

describe("POST /backup-codes/generate", () => {
  test("generates 10 unique, correctly-formatted codes and stores only their hashes", async () => {
    const doc = userDoc();
    User.findById.mockResolvedValue(doc);

    const res = await request(buildProtectedApp()).post("/backup-codes/generate").send({});

    expect(res.status).toBe(200);
    expect(res.body.codes).toHaveLength(10);
    expect(new Set(res.body.codes).size).toBe(10); // all unique
    res.body.codes.forEach((code) => expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/));

    expect(doc.backupCodes).toHaveLength(10);
    doc.backupCodes.forEach((entry, i) => {
      expect(entry.hash).not.toBe(res.body.codes[i]); // never stored raw
      expect(bcrypt.compareSync(res.body.codes[i], entry.hash)).toBe(true);
      expect(entry.usedAt).toBeNull();
    });
    expect(doc.backupCodesGeneratedAt).toBeInstanceOf(Date);
    expect(mailService.sendBackupCodesGeneratedEmail).toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.backup_codes.generated" })
    );
  });

  test("regenerating replaces the old set entirely", async () => {
    const doc = userDoc({ backupCodes: [{ hash: "old-hash", usedAt: null }] });
    User.findById.mockResolvedValue(doc);

    await request(buildProtectedApp()).post("/backup-codes/generate").send({});

    expect(doc.backupCodes.some((c) => c.hash === "old-hash")).toBe(false);
    expect(doc.backupCodes).toHaveLength(10);
  });
});

describe("POST /recover/backup-code", () => {
  test("rejects a missing identifier or code", async () => {
    const res = await request(buildPublicApp()).post("/recover/backup-code").send({ identifier: "jane@example.com" });
    expect(res.status).toBe(400);
  });

  test("an unknown identifier gets the same generic failure and still pays bcrypt cost", async () => {
    User.findOne.mockResolvedValue(null);
    const compareSpy = jest.spyOn(bcrypt, "compare");

    const res = await request(buildPublicApp())
      .post("/recover/backup-code")
      .send({ identifier: "nobody@example.com", code: "AAAA-BBBB" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/didn't work/i);
    expect(compareSpy).toHaveBeenCalled();
    compareSpy.mockRestore();
  });

  test("a known user with no backup codes gets the same generic failure", async () => {
    User.findOne.mockResolvedValue(userDoc({ backupCodes: [] }));
    const res = await request(buildPublicApp())
      .post("/recover/backup-code")
      .send({ identifier: "jane@example.com", code: "AAAA-BBBB" });
    expect(res.status).toBe(400);
  });

  test("a wrong code against real codes is rejected", async () => {
    const realHash = bcrypt.hashSync("REAL-CODE", 10);
    const doc = userDoc({ backupCodes: [{ hash: realHash, usedAt: null }] });
    User.findOne.mockResolvedValue(doc);

    const res = await request(buildPublicApp())
      .post("/recover/backup-code")
      .send({ identifier: "jane@example.com", code: "WRONG-CODE" });

    expect(res.status).toBe(400);
    expect(doc.save).not.toHaveBeenCalled();
  });

  test("an already-used code is rejected even though its hash is technically correct", async () => {
    const realHash = bcrypt.hashSync("USED-CODE", 10);
    const doc = userDoc({ backupCodes: [{ hash: realHash, usedAt: new Date() }] });
    User.findOne.mockResolvedValue(doc);

    const res = await request(buildPublicApp())
      .post("/recover/backup-code")
      .send({ identifier: "jane@example.com", code: "USED-CODE" });

    expect(res.status).toBe(400);
  });

  test("a correct, unused code succeeds: marks used, bumps tokenVersion, issues a recovery-scoped token", async () => {
    const realHash = bcrypt.hashSync("GOOD-CODE", 10);
    const doc = userDoc({ backupCodes: [{ hash: realHash, usedAt: null }], tokenVersion: 3 });
    User.findOne.mockResolvedValue(doc);

    const res = await request(buildPublicApp())
      .post("/recover/backup-code")
      .send({ identifier: "jane@example.com", code: "good-code" }); // lowercase input, code compared uppercased

    expect(res.status).toBe(200);
    expect(doc.backupCodes[0].usedAt).toBeInstanceOf(Date);
    expect(doc.tokenVersion).toBe(4);
    expect(doc.save).toHaveBeenCalledTimes(1);
    expect(mailService.sendBackupCodeRedeemedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "jane@example.com" })
    );
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.backup_code.redeemed", severity: "critical" })
    );

    const decoded = jwt.verify(res.body.recoveryToken, process.env.JWT_SECRET);
    expect(decoded.scope).toBe("recovery");
    expect(decoded.tokenVersion).toBe(4);
  });

  test("redeeming the same code twice fails the second time", async () => {
    const realHash = bcrypt.hashSync("ONE-SHOT", 10);
    const doc = userDoc({ backupCodes: [{ hash: realHash, usedAt: null }] });
    User.findOne.mockResolvedValue(doc);

    const first = await request(buildPublicApp())
      .post("/recover/backup-code")
      .send({ identifier: "jane@example.com", code: "ONE-SHOT" });
    expect(first.status).toBe(200);

    // Second attempt sees the SAME doc object, now with usedAt set — this
    // simulates the DB state after the first request persisted it.
    const second = await request(buildPublicApp())
      .post("/recover/backup-code")
      .send({ identifier: "jane@example.com", code: "ONE-SHOT" });
    expect(second.status).toBe(400);
  });
});

describe("verifyRecoveryToken / verifyToken scope boundaries", () => {
  const signRecoveryToken = (tokenVersion = 1) =>
    jwt.sign({ id: USER_ID, scope: "recovery", tokenVersion }, process.env.JWT_SECRET, { expiresIn: "15m" });

  test("POST /recover/set-password succeeds with a valid, fresh recovery token", async () => {
    const doc = userDoc({ tokenVersion: 1 });
    // Same doc object backs both the middleware's .select()-chained lookup
    // and the controller's own plain findById — findableDoc supports both.
    User.findById.mockReturnValue(findableDoc(doc));

    const res = await request(buildRecoveryScopedApp())
      .post("/recover/set-password")
      .set("Authorization", `Bearer ${signRecoveryToken(1)}`)
      .send({ newPassword: "BrandNewPassword1" });

    expect(res.status).toBe(200);
    expect(doc.tokenVersion).toBe(2); // bumped again — single-use
    expect(bcrypt.compareSync("BrandNewPassword1", doc.password)).toBe(true);
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.scope).toBeUndefined(); // a normal, full-scope session token
  });

  test("a stale recovery token (tokenVersion already moved on) is rejected", async () => {
    User.findById.mockReturnValue(findableDoc(userDoc({ tokenVersion: 5 })));

    const res = await request(buildRecoveryScopedApp())
      .post("/recover/set-password")
      .set("Authorization", `Bearer ${signRecoveryToken(1)}`) // stale
      .send({ newPassword: "BrandNewPassword1" });

    expect(res.status).toBe(403);
  });

  test("a normal (non-recovery) token is rejected by verifyRecoveryToken", async () => {
    const normalToken = jwt.sign({ id: USER_ID, role: "jobseeker", tokenVersion: 1 }, process.env.JWT_SECRET, {
      expiresIn: "30d",
    });
    const res = await request(buildRecoveryScopedApp())
      .post("/recover/set-password")
      .set("Authorization", `Bearer ${normalToken}`)
      .send({ newPassword: "BrandNewPassword1" });
    expect(res.status).toBe(403);
  });

  test("a recovery-scoped token is rejected by the NORMAL verifyToken middleware", async () => {
    const res = await request(buildRecoveryScopedApp())
      .get("/protected")
      .set("Authorization", `Bearer ${signRecoveryToken(1)}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("RECOVERY_TOKEN_SCOPE");
  });
});

describe("POST /forgot-password — recovery email delivery", () => {
  test("sends to the primary address when useRecoveryEmail is not set, even if a verified recovery email exists", async () => {
    User.findOne.mockResolvedValue(
      userDoc({ recoveryEmail: "backup@example.com", recoveryEmailVerifiedAt: new Date() })
    );
    await request(buildPublicApp()).post("/forgot-password").send({ email: "jane@example.com" });
    expect(mailService.sendPasswordResetEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "jane@example.com" })
    );
  });

  test("sends to the verified recovery email when useRecoveryEmail is true", async () => {
    User.findOne.mockResolvedValue(
      userDoc({ recoveryEmail: "backup@example.com", recoveryEmailVerifiedAt: new Date() })
    );
    await request(buildPublicApp())
      .post("/forgot-password")
      .send({ email: "jane@example.com", useRecoveryEmail: true });
    expect(mailService.sendPasswordResetEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "backup@example.com" })
    );
  });

  test("falls back to primary when useRecoveryEmail is true but there's no VERIFIED recovery email", async () => {
    User.findOne.mockResolvedValue(
      userDoc({ recoveryEmail: "backup@example.com", recoveryEmailVerifiedAt: null }) // never confirmed
    );
    await request(buildPublicApp())
      .post("/forgot-password")
      .send({ email: "jane@example.com", useRecoveryEmail: true });
    expect(mailService.sendPasswordResetEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "jane@example.com" })
    );
  });

  test("the response is identically generic whether or not a recovery email exists (no enumeration)", async () => {
    User.findOne.mockResolvedValue(userDoc());
    const withoutRecovery = await request(buildPublicApp())
      .post("/forgot-password")
      .send({ email: "jane@example.com", useRecoveryEmail: true });

    User.findOne.mockResolvedValue(
      userDoc({ recoveryEmail: "backup@example.com", recoveryEmailVerifiedAt: new Date() })
    );
    const withRecovery = await request(buildPublicApp())
      .post("/forgot-password")
      .send({ email: "jane@example.com", useRecoveryEmail: true });

    expect(withoutRecovery.body.message).toBe(withRecovery.body.message);
  });
});
