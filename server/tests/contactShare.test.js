jest.mock("../models/User", () => ({ findById: jest.fn() }));
jest.mock("../models/Conversation", () => ({ findById: jest.fn() }));
jest.mock("../models/ContactShare", () => ({ findOne: jest.fn(), findOneAndUpdate: jest.fn(), find: jest.fn() }));
jest.mock("../models/JobVacancy", () => ({ find: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ find: jest.fn() }));
jest.mock("../models/Follow", () => ({ exists: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/notificationService", () => ({ createNotificationForUser: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const express = require("express");
const request = require("supertest");

const User = require("../models/User");
const Conversation = require("../models/Conversation");
const ContactShare = require("../models/ContactShare");
const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const Follow = require("../models/Follow");
const { logAuditEvent } = require("../services/auditService");
const { createNotificationForUser } = require("../services/notificationService");
const controller = require("../controllers/contactShareController");
const projection = require("../services/profileProjection");

const CONV = "507f1f77bcf86cd799439011";
const ME = "507f1f77bcf86cd799439012";
const EMP = "507f1f77bcf86cd799439013";
const adult = new Date("1995-01-01T00:00:00.000Z");
const minor = new Date(Date.now() - 16 * 365.25 * 24 * 3600 * 1000);

const appFor = (role = "jobseeker") => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: ME, role };
    next();
  });
  app.get("/:conversationId/share-contact", controller.getShareState);
  app.post("/:conversationId/share-contact", controller.createShare);
  app.delete("/:conversationId/share-contact", controller.revokeShare);
  return app;
};

const setup = ({ me = {}, other = {}, participants = [ME, EMP] } = {}) => {
  const meDoc = { _id: ME, role: "jobseeker", dateOfBirth: adult, phone: "09171234567", email: "ana@example.com", name: "Ana", isActive: true, ...me };
  const otherDoc = { _id: EMP, role: "employer", companyName: "Acme", isActive: true, ...other };
  User.findById.mockImplementation((id) => ({ select: () => Promise.resolve(String(id) === ME ? meDoc : otherDoc) }));
  Conversation.findById.mockReturnValue({ select: () => Promise.resolve({ _id: CONV, participants }) });
};

beforeEach(() => {
  jest.resetAllMocks();
  logAuditEvent.mockResolvedValue(undefined);
  createNotificationForUser.mockResolvedValue(undefined);
});

describe("who can share", () => {
  test.each([
    ["an employer", { me: { role: "employer" } }],
    ["a minor", { me: { dateOfBirth: minor } }],
    ["an unknown date of birth", { me: { dateOfBirth: null } }],
    ["a conversation with another jobseeker", { other: { role: "jobseeker" } }],
    ["a group conversation", { participants: [ME, EMP, "507f1f77bcf86cd799439014"] }],
  ])("%s gets CONTACT_SHARE_NOT_ALLOWED", async (_n, opts) => {
    setup(opts);
    const res = await request(appFor()).post(`/${CONV}/share-contact`).send({ fields: ["phone"] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CONTACT_SHARE_NOT_ALLOWED");
    expect(ContactShare.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("a person who is not in the conversation gets 404", async () => {
    setup({ participants: [EMP, "507f1f77bcf86cd799439014"] });
    const res = await request(appFor()).get(`/${CONV}/share-contact`);
    expect(res.status).toBe(404);
  });

  test("a malformed conversation id is 404", async () => {
    const res = await request(appFor()).get("/nope/share-contact");
    expect(res.status).toBe(404);
  });
});

describe("preview and share", () => {
  test("GET shows the real values to the owner and the current state", async () => {
    setup();
    ContactShare.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });
    const res = await request(appFor()).get(`/${CONV}/share-contact`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      available: true,
      employerName: "Acme",
      values: { phone: "09171234567", email: "ana@example.com" },
      share: { active: false, fields: { phone: false, email: false }, sharedAt: null },
    });
  });

  test.each([[[]], [["fax"]], [["phone", "name"]], ["phone"], [undefined]])("fields %j is CONTACT_SHARE_FIELDS_INVALID", async (fields) => {
    setup();
    const res = await request(appFor()).post(`/${CONV}/share-contact`).send({ fields });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CONTACT_SHARE_FIELDS_INVALID");
  });

  test("an account with no valid phone gets CONTACT_SHARE_NO_CONTACT for phone but can still share email", async () => {
    setup({ me: { phone: "123" } });
    const bad = await request(appFor()).post(`/${CONV}/share-contact`).send({ fields: ["phone"] });
    expect(bad.status).toBe(409);
    expect(bad.body.code).toBe("CONTACT_SHARE_NO_CONTACT");
    ContactShare.findOneAndUpdate.mockReturnValue({ lean: () => Promise.resolve({ fields: { phone: false, email: true }, sharedAt: new Date(), revokedAt: null }) });
    const ok = await request(appFor()).post(`/${CONV}/share-contact`).send({ fields: ["email"] });
    expect(ok.status).toBe(200);
  });

  test("sharing only the phone stores phone true and email false, audits field names only, notifies the employer", async () => {
    setup();
    ContactShare.findOneAndUpdate.mockReturnValue({ lean: () => Promise.resolve({ fields: { phone: true, email: false }, sharedAt: new Date(), revokedAt: null }) });
    const res = await request(appFor()).post(`/${CONV}/share-contact`).send({ fields: ["phone"] });
    expect(res.status).toBe(200);
    expect(res.body.share).toMatchObject({ active: true, fields: { phone: true, email: false } });
    const update = ContactShare.findOneAndUpdate.mock.calls[0][1];
    expect(update.$set.fields).toEqual({ phone: true, email: false });
    expect(update.$set.revokedAt).toBeNull();
    const audit = logAuditEvent.mock.calls[0][0];
    expect(audit.action).toBe("message.contact_shared");
    expect(JSON.stringify(audit.metadata)).not.toMatch(/0917|ana@example/);
    expect(createNotificationForUser.mock.calls[0][0].recipientId).toBe(EMP);
  });
});

describe("revoke", () => {
  test("revoking an active share ends it, audits and notifies", async () => {
    setup();
    const active = { _id: "s1", fields: { phone: true, email: false }, revokedAt: null };
    ContactShare.findOne.mockResolvedValue(active);
    ContactShare.findOneAndUpdate.mockReturnValue({ lean: () => Promise.resolve({ ...active, revokedAt: new Date() }) });
    const res = await request(appFor()).delete(`/${CONV}/share-contact`);
    expect(res.status).toBe(200);
    expect(res.body.share.active).toBe(false);
    expect(logAuditEvent.mock.calls[0][0].action).toBe("message.contact_revoked");
    expect(createNotificationForUser).toHaveBeenCalledTimes(1);
  });

  test("revoking again, or with no share, is idempotent and does nothing", async () => {
    setup();
    ContactShare.findOne.mockResolvedValue({ _id: "s1", fields: { phone: true }, revokedAt: new Date() });
    const again = await request(appFor()).delete(`/${CONV}/share-contact`);
    expect(again.status).toBe(200);
    ContactShare.findOne.mockResolvedValue(null);
    const none = await request(appFor()).delete(`/${CONV}/share-contact`);
    expect(none.status).toBe(200);
    expect(ContactShare.findOneAndUpdate).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe("what the employer sees", () => {
  const seeker = { _id: ME, role: "jobseeker", name: "Ana", email: "ana@example.com", phone: "09171234567", dateOfBirth: adult, privacy: { profileVisibility: "public" }, isActive: true };
  const chain = (v) => ({ select: () => ({ lean: () => Promise.resolve(v) }), distinct: () => Promise.resolve(v) });
  const viewer = { id: EMP, role: "employer" };

  const view = async ({ shares = [], applied = false }) => {
    JobVacancy.find.mockReturnValue(chain(["j1"]));
    JobApplication.find.mockReturnValue(chain(applied ? [{ includePhoto: false }] : []));
    ContactShare.find.mockReturnValue(chain(shares));
    Follow.exists.mockResolvedValue(null);
    const relationship = await projection.resolveRelationship({ viewer, target: seeker });
    return projection.projectJobseeker({ viewer, target: seeker, profile: null, relationship }).user;
  };

  test("a conversation alone (a reply) gives no contact", async () => {
    const user = await view({ shares: [] });
    expect("phone" in user).toBe(false);
    expect("email" in user).toBe(false);
  });

  test("a phone-only share gives only the phone", async () => {
    const user = await view({ shares: [{ fields: { phone: true, email: false } }] });
    expect(user.phone).toBe("09171234567");
    expect("email" in user).toBe(false);
  });

  test("revoking removes access at once (no active share rows)", async () => {
    const user = await view({ shares: [] });
    expect("phone" in user).toBe(false);
    // The resolver only reads shares with revokedAt null.
    expect(ContactShare.find.mock.calls[0][0]).toMatchObject({ employer: EMP, jobseeker: ME, revokedAt: null });
  });
});
