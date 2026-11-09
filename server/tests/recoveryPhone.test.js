// PESO recovery request with a PHONE contact (rev 3): accepted only while the
// username sign-up feature is on, never emails anything, cannot be approved by
// link, and staff complete it in person. Mocked models, no real mail.

jest.mock("../models/User", () => ({ findOne: jest.fn(), findById: jest.fn(), find: jest.fn(), exists: jest.fn(), updateOne: jest.fn() }));
jest.mock("../models/AccountRecoveryRequest", () => ({
  findOneAndUpdate: jest.fn(),
  findOne: jest.fn(),
  findById: jest.fn(),
  exists: jest.fn(),
  updateOne: jest.fn(),
  find: jest.fn(),
  updateMany: jest.fn(),
}));
jest.mock("../models/JobApplication", () => ({ countDocuments: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue() }));
jest.mock("../services/notificationService", () => ({ notifyManyUsers: jest.fn().mockResolvedValue([]) }));
jest.mock("../services/staffRecoveryMailService", () => ({
  sendContactVerification: jest.fn(),
  sendRecoveryApproved: jest.fn(),
  sendRecoveryAlert: jest.fn(),
  sendRecoveryRejected: jest.fn(),
}));
jest.mock("../services/storageService", () => ({ remove: jest.fn() }));
jest.mock("../services/idOcrService", () => ({ scheduleOcrTask: jest.fn(), reserveOcrSlot: (_req, _res, next) => next(), hasOcrCapacity: jest.fn(() => true) }));
jest.mock("../services/accountAlertService", () => ({
  notifyPasswordResetByStaff: jest.fn().mockResolvedValue(),
  notifyRecoveryRequested: jest.fn().mockResolvedValue(),
}));
jest.mock("../services/officeResetService", () => ({
  JOBSEEKER_ROLES: ["jobseeker", "employee", "resident"],
  applyOfficeReset: jest.fn(),
}));
jest.mock("bcryptjs", () => ({ hash: jest.fn(), compare: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const express = require("express");
const request = require("supertest");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Recovery = require("../models/AccountRecoveryRequest");
const mail = require("../services/staffRecoveryMailService");
const { logAuditEvent } = require("../services/auditService");
const { notifyManyUsers } = require("../services/notificationService");
const { notifyPasswordResetByStaff, notifyRecoveryRequested } = require("../services/accountAlertService");
const { applyOfficeReset } = require("../services/officeResetService");
const controller = require("../controllers/accountRecoveryController");

const actorId = "507f1f77bcf86cd799439011";
const userId = "507f1f77bcf86cd799439012";
const requestId = "507f1f77bcf86cd799439013";
const TEMP = "Tmp#Secret-2468xQ";

const chain = (value) => {
  const query = { then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) };
  for (const method of ["select", "session", "collation", "sort", "skip", "limit"]) query[method] = jest.fn(() => query);
  return query;
};
const actor = () => ({ _id: actorId, role: "admin", password: "hash" });
const jobseeker = (extra = {}) => ({ _id: userId, role: "jobseeker", isActive: true, tokenVersion: 4, ...extra });
const phoneRequest = (extra = {}) => ({
  _id: requestId,
  resolvedUser: userId,
  status: "pending",
  revision: "rev-1",
  contactMethod: "phone",
  contactPhone: "09171234567",
  contactVerifiedAt: null,
  save: jest.fn().mockResolvedValue(),
  ...extra,
});

beforeEach(() => {
  jest.resetAllMocks();
  process.env.USERNAME_SIGNUP_ENABLED = "true";
  bcrypt.compare.mockResolvedValue(true);
  bcrypt.hash.mockResolvedValue("hash");
  User.exists.mockReturnValue(chain(false));
  User.updateOne.mockResolvedValue({ modifiedCount: 1 });
  Recovery.exists.mockResolvedValue(false);
  Recovery.updateOne.mockResolvedValue({ modifiedCount: 1 });
  Recovery.findOneAndUpdate.mockResolvedValue(null);
  User.findOne.mockReturnValue(chain(null));
  User.find.mockReturnValue(chain([{ _id: actorId }]));
  User.findById.mockImplementation((id) => chain(id === actorId ? actor() : jobseeker()));
  Recovery.findOne.mockReturnValue(chain(phoneRequest()));
  for (const fn of Object.values(mail)) fn.mockResolvedValue({ delivered: true });
  logAuditEvent.mockResolvedValue();
  notifyManyUsers.mockResolvedValue([]);
  applyOfficeReset.mockResolvedValue({ temporaryPassword: TEMP, user: {} });
  jest.spyOn(mongoose, "startSession").mockResolvedValue({ withTransaction: async (work) => work(), endSession: jest.fn().mockResolvedValue() });
});
afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.USERNAME_SIGNUP_ENABLED;
});

const app = () => {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.user = { id: actorId, role: "admin" };
    req.files = {
      governmentIdFile: [{ storedValue: "private:id", buffer: Buffer.from("id"), mimetype: "image/png" }],
      selfieFile: [{ storedValue: "private:selfie" }],
    };
    next();
  });
  a.post("/submit", controller.submit);
  a.post("/review/:id", controller.review);
  return a;
};

const phoneBody = { identifier: "maria_r", contactMethod: "phone", contactPhone: "0917 123 4567", fullName: "Maria Reyes", dateOfBirth: "1990-02-03" };

describe("submit with a phone contact", () => {
  test("accepted: stores the normalized phone, no email, nothing is mailed, staff and the owner are told in-app", async () => {
    User.findOne.mockReturnValue(chain(jobseeker()));
    const res = await request(app()).post("/submit").send(phoneBody);
    expect(res.status).toBe(200);

    const [filter, update] = Recovery.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ openAccountKey: userId });
    expect(update.$set).toMatchObject({ contactMethod: "phone", contactPhone: "09171234567", contactVerifiedAt: null, status: "pending" });
    expect(update.$set).not.toHaveProperty("contactEmail");
    expect(update.$set).not.toHaveProperty("contactVerificationHash");
    expect(update.$unset).toMatchObject({ contactEmail: 1, contactVerificationHash: 1 });

    expect(mail.sendContactVerification).not.toHaveBeenCalled();
    expect(notifyManyUsers).toHaveBeenCalledWith(expect.objectContaining({ type: "account_recovery", title: "Phone-contact recovery request" }));
    expect(notifyRecoveryRequested).toHaveBeenCalledWith(userId, expect.anything());
  });

  test("a known and an unknown username get identical public bodies (no enumeration)", async () => {
    Recovery.findOne.mockReturnValue(chain({ _id: requestId }));
    const unknown = await request(app()).post("/submit").send(phoneBody);
    User.findOne.mockReturnValue(chain(jobseeker()));
    const known = await request(app()).post("/submit").send(phoneBody);
    expect(known.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(JSON.stringify(known.body)).not.toContain(userId);
  });

  test("an invalid phone is refused and nothing is stored", async () => {
    const res = await request(app()).post("/submit").send({ ...phoneBody, contactPhone: "12345" });
    expect(res.status).toBe(400);
    expect(Recovery.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("flag OFF: a phone contact is not accepted (the email rules apply)", async () => {
    process.env.USERNAME_SIGNUP_ENABLED = "false";
    const res = await request(app()).post("/submit").send(phoneBody);
    expect(res.status).toBe(400);
    expect(Recovery.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("an email request is unchanged: link mailed, phone cleared", async () => {
    const res = await request(app()).post("/submit").send({ identifier: "maria_r", contactEmail: "new@example.com", fullName: "Maria Reyes", dateOfBirth: "1990-02-03" });
    expect(res.status).toBe(200);
    const [, update] = Recovery.findOneAndUpdate.mock.calls[0];
    expect(update.$set).toMatchObject({ contactMethod: "email", contactEmail: "new@example.com" });
    expect(update.$unset).toEqual({ contactPhone: 1 });
    expect(mail.sendContactVerification).toHaveBeenCalledTimes(1);
    expect(notifyRecoveryRequested).not.toHaveBeenCalled();
  });
});

describe("review of a phone-contact request", () => {
  const base = { revision: "rev-1", currentPassword: "correct", reason: "Checked the original ID at the counter." };
  const inPerson = { ...base, decision: "complete_in_person", idChecked: true, idTypePresented: "Passport" };

  test("approve (the emailed-link path) is refused and changes nothing", async () => {
    const res = await request(app()).post(`/review/${requestId}`).send({ ...base, decision: "approve", identityMatched: true });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/complete in person/i);
    expect(User.updateOne).not.toHaveBeenCalled();
    expect(applyOfficeReset).not.toHaveBeenCalled();
    expect(mail.sendRecoveryApproved).not.toHaveBeenCalled();
  });

  test("complete in person: resets the password, marks the request, returns the temporary password once", async () => {
    const request_ = phoneRequest();
    Recovery.findOne.mockReturnValue(chain(request_));
    const res = await request(app()).post(`/review/${requestId}`).send(inPerson);

    expect(res.status).toBe(200);
    expect(res.body.temporaryPassword).toBe(TEMP);
    expect(res.body.mustChangePassword).toBe(true);
    expect(res.headers["cache-control"]).toMatch(/no-store/);
    expect(applyOfficeReset).toHaveBeenCalledTimes(1);
    expect(request_.status).toBe("approved");
    expect(request_.delivery).toMatchObject({ status: "sent", channel: "in_person" });
    expect(request_.save).toHaveBeenCalled();
    expect(mail.sendRecoveryApproved).not.toHaveBeenCalled(); // no link, no email
    expect(notifyPasswordResetByStaff).toHaveBeenCalledWith(userId, expect.anything());
  });

  test("the audit event records the ID type and the reason, never the temporary password", async () => {
    await request(app()).post(`/review/${requestId}`).send(inPerson);
    const events = logAuditEvent.mock.calls.map(([e]) => e);
    const reset = events.find((e) => e.action === "auth.password.reset_by_staff");
    expect(reset.severity).toBe("critical");
    expect(reset.metadata).toMatchObject({ via: "recovery_request", idType: "Passport" });
    expect(JSON.stringify(events.map((e) => ({ ...e, req: undefined })))).not.toContain(TEMP);
  });

  test.each([
    ["without the ID-checked confirmation", { idChecked: false }],
    ["without an ID type", { idTypePresented: undefined }],
    ["with an unknown ID type", { idTypePresented: "Library card" }],
    ["with a short reason", { reason: "ok" }],
  ])("refused %s", async (_, override) => {
    const res = await request(app()).post(`/review/${requestId}`).send({ ...inPerson, ...override });
    expect(res.status).toBe(400);
    expect(applyOfficeReset).not.toHaveBeenCalled();
  });

  test("a wrong staff password is refused", async () => {
    bcrypt.compare.mockResolvedValue(false);
    const res = await request(app()).post(`/review/${requestId}`).send(inPerson);
    expect(res.status).toBe(403);
    expect(applyOfficeReset).not.toHaveBeenCalled();
  });

  test("an email-contact request cannot be completed this way", async () => {
    Recovery.findOne.mockReturnValue(chain(phoneRequest({ contactMethod: "email", contactEmail: "a@b.co" })));
    const res = await request(app()).post(`/review/${requestId}`).send(inPerson);
    expect(res.status).toBe(400);
    expect(applyOfficeReset).not.toHaveBeenCalled();
  });

  test("only an active jobseeker, and not one already in a PESO recovery", async () => {
    User.findById.mockImplementation((id) => chain(id === actorId ? actor() : jobseeker({ role: "employer" })));
    expect((await request(app()).post(`/review/${requestId}`).send(inPerson)).status).toBe(403);
    User.findById.mockImplementation((id) => chain(id === actorId ? actor() : jobseeker({ staffRecoveryPending: true })));
    expect((await request(app()).post(`/review/${requestId}`).send(inPerson)).status).toBe(409);
    expect(applyOfficeReset).not.toHaveBeenCalled();
  });

  test("rejecting a phone request sends no mail (there is no verified email)", async () => {
    const res = await request(app()).post(`/review/${requestId}`).send({ ...base, decision: "reject" });
    expect(res.status).toBe(200);
    expect(mail.sendRecoveryRejected).not.toHaveBeenCalled();
  });

  test("the staff password and the temporary password are never put in the audit trail", async () => {
    await request(app()).post(`/review/${requestId}`).send(inPerson);
    const text = JSON.stringify(logAuditEvent.mock.calls.map(([e]) => ({ ...e, req: undefined })));
    expect(text).not.toContain("correct");
    expect(text).not.toContain(TEMP);
  });
});
