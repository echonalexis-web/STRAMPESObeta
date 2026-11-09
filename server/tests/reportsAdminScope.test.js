// rev 3: PESO admins review reports about jobseeker accounts; suspension and ban
// stay superadmin-only; a superadmin sees everything. Mocked models.

jest.mock("../models/Report", () => {
  const Report = {
    find: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    countDocuments: jest.fn(),
    aggregate: jest.fn(),
    distinct: jest.fn(),
    create: jest.fn(),
  };
  Report.REPORT_TARGET_TYPES = ["user", "job", "news_comment", "news_post", "message", "avatar"];
  Report.REPORT_CATEGORIES = ["illegal_job", "scam_or_fee", "discrimination", "inappropriate_avatar", "harassment", "hate_speech", "spam", "impersonation", "other"];
  Report.REPORT_STATUSES = ["open", "under_review", "action_taken", "dismissed"];
  Report.REPORT_ACTIONS = ["none", "content_removed", "warning", "suspension", "ban"];
  return Report;
});
jest.mock("../models/User", () => ({ find: jest.fn(), findById: jest.fn() }));
jest.mock("../models/JobVacancy", () => ({ findById: jest.fn() }));
jest.mock("../models/NewsComment", () => ({ findById: jest.fn() }));
jest.mock("../models/Announcement", () => ({ findById: jest.fn() }));
jest.mock("../models/AuditLog", () => ({ aggregate: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/notificationService", () => ({
  createNotificationForUser: jest.fn().mockResolvedValue({}),
  notifyManyUsers: jest.fn().mockResolvedValue([]),
}));
jest.mock("../services/sessionService", () => ({ forceLogout: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const express = require("express");
const request = require("supertest");
const Report = require("../models/Report");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const { notifyManyUsers } = require("../services/notificationService");
const controller = require("../controllers/reportController");

const OWNER_ID = "507f1f77bcf86cd799439021";
const REPORT_ID = "507f1f77bcf86cd799439031";
const ADMIN_ID = "507f1f77bcf86cd799439001";

const app = (role) => {
  const a = express();
  a.use(express.json());
  a.use((req, res, next) => {
    req.user = { id: role === "admin" ? ADMIN_ID : "507f1f77bcf86cd799439002", role };
    next();
  });
  a.get("/admin", controller.listReports);
  a.patch("/admin/:id/resolve", controller.resolveReport);
  a.post("/", controller.createReport);
  return a;
};

// find(...).populate().populate().populate().sort().skip().limit().lean()
const listChain = (rows) => {
  const q = {};
  for (const m of ["populate", "sort", "skip", "limit"]) q[m] = jest.fn(() => q);
  q.lean = jest.fn().mockResolvedValue(rows);
  return q;
};
const distinctQuery = (ids) => ({ distinct: jest.fn().mockResolvedValue(ids) });

const reportDoc = (extra = {}) => ({
  _id: REPORT_ID,
  targetType: "user",
  targetOwner: OWNER_ID,
  reporter: "507f1f77bcf86cd799439003",
  category: "scam_or_fee",
  save: jest.fn().mockResolvedValue(undefined),
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  Report.find.mockReturnValue(listChain([]));
  Report.countDocuments.mockResolvedValue(0);
  Report.aggregate.mockResolvedValue([]);
  AuditLog.aggregate.mockResolvedValue([]);
  Report.distinct.mockResolvedValue([OWNER_ID, "507f1f77bcf86cd799439099"]);
  User.find.mockImplementation((filter) =>
    filter && filter._id ? distinctQuery([OWNER_ID]) : { select: jest.fn().mockResolvedValue([{ _id: ADMIN_ID }]) }
  );
  User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ role: "jobseeker", isActive: true }) });
});

describe("list", () => {
  test("a PESO admin is scoped to reports about jobseeker accounts (list, counts, and today's count)", async () => {
    const res = await request(app("admin")).get("/admin");
    expect(res.status).toBe(200);

    const ownerQuery = User.find.mock.calls.find(([f]) => f && f._id)[0];
    expect(ownerQuery).toMatchObject({ role: { $in: ["jobseeker", "employee", "resident"] } });

    const listFilter = Report.find.mock.calls[0][0];
    expect(listFilter).toMatchObject({ targetType: "user", targetOwner: { $in: [OWNER_ID] } });
    expect(Report.countDocuments.mock.calls[0][0]).toMatchObject({ targetType: "user", targetOwner: { $in: [OWNER_ID] } });
    expect(Report.aggregate.mock.calls[0][0][0]).toEqual({ $match: { targetType: "user", targetOwner: { $in: [OWNER_ID] } } });
    expect(Report.countDocuments.mock.calls[1][0]).toMatchObject({ targetType: "user", targetOwner: { $in: [OWNER_ID] } });
  });

  test("a PESO admin cannot widen the scope with a query string", async () => {
    await request(app("admin")).get("/admin?targetType=job");
    expect(Report.find.mock.calls[0][0].targetType).toBe("user");
  });

  test("the superadmin is not scoped", async () => {
    await request(app("superadmin")).get("/admin");
    expect(Report.find.mock.calls[0][0]).toEqual({});
    expect(Report.aggregate.mock.calls[0][0][0]).toEqual({ $match: {} });
    expect(Report.distinct).not.toHaveBeenCalled();
  });
});

describe("resolve", () => {
  beforeEach(() => {
    Report.findById.mockImplementation(() => {
      const doc = reportDoc();
      const q = { populate: jest.fn(() => q), lean: jest.fn().mockResolvedValue({ ...doc, save: undefined }), then: (res, rej) => Promise.resolve(doc).then(res, rej) };
      return q;
    });
  });

  test("an admin may dismiss or record a warning on a jobseeker report", async () => {
    const dismissed = await request(app("admin")).patch(`/admin/${REPORT_ID}/resolve`).send({ status: "dismissed", action: "none" });
    expect(dismissed.status).toBe(200);
    const warned = await request(app("admin")).patch(`/admin/${REPORT_ID}/resolve`).send({ status: "action_taken", action: "warning", note: "Warned" });
    expect(warned.status).toBe(200);
  });

  test.each([["suspension"], ["ban"], ["content_removed"]])("an admin cannot record %s (superadmin only)", async (action) => {
    const res = await request(app("admin")).patch(`/admin/${REPORT_ID}/resolve`).send({ status: "action_taken", action });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("REPORT_ACTION_FORBIDDEN");
    expect(User.findById).toHaveBeenCalledTimes(1); // only the owner role lookup: nobody was suspended
  });

  test("an admin cannot resolve a report about an employer, a job or any other target", async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ role: "employer" }) });
    expect((await request(app("admin")).patch(`/admin/${REPORT_ID}/resolve`).send({ status: "dismissed" })).status).toBe(404);

    Report.findById.mockImplementation(() => ({ then: (res) => Promise.resolve(reportDoc({ targetType: "job" })).then(res) }));
    expect((await request(app("admin")).patch(`/admin/${REPORT_ID}/resolve`).send({ status: "dismissed" })).status).toBe(404);
  });

  test("the superadmin can still suspend", async () => {
    const owner = { _id: OWNER_ID, isActive: true, save: jest.fn().mockResolvedValue(undefined), role: "jobseeker" };
    User.findById.mockReturnValue(Promise.resolve(owner));
    const res = await request(app("superadmin")).patch(`/admin/${REPORT_ID}/resolve`).send({ status: "action_taken", action: "suspension", note: "Scam" });
    expect(res.status).toBe(200);
    expect(owner.isActive).toBe(false);
    expect(owner.accountStatus).toBe("suspended");
  });
});

describe("create", () => {
  const body = { targetType: "user", targetId: OWNER_ID, category: "scam_or_fee", details: "Asked for a fee" };
  beforeEach(() => {
    Report.findOne.mockResolvedValue(null);
    Report.create.mockResolvedValue({ _id: REPORT_ID });
  });

  test("a report about a jobseeker account alerts superadmins AND PESO admins", async () => {
    User.findById.mockImplementation(() => ({ select: jest.fn().mockResolvedValue({ role: "jobseeker", _id: OWNER_ID }), then: (res) => res({ _id: OWNER_ID }) }));
    await request(app("employer")).post("/").send(body);
    const roleQuery = User.find.mock.calls.find(([f]) => f && f.role)[0];
    expect(roleQuery.role.$in.sort()).toEqual(["admin", "superadmin"]);
    expect(notifyManyUsers).toHaveBeenCalled();
  });

  test("a report about anything else alerts superadmins only", async () => {
    User.findById.mockImplementation(() => ({ select: jest.fn().mockResolvedValue({ role: "employer", _id: OWNER_ID }), then: (res) => res({ _id: OWNER_ID }) }));
    await request(app("jobseeker")).post("/").send(body);
    const roleQuery = User.find.mock.calls.find(([f]) => f && f.role)[0];
    expect(roleQuery.role.$in).toEqual(["superadmin"]);
  });
});
