jest.mock("../models/User", () => ({ findOne: jest.fn(), findById: jest.fn(), find: jest.fn(), exists: jest.fn(), updateOne: jest.fn() }));
jest.mock("../models/AccountRecoveryRequest", () => ({ findOneAndUpdate: jest.fn(), findOne: jest.fn(), findById: jest.fn(), exists: jest.fn(), updateOne: jest.fn(), find: jest.fn(), updateMany: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ countDocuments: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue() }));
jest.mock("../services/notificationService", () => ({ notifyManyUsers: jest.fn().mockResolvedValue([]) }));
jest.mock("../services/staffRecoveryMailService", () => ({ sendContactVerification: jest.fn(), sendRecoveryApproved: jest.fn(), sendRecoveryAlert: jest.fn(), sendRecoveryRejected: jest.fn() }));
jest.mock("../services/storageService", () => ({ remove: jest.fn() }));
jest.mock("../services/idOcrService", () => ({ scheduleOcrTask: jest.fn(), reserveOcrSlot: (_req, _res, next) => next(), hasOcrCapacity: jest.fn(() => true) }));
jest.mock("bcryptjs", () => ({ hash: jest.fn(), compare: jest.fn() }));
const express = require("express");
const request = require("supertest");
const mongoose = require("mongoose");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Recovery = require("../models/AccountRecoveryRequest");
const mail = require("../services/staffRecoveryMailService");
const { logAuditEvent } = require("../services/auditService");
const { notifyManyUsers } = require("../services/notificationService");
const controller = require("../controllers/accountRecoveryController");
const { maintainRecoveryRequests } = require("../services/recoveryMaintenanceService");
const storage = require("../services/storageService");
const actorId = "507f1f77bcf86cd799439011", userId = "507f1f77bcf86cd799439012", requestId = "507f1f77bcf86cd799439013";
const token = "a".repeat(64);
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const chain = (value) => {
  const query = { then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) };
  for (const method of ["select", "session", "collation", "sort", "skip", "limit"]) query[method] = jest.fn(() => query);
  return query;
};
const actor = () => ({ _id: actorId, role: "admin", password: "hash" });
const user = (extra = {}) => ({ _id: userId, role: "jobseeker", isActive: true, email: "old@example.com", recoveryEmail: "second@example.com", googleId: "google-id", tokenVersion: 4, validIdFile: "private:old-id", pendingEmail: "new@example.com", staffRecoveryVersion: 4, staffRecoveryRequest: requestId, ...extra });
const recovery = (extra = {}) => ({ _id: requestId, resolvedUser: userId, status: "pending", revision: "reviewed-revision", contactVerifiedAt: new Date(), contactEmail: "new@example.com", governmentIdFile: "private:new-id", selfieFile: "private:selfie", save: jest.fn().mockResolvedValue(), ...extra });

// Reset implementations: each test configures both bare and chained lookups.
beforeEach(() => {
  jest.resetAllMocks();
  bcrypt.compare.mockResolvedValue(true); bcrypt.hash.mockResolvedValue("new-password-hash");
  User.exists.mockReturnValue(chain(false)); User.updateOne.mockResolvedValue({ modifiedCount: 1 });
  Recovery.exists.mockResolvedValue(false); Recovery.updateOne.mockResolvedValue({ modifiedCount: 1 }); Recovery.updateMany.mockResolvedValue({});
  Recovery.findOneAndUpdate.mockResolvedValue(null);
  User.findOne.mockReturnValue(chain(null));
  User.find.mockReturnValue(chain([{ _id: actorId }]));
  User.findById.mockImplementation((id) => chain(id === actorId ? actor() : user()));
  Recovery.findOne.mockReturnValue(chain(recovery()));
  storage.remove.mockResolvedValue(true);
  for (const fn of Object.values(mail)) fn.mockResolvedValue({ delivered: true });
  logAuditEvent.mockResolvedValue(); notifyManyUsers.mockResolvedValue([]);
  jest.spyOn(mongoose, "startSession").mockResolvedValue({ withTransaction: async (work) => work(), endSession: jest.fn().mockResolvedValue() });
});
afterEach(() => jest.restoreAllMocks());
const app = () => {
  const result = express(); result.use(express.json());
  result.use((req, _res, next) => {
    req.user = { id: actorId, role: "admin" };
    req.files = { governmentIdFile: [{ storedValue: "private:id", buffer: Buffer.from("id"), mimetype: "image/png" }], selfieFile: [{ storedValue: "private:selfie" }] };
    next();
  });
  result.post("/submit", controller.submit); result.post("/verify", controller.verifyContact); result.post("/finish", controller.finish); result.post("/review/:id", controller.review);
  return result;
};
const submission = { identifier: "maria", contactEmail: "new@example.com", fullName: "Maria Reyes", dateOfBirth: "1990-02-03" };
const reviewBody = { decision: "approve", revision: "reviewed-revision", currentPassword: "correct", reason: "Both documents matched against the original record.", identityMatched: true };

test("known and unknown identifiers return identical public bodies and verify contact without enumeration", async () => {
  Recovery.findOne.mockReturnValue(chain({ _id: requestId }));
  const unknown = await request(app()).post("/submit").send(submission);
  User.findOne.mockReturnValue(chain(user()));
  const known = await request(app()).post("/submit").send(submission);
  expect(known.status).toBe(200); expect(unknown.status).toBe(200); expect(known.body).toEqual(unknown.body);
  expect(JSON.stringify(known.body)).not.toContain(userId);
  expect(mail.sendContactVerification).toHaveBeenCalledTimes(2);
  expect(Recovery.findOneAndUpdate.mock.calls[1][0]).toEqual({ openAccountKey: userId });
  expect(Recovery.findOneAndUpdate.mock.calls[1][1].$set).toMatchObject({ resolvedUser: userId, contactVerifiedAt: null, status: "pending" });
});
test("resubmission reuses the open-account key and replaces private files", async () => {
  User.findOne.mockReturnValue(chain(user())); Recovery.findOneAndUpdate.mockResolvedValue({ governmentIdFile: "old:id", selfieFile: "old:selfie" });
  await request(app()).post("/submit").send(submission);
  expect(Recovery.findOneAndUpdate).toHaveBeenCalledWith({ openAccountKey: userId }, expect.any(Object), expect.objectContaining({ upsert: true }));
  expect(storage.remove).toHaveBeenCalledWith("old:id"); expect(storage.remove).toHaveBeenCalledWith("old:selfie");
});
test("rejected accounts have a generic 24-hour cooldown with new proofs removed", async () => {
  User.findOne.mockReturnValue(chain(user())); Recovery.exists.mockResolvedValue(true);
  const response = await request(app()).post("/submit").send(submission);
  expect(response.status).toBe(200); expect(Recovery.findOneAndUpdate).not.toHaveBeenCalled();
  expect(storage.remove).toHaveBeenCalledTimes(2);
  expect(mail.sendContactVerification).toHaveBeenCalledTimes(1);
});
test("contact confirmation is one-time and notifies staff only for valid tokens", async () => {
  const invalid = await request(app()).post("/verify").send({ token });
  expect(notifyManyUsers).not.toHaveBeenCalled();
  Recovery.findOneAndUpdate.mockResolvedValue(recovery());
  const valid = await request(app()).post("/verify").send({ token });
  expect(valid.body).toEqual(invalid.body);
  expect(Recovery.findOneAndUpdate.mock.calls[1][0]).toMatchObject({ contactVerificationHash: hash(token), status: { $in: ["pending", "under_review"] } });
  expect(notifyManyUsers).toHaveBeenCalledWith(expect.objectContaining({ type: "account_recovery", preferenceKey: "notifyAccountRecovery" }));
});
test("approval revokes sessions, unlinks Google, stages contact email and mails notices without setting a password", async () => {
  const response = await request(app()).post(`/review/${requestId}`).send(reviewBody);
  expect(response.status).toBe(200);
  const update = User.updateOne.mock.calls[0][1];
  expect(update.$inc).toEqual({ tokenVersion: 1 });
  expect(update.$set).toMatchObject({ googleId: null, authProvider: "local", googleSignInDisabled: true, staffRecoveryPending: true, pendingEmail: "new@example.com", staffRecoveryVersion: 5, backupCodes: [] });
  expect(update.$set.password).toBeUndefined(); expect(update.$set.email).toBeUndefined();
  expect(update.$set.recoveryEmail).toBeNull(); expect(update.$set.recoveryEmailVerifiedAt).toBeNull();
  expect(update.$set.staffRecoveryToken).toMatch(/^[a-f0-9]{64}$/);
  expect(mail.sendRecoveryApproved).toHaveBeenCalledWith(expect.objectContaining({ to: "new@example.com", token: expect.any(String) }));
  const raw = mail.sendRecoveryApproved.mock.calls[0][0].token;
  expect(update.$set.staffRecoveryToken).toBe(hash(raw)); expect(update.$set.staffRecoveryToken).not.toBe(raw);
  expect(mail.sendRecoveryAlert).toHaveBeenCalledTimes(2);
  expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ actorId, action: "auth.account.recovered", severity: "critical" }));
});
test.each(["employer", "admin", "superadmin"])("%s online recovery is forbidden server-side", async (role) => {
  User.findById.mockImplementation((id) => chain(id === actorId ? actor() : user({ role })));
  expect((await request(app()).post(`/review/${requestId}`).send(reviewBody)).status).toBe(403);
  expect(User.updateOne).not.toHaveBeenCalled(); expect(mail.sendRecoveryApproved).not.toHaveBeenCalled();
});
test.each([{ contactVerifiedAt: null }, { resolvedUser: null }])("approval rejects unverified or unresolved proof: %j", async (extra) => {
  Recovery.findOne.mockReturnValue(chain(recovery(extra)));
  expect((await request(app()).post(`/review/${requestId}`).send(reviewBody)).status).toBeGreaterThanOrEqual(400);
  expect(User.updateOne).not.toHaveBeenCalled();
});
test.each([{ validIdFile: null }, { isActive: false }])("approval rejects missing original ID or inactive account: %j", async (extra) => {
  User.findById.mockImplementation((id) => chain(id === actorId ? actor() : user(extra)));
  expect((await request(app()).post(`/review/${requestId}`).send(reviewBody)).status).toBeGreaterThanOrEqual(400);
  expect(User.updateOne).not.toHaveBeenCalled();
});
test("review requires current password and a decision reason", async () => {
  bcrypt.compare.mockResolvedValue(false);
  expect((await request(app()).post(`/review/${requestId}`).send(reviewBody)).status).toBe(403);
  bcrypt.compare.mockResolvedValue(true);
  expect((await request(app()).post(`/review/${requestId}`).send({ ...reviewBody, reason: "short" })).status).toBe(400);
  expect(User.updateOne).not.toHaveBeenCalled();
});
test("stale review revision cannot recover a different resubmission", async () => {
  Recovery.findOne.mockReturnValue(chain(null));
  expect((await request(app()).post(`/review/${requestId}`).send(reviewBody)).status).toBe(409);
  expect(Recovery.findOne).toHaveBeenCalledWith(expect.objectContaining({ revision: "reviewed-revision" }));
  expect(User.updateOne).not.toHaveBeenCalled();
});
test("rejection releases the open key and mails only a verified contact", async () => {
  const doc = recovery(); Recovery.findOne.mockReturnValue(chain(doc));
  expect((await request(app()).post(`/review/${requestId}`).send({ ...reviewBody, decision: "reject" })).status).toBe(200);
  expect(doc.openAccountKey).toBeUndefined(); expect(doc.status).toBe("rejected"); expect(doc.resolvedAt).toBeInstanceOf(Date);
  expect(mail.sendRecoveryRejected).toHaveBeenCalledTimes(1); expect(User.updateOne).not.toHaveBeenCalled();
});
test("finish confirms pending email and increments session version again without issuing a session", async () => {
  User.findOne.mockReturnValue(chain(user())); Recovery.findOne.mockReturnValue(chain(recovery({ status: "approved" })));
  const response = await request(app()).post("/finish").send({ token, newPassword: "NewPassword123" });
  expect(response.status).toBe(200); expect(response.body.token).toBeUndefined();
  expect(User.updateOne).toHaveBeenCalledWith({ _id: userId, staffRecoveryToken: hash(token), tokenVersion: 4 }, expect.objectContaining({ $inc: { tokenVersion: 1 }, $set: expect.objectContaining({ email: "new@example.com", password: "new-password-hash", staffRecoveryPending: false, pendingEmail: null, staffRecoveryToken: null }) }), expect.any(Object));
});
test("unknown tokens pay hashing cost and return a generic failure", async () => {
  expect((await request(app()).post("/finish").send({ token, newPassword: "NewPassword123" })).status).toBe(400);
  expect(bcrypt.hash).toHaveBeenCalledWith("NewPassword123", 10); expect(User.updateOne).not.toHaveBeenCalled();
});
test("a changed session version or reused token cannot finish recovery", async () => {
  User.findOne.mockReturnValue(chain(user({ tokenVersion: 5 })));
  expect((await request(app()).post("/finish").send({ token, newPassword: "NewPassword123" })).status).toBe(400);
  User.findOne.mockReturnValue(chain(user())); User.updateOne.mockResolvedValue({ modifiedCount: 0 });
  expect((await request(app()).post("/finish").send({ token, newPassword: "NewPassword123" })).status).toBe(400);
  expect(mail.sendRecoveryAlert).not.toHaveBeenCalled();
});
test("maintenance expires untouched requests and deletes proof after 90 days", async () => {
  Recovery.find.mockReturnValue(chain([recovery()]));
  await maintainRecoveryRequests();
  expect(Recovery.updateMany).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: { $lte: expect.any(Date) } }), expect.objectContaining({ $set: { status: "expired", resolvedAt: expect.any(Date) }, $unset: expect.objectContaining({ openAccountKey: 1 }) }));
  expect(storage.remove).toHaveBeenCalledWith("private:new-id", { strict: true }); expect(storage.remove).toHaveBeenCalledWith("private:selfie", { strict: true });
  expect(Recovery.updateOne).toHaveBeenCalledWith({ _id: requestId }, expect.objectContaining({ $set: expect.objectContaining({ filesDeletedAt: expect.any(Date), governmentIdFile: "", selfieFile: "" }) }));
});

test("a deletion failure retains the retry marker and proof references", async () => {
  Recovery.find.mockReturnValue(chain([recovery()])); storage.remove.mockRejectedValue(new Error("storage offline"));
  const logged = jest.spyOn(console, "error").mockImplementation(() => {});
  await maintainRecoveryRequests();
  expect(Recovery.updateOne).not.toHaveBeenCalled(); expect(logged).toHaveBeenCalled();
});

test("concurrent first submissions retry the unique-key race", async () => {
  User.findOne.mockReturnValue(chain(user())); Recovery.findOne.mockReturnValue(chain({ _id: requestId }));
  Recovery.findOneAndUpdate.mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: 11000 })).mockResolvedValueOnce(recovery());
  const response = await request(app()).post("/submit").send(submission);
  expect(response.status).toBe(200); expect(Recovery.findOneAndUpdate).toHaveBeenCalledTimes(2);
  expect(Recovery.findOneAndUpdate.mock.calls[0][0]).toEqual(Recovery.findOneAndUpdate.mock.calls[1][0]);
});

test("queue routes enforce authentication, staff roles and superadmin report access", async () => {
  const router = require("../routes/accountRecoveryRoutes");
  const protectedApp = express(); protectedApp.use(express.json()); protectedApp.use("/requests", router);
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
  const jwt = require("jsonwebtoken");
  const auth = `Bearer ${jwt.sign({ id: actorId, tokenVersion: 0 }, process.env.JWT_SECRET)}`;
  expect((await request(protectedApp).get("/requests")).status).toBe(401);
  User.findById.mockReturnValue(chain({ ...actor(), role: "jobseeker" }));
  expect((await request(protectedApp).get("/requests").set("Authorization", auth)).status).toBe(403);
  User.findById.mockReturnValue(chain(actor()));
  expect((await request(protectedApp).get("/requests/report").set("Authorization", auth)).status).toBe(403);
  User.findById.mockReturnValue(chain({ ...actor(), role: "superadmin" })); Recovery.find.mockReturnValue(chain([]));
  expect((await request(protectedApp).get("/requests/report").set("Authorization", auth)).status).toBe(200);
});

test("approved recovery blocks old password login and ordinary password reset delivery", async () => {
  const auth = require("../controllers/authController");
  const authApp = express(); authApp.use(express.json()); authApp.post("/login", auth.login); authApp.post("/forgot", auth.forgotPassword);
  User.findOne.mockReturnValue(chain(user({ staffRecoveryPending: true, password: "old-password" })));
  expect((await request(authApp).post("/login").send({ identifier: "maria", password: "correct" })).status).toBe(400);
  expect(bcrypt.compare).toHaveBeenCalled();
  expect((await request(authApp).post("/forgot").send({ email: "old@example.com" })).status).toBe(200);
});

test("same-email Google sign-in cannot undo staff unlinking", async () => {
  process.env.GOOGLE_CLIENT_ID = "test-client";
  const { OAuth2Client } = require("google-auth-library");
  jest.spyOn(OAuth2Client.prototype, "verifyIdToken").mockResolvedValue({ getPayload: () => ({ sub: "old-google", email: "old@example.com", email_verified: true }) });
  const auth = require("../controllers/authController");
  const authApp = express(); authApp.use(express.json()); authApp.post("/google", auth.googleAuth);
  User.findOne.mockReturnValue(chain(user({ googleId: null, googleSignInDisabled: true })));
  expect((await request(authApp).post("/google").send({ credential: "valid-google-credential" })).status).toBe(403);
});
