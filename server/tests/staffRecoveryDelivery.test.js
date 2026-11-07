// E-02: a failed recovery email must not leave the request silently locked.
// The delivery outcome is recorded on the request, logged without the token,
// and staff can resend, which issues a NEW token and invalidates the old one.

jest.mock("../models/User", () => ({ findOne: jest.fn(), findById: jest.fn(), find: jest.fn(), exists: jest.fn(), updateOne: jest.fn() }));
jest.mock("../models/AccountRecoveryRequest", () => ({ findOneAndUpdate: jest.fn(), findOne: jest.fn(), findById: jest.fn(), exists: jest.fn(), updateOne: jest.fn(), find: jest.fn(), updateMany: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ countDocuments: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue() }));
jest.mock("../services/notificationService", () => ({ notifyManyUsers: jest.fn().mockResolvedValue([]) }));
jest.mock("../services/staffRecoveryMailService", () => ({ sendContactVerification: jest.fn(), sendRecoveryApproved: jest.fn(), sendRecoveryAlert: jest.fn(), sendRecoveryRejected: jest.fn() }));
jest.mock("../services/storageService", () => ({ remove: jest.fn() }));
jest.mock("../services/idOcrService", () => ({ scheduleOcrTask: jest.fn(), reserveOcrSlot: (_req, _res, next) => next(), hasOcrCapacity: jest.fn(() => true) }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("bcryptjs", () => ({ hash: jest.fn(), compare: jest.fn() }));

const express = require("express");
const request = require("supertest");
const mongoose = require("mongoose");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const Recovery = require("../models/AccountRecoveryRequest");
const mail = require("../services/staffRecoveryMailService");
const logger = require("../utils/logger");
const controller = require("../controllers/accountRecoveryController");

const actorId = "507f1f77bcf86cd799439011";
const userId = "507f1f77bcf86cd799439012";
const requestId = "507f1f77bcf86cd799439013";
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

const chain = (value) => {
  const query = { then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) };
  for (const method of ["select", "session", "collation", "sort", "skip", "limit"]) query[method] = jest.fn(() => query);
  return query;
};
const actor = () => ({ _id: actorId, role: "admin", password: "hash" });
const user = (extra = {}) => ({ _id: userId, role: "jobseeker", isActive: true, email: "old@example.com", recoveryEmail: null, googleId: null, tokenVersion: 4, validIdFile: "private:old-id", pendingEmail: "new@example.com", staffRecoveryVersion: 4, staffRecoveryRequest: requestId, staffRecoveryPending: true, ...extra });
const recovery = (extra = {}) => ({ _id: requestId, resolvedUser: userId, status: "pending", revision: "reviewed-revision", contactVerifiedAt: new Date(), contactEmail: "new@example.com", governmentIdFile: "private:new-id", selfieFile: "private:selfie", save: jest.fn().mockResolvedValue(), ...extra });

const app = () => {
  const result = express();
  result.use(express.json());
  result.use((req, _res, next) => { req.user = { id: actorId, role: "admin" }; next(); });
  result.post("/review/:id", controller.review);
  result.post("/resend/:id", controller.resend);
  return result;
};
const reviewBody = { decision: "approve", revision: "reviewed-revision", currentPassword: "correct", reason: "Both documents matched against the original record.", identityMatched: true };

beforeEach(() => {
  jest.resetAllMocks();
  bcrypt.compare.mockResolvedValue(true);
  User.exists.mockReturnValue(chain(false));
  User.updateOne.mockResolvedValue({ modifiedCount: 1 });
  Recovery.updateOne.mockResolvedValue({ modifiedCount: 1 });
  Recovery.findOne.mockReturnValue(chain(recovery()));
  User.find.mockReturnValue(chain([{ _id: actorId }]));
  User.findById.mockImplementation((id) => chain(id === actorId ? actor() : user()));
  for (const fn of Object.values(mail)) fn.mockResolvedValue({ delivered: true, channel: "smtp" });
  jest.spyOn(mongoose, "startSession").mockResolvedValue({ withTransaction: async (work) => work(), endSession: jest.fn().mockResolvedValue() });
});

const deliveryUpdate = () => Recovery.updateOne.mock.calls.find(([, update]) => update.$set && update.$set["delivery.status"])?.[1];
const allLogged = () => JSON.stringify([logger.error.mock.calls, logger.warn.mock.calls, logger.info.mock.calls]);

describe("review: approval email outcome", () => {
  test("email send throws: approval stays committed, delivery recorded as failed, token never logged or returned", async () => {
    mail.sendRecoveryApproved.mockRejectedValue(new Error("SMTP exploded"));

    const res = await request(app()).post(`/review/${requestId}`).send(reviewBody);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(res.body.delivery).toMatchObject({ status: "failed", channel: "error" });
    const rawToken = mail.sendRecoveryApproved.mock.calls[0][0].token;
    expect(JSON.stringify(res.body)).not.toContain(rawToken);
    expect(allLogged()).not.toContain(rawToken);
    // Request is approved and the user is flagged: the committed state is intact.
    expect(User.updateOne.mock.calls[0][1].$set.staffRecoveryPending).toBe(true);
    expect(deliveryUpdate().$set).toMatchObject({ "delivery.status": "failed", "delivery.channel": "error", "delivery.lastAttemptBy": actorId });
    expect(deliveryUpdate().$inc).toEqual({ "delivery.attempts": 1 });
    const logged = logger.error.mock.calls.find(([m]) => m === "Recovery approval email was not delivered");
    expect(logged[1]).toMatchObject({ requestId, recipientRole: "jobseeker", channel: "error", reviewerId: actorId });
  });

  test.each([
    ["console fallback (no SMTP)", { delivered: false, channel: "console" }, "console"],
    ["SMTP error fallback", { delivered: false, channel: "error" }, "error"],
  ])("%s counts as failed", async (_label, result, channel) => {
    mail.sendRecoveryApproved.mockResolvedValue(result);

    const res = await request(app()).post(`/review/${requestId}`).send(reviewBody);

    expect(res.status).toBe(200);
    expect(res.body.delivery).toMatchObject({ status: "failed", channel });
  });

  test("delivered email is recorded as sent and nothing is logged as an error", async () => {
    const res = await request(app()).post(`/review/${requestId}`).send(reviewBody);

    expect(res.body.delivery.status).toBe("sent");
    expect(deliveryUpdate().$set["delivery.status"]).toBe("sent");
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("a reject decision carries no delivery field", async () => {
    const res = await request(app()).post(`/review/${requestId}`).send({ ...reviewBody, decision: "reject" });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("delivery");
    expect(mail.sendRecoveryApproved).not.toHaveBeenCalled();
  });
});

describe("resend", () => {
  const approvedRequest = () => recovery({ status: "approved", redeemedAt: null });

  test("issues a NEW token, overwrites the stored hash (old link dies) and records the attempt", async () => {
    Recovery.findOne.mockReturnValue(chain(approvedRequest()));
    const previousToken = "p".repeat(64);

    const res = await request(app()).post(`/resend/${requestId}`).send({ currentPassword: "correct" });

    expect(res.status).toBe(200);
    expect(res.body.delivery.status).toBe("sent");
    const newToken = mail.sendRecoveryApproved.mock.calls[0][0].token;
    expect(newToken).not.toBe(previousToken);
    const [filter, update] = User.updateOne.mock.calls[0];
    expect(filter).toMatchObject({ _id: userId, staffRecoveryRequest: requestId });
    expect(update.$set.staffRecoveryToken).toBe(hash(newToken));
    expect(update.$set.staffRecoveryExpires.getTime()).toBeGreaterThan(Date.now() + 29 * 60000);
    // The previous token's hash is no longer the stored one, so /finish rejects it.
    expect(update.$set.staffRecoveryToken).not.toBe(hash(previousToken));
    expect(JSON.stringify(res.body)).not.toContain(newToken);
    expect(allLogged()).not.toContain(newToken);
    expect(deliveryUpdate().$set["delivery.status"]).toBe("sent");
  });

  test("when the resend also fails, the response says so and the failure is recorded again", async () => {
    Recovery.findOne.mockReturnValue(chain(approvedRequest()));
    mail.sendRecoveryApproved.mockResolvedValue({ delivered: false, channel: "error" });

    const res = await request(app()).post(`/resend/${requestId}`).send({ currentPassword: "correct" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Recovery email could not be delivered");
    expect(res.body.delivery.status).toBe("failed");
  });

  test("wrong password is 403 and nothing changes", async () => {
    bcrypt.compare.mockResolvedValue(false);

    const res = await request(app()).post(`/resend/${requestId}`).send({ currentPassword: "nope" });

    expect(res.status).toBe(403);
    expect(User.updateOne).not.toHaveBeenCalled();
    expect(mail.sendRecoveryApproved).not.toHaveBeenCalled();
  });

  test("not-approved or already-redeemed request is 409", async () => {
    Recovery.findOne.mockReturnValue(chain(null));

    const res = await request(app()).post(`/resend/${requestId}`).send({ currentPassword: "correct" });

    expect(res.status).toBe(409);
    expect(Recovery.findOne).toHaveBeenCalledWith(expect.objectContaining({ status: "approved", redeemedAt: null }));
    expect(mail.sendRecoveryApproved).not.toHaveBeenCalled();
  });

  test.each([
    ["no longer pending", { staffRecoveryPending: false }],
    ["pointing at another request", { staffRecoveryRequest: "507f1f77bcf86cd7994390ff" }],
    ["not a jobseeker", { role: "employer" }],
  ])("user %s is 409 and no token is rotated", async (_label, extra) => {
    Recovery.findOne.mockReturnValue(chain(approvedRequest()));
    User.findById.mockImplementation((id) => chain(id === actorId ? actor() : user(extra)));

    const res = await request(app()).post(`/resend/${requestId}`).send({ currentPassword: "correct" });

    expect(res.status).toBe(409);
    expect(User.updateOne).not.toHaveBeenCalled();
    expect(mail.sendRecoveryApproved).not.toHaveBeenCalled();
  });
});
