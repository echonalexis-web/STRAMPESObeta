// White-box branch coverage for server/controllers/appealController.js (was 0%).
// Models and services are mocked; controllers are called directly.

jest.mock("../models/Appeal", () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  countDocuments: jest.fn(),
  aggregate: jest.fn(),
}));
jest.mock("../models/User", () => ({ findById: jest.fn(), find: jest.fn() }));
jest.mock("../models/Report", () => ({ aggregate: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue() }));
jest.mock("../services/notificationService", () => ({
  createNotificationForUser: jest.fn().mockResolvedValue(),
  notifyManyUsers: jest.fn().mockResolvedValue(),
}));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const Appeal = require("../models/Appeal");
const User = require("../models/User");
const Report = require("../models/Report");
const { logAuditEvent } = require("../services/auditService");
const { createNotificationForUser, notifyManyUsers } = require("../services/notificationService");
const controller = require("../controllers/appealController");

const OID = "507f1f77bcf86cd799439011";
const OID2 = "507f1f77bcf86cd799439012";

const makeRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};
const makeReq = (o = {}) => ({
  user: { _id: OID, id: OID, role: "superadmin" },
  body: {},
  query: {},
  params: {},
  app: { get: jest.fn().mockReturnValue("io") },
  ...o,
});
const sel = (value) => ({ select: jest.fn().mockResolvedValue(value) });
const lean = (value) => ({ sort: jest.fn().mockReturnThis(), select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(value) });

beforeEach(() => {
  jest.resetAllMocks();
  logAuditEvent.mockResolvedValue();
  createNotificationForUser.mockResolvedValue();
  notifyManyUsers.mockResolvedValue();
});

describe("submitAppeal", () => {
  const suspended = { isActive: false, accountStatus: "suspended", suspensionReason: "spam", name: "Juan" };
  const body = (message) => ({ body: { message } });

  test.each([
    ["missing message", undefined],
    ["whitespace only", "          "],
    ["9 chars after trim", "  123456789  "],
  ])("WB-APL-01 %s is 400 and never touches the DB", async (_n, message) => {
    const res = makeRes();
    await controller.submitAppeal(makeReq(body(message)), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(User.findById).not.toHaveBeenCalled();
  });

  test("WB-APL-02 boundary: exactly 10 chars passes validation, 2001 chars is 400", async () => {
    User.findById.mockReturnValue(sel(null));
    const ok = makeRes();
    await controller.submitAppeal(makeReq(body("1234567890")), ok);
    expect(ok.status).toHaveBeenCalledWith(404); // got past validation
    const tooLong = makeRes();
    await controller.submitAppeal(makeReq(body("x".repeat(2001))), tooLong);
    expect(tooLong.status).toHaveBeenCalledWith(400);
    User.findById.mockReturnValue(sel(null));
    const max = makeRes();
    await controller.submitAppeal(makeReq(body("x".repeat(2000))), max);
    expect(max.status).toHaveBeenCalledWith(404);
  });

  test("WB-APL-03 unknown user is 404", async () => {
    User.findById.mockReturnValue(sel(null));
    const res = makeRes();
    await controller.submitAppeal(makeReq(body("a valid appeal message")), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test("WB-APL-04 active account cannot appeal (400)", async () => {
    User.findById.mockReturnValue(sel({ isActive: true }));
    const res = makeRes();
    await controller.submitAppeal(makeReq(body("a valid appeal message")), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(Appeal.create).not.toHaveBeenCalled();
  });

  test("WB-APL-05 an open appeal blocks a second one (409) and returns it", async () => {
    User.findById.mockReturnValue(sel(suspended));
    Appeal.findOne.mockResolvedValue({ _id: "a1", status: "pending" });
    const res = makeRes();
    await controller.submitAppeal(makeReq(body("a valid appeal message")), res);
    expect(Appeal.findOne).toHaveBeenCalledWith({ user: OID, status: { $in: ["pending", "under_review"] } });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].appeal).toEqual({ _id: "a1", status: "pending" });
    expect(Appeal.create).not.toHaveBeenCalled();
  });

  test.each([
    ["banned", "banned"],
    ["suspended", "suspended"],
    [undefined, "suspended"],
    ["something-else", "suspended"],
  ])("WB-APL-06 account status %s is stored as %s", async (accountStatus, stored) => {
    User.findById.mockReturnValue(sel({ ...suspended, accountStatus, suspensionReason: undefined }));
    Appeal.findOne.mockResolvedValue(null);
    Appeal.create.mockResolvedValue({ _id: "a1" });
    User.find.mockReturnValue(sel([]));
    const res = makeRes();
    await controller.submitAppeal(makeReq(body("  a valid appeal message  ")), res);
    expect(Appeal.create).toHaveBeenCalledWith({
      user: OID,
      accountStatus: stored,
      suspensionReason: null,
      message: "a valid appeal message",
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test("WB-APL-07 success audits as anonymous actor and notifies every superadmin", async () => {
    User.findById.mockReturnValue(sel(suspended));
    Appeal.findOne.mockResolvedValue(null);
    Appeal.create.mockResolvedValue({ _id: "a1" });
    User.find.mockReturnValue(sel([{ _id: "s1" }, { _id: "s2" }]));
    const res = makeRes();
    await controller.submitAppeal(makeReq(body("a valid appeal message")), res);
    expect(User.find).toHaveBeenCalledWith({ role: "superadmin" });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actorRole: "anonymous", action: "appeal.submitted", metadata: { appealId: "a1" } })
    );
    expect(notifyManyUsers).toHaveBeenCalledWith(
      expect.objectContaining({ recipientIds: ["s1", "s2"], message: "Juan submitted an appeal for review." })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test("WB-APL-08 nameless user falls back to 'A user' in the notification", async () => {
    User.findById.mockReturnValue(sel({ ...suspended, name: "" }));
    Appeal.findOne.mockResolvedValue(null);
    Appeal.create.mockResolvedValue({ _id: "a1" });
    User.find.mockReturnValue(sel([]));
    await controller.submitAppeal(makeReq(body("a valid appeal message")), makeRes());
    expect(notifyManyUsers.mock.calls[0][0].message).toBe("A user submitted an appeal for review.");
  });

  test("WB-APL-09 a notification failure is non-fatal: still 201", async () => {
    User.findById.mockReturnValue(sel(suspended));
    Appeal.findOne.mockResolvedValue(null);
    Appeal.create.mockResolvedValue({ _id: "a1" });
    User.find.mockReturnValue(sel([]));
    notifyManyUsers.mockRejectedValue(new Error("smtp"));
    const res = makeRes();
    await controller.submitAppeal(makeReq(body("a valid appeal message")), res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test("WB-APL-10 a DB failure is a generic 500 with no internal message", async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockRejectedValue(new Error("secret internals")) });
    const res = makeRes();
    await controller.submitAppeal(makeReq(body("a valid appeal message")), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: "Failed to submit appeal" });
  });

  test("WB-APL-11 user id is read from req.user.id when _id is absent", async () => {
    User.findById.mockReturnValue(sel(null));
    await controller.submitAppeal(makeReq({ user: { id: OID2 }, body: { message: "a valid appeal message" } }), makeRes());
    expect(User.findById).toHaveBeenCalledWith(OID2);
  });
});

describe("getMyAppeal", () => {
  test.each([
    ["suspended with status", { isActive: false, accountStatus: "banned", suspensionReason: "x", suspendedAt: "d" }, "banned", "x", "d"],
    ["inactive without status", { isActive: false }, "suspended", null, null],
    ["active user", { isActive: true, accountStatus: "banned" }, "active", null, null],
  ])("WB-APL-12 %s", async (_n, user, status, reason, at) => {
    Appeal.findOne.mockReturnValue(lean({ _id: "a1" }));
    User.findById.mockReturnValue(lean(user));
    const res = makeRes();
    await controller.getMyAppeal(makeReq(), res);
    expect(res.json).toHaveBeenCalledWith({
      appeal: { _id: "a1" },
      account: { accountStatus: status, suspensionReason: reason, suspendedAt: at },
    });
  });

  test("WB-APL-13 no appeal and no user gives nulls", async () => {
    Appeal.findOne.mockReturnValue(lean(null));
    User.findById.mockReturnValue(lean(null));
    const res = makeRes();
    await controller.getMyAppeal(makeReq(), res);
    expect(res.json).toHaveBeenCalledWith({ appeal: null, account: null });
  });

  test("WB-APL-14 DB failure is 500", async () => {
    Appeal.findOne.mockImplementation(() => {
      throw new Error("boom");
    });
    const res = makeRes();
    await controller.getMyAppeal(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("listAppeals", () => {
  const findChain = (rows) => {
    const chain = {};
    ["populate", "sort", "skip", "limit"].forEach((m) => (chain[m] = jest.fn().mockReturnValue(chain)));
    chain.lean = jest.fn().mockResolvedValue(rows);
    return chain;
  };
  const setup = (rows = [], statusCounts = [], reportRows = []) => {
    const chain = findChain(rows);
    Appeal.find.mockReturnValue(chain);
    Appeal.countDocuments.mockResolvedValue(rows.length);
    Appeal.aggregate.mockResolvedValue(statusCounts);
    Report.aggregate.mockResolvedValue(reportRows);
    return chain;
  };

  test("WB-APL-15 valid status filter is applied, invalid is ignored", async () => {
    setup();
    await controller.listAppeals(makeReq({ query: { status: "denied" } }), makeRes());
    expect(Appeal.find).toHaveBeenLastCalledWith({ status: "denied" });
    setup();
    await controller.listAppeals(makeReq({ query: { status: "$ne" } }), makeRes());
    expect(Appeal.find).toHaveBeenLastCalledWith({});
  });

  test.each([
    [{}, 1, 50],
    [{ page: "0", limit: "0" }, 1, 50],
    [{ page: "-5", limit: "-5" }, 1, 1],
    [{ page: "abc", limit: "abc" }, 1, 50],
    [{ page: "3", limit: "10" }, 3, 10],
    [{ page: "2", limit: "9999" }, 2, 200],
  ])("WB-APL-16 pagination %j gives page %i limit %i", async (query, page, limit) => {
    const chain = setup();
    const res = makeRes();
    await controller.listAppeals(makeReq({ query }), res);
    expect(chain.skip).toHaveBeenCalledWith((page - 1) * limit);
    expect(chain.limit).toHaveBeenCalledWith(limit);
    expect(res.json.mock.calls[0][0]).toMatchObject({ page, limit });
  });

  test("WB-APL-17 empty result skips the Report aggregate", async () => {
    setup([]);
    const res = makeRes();
    await controller.listAppeals(makeReq(), res);
    expect(Report.aggregate).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0]).toMatchObject({ appeals: [], pendingCount: 0, total: 0 });
  });

  test("WB-APL-18 builds context (suspendedBy, report count) and de-duplicates user ids", async () => {
    const u = { _id: OID, suspendedAt: "d", suspendedBy: { name: "Admin Ann" } };
    setup([{ _id: "a1", user: u }, { _id: "a2", user: u }, { _id: "a3", user: null }], [], [{ _id: OID, n: 4 }]);
    const res = makeRes();
    await controller.listAppeals(makeReq(), res);
    expect(Report.aggregate.mock.calls[0][0][0].$match.targetOwner.$in).toHaveLength(1);
    const { appeals } = res.json.mock.calls[0][0];
    expect(appeals[0].context).toEqual({ suspendedByName: "Admin Ann", suspendedAt: "d", reportsAgainstUser: 4 });
    expect(appeals[2].context).toEqual({ suspendedByName: null, suspendedAt: null, reportsAgainstUser: 0 });
  });

  test("WB-APL-19 user with no reports gets 0", async () => {
    setup([{ _id: "a1", user: { _id: OID } }], [], []);
    const res = makeRes();
    await controller.listAppeals(makeReq(), res);
    expect(res.json.mock.calls[0][0].appeals[0].context.reportsAgainstUser).toBe(0);
  });

  test("WB-APL-20 counts: known statuses are summed, unknown status ignored, pendingCount = pending + under_review", async () => {
    setup([], [
      { _id: "pending", n: 2 },
      { _id: "under_review", n: 3 },
      { _id: "approved", n: 5 },
      { _id: "weird", n: 99 },
    ]);
    Appeal.countDocuments.mockResolvedValue(0);
    const res = makeRes();
    await controller.listAppeals(makeReq(), res);
    const out = res.json.mock.calls[0][0];
    expect(out.pendingCount).toBe(5);
    expect(out.counts).toMatchObject({ pending: 2, under_review: 3, approved: 5, denied: 0 });
    expect(out.counts.weird).toBeUndefined();
  });

  test("WB-APL-21 DB failure is 500", async () => {
    Appeal.find.mockImplementation(() => {
      throw new Error("boom");
    });
    const res = makeRes();
    await controller.listAppeals(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("resolveAppeal", () => {
  const makeAppeal = () => ({ _id: "a1", user: OID2, save: jest.fn().mockResolvedValue() });
  const resolveReq = (decision, extra = {}) => makeReq({ params: { id: "a1" }, body: { decision, ...extra } });

  test.each([undefined, "", "pending", "APPROVED", "approved ", null])("WB-APL-22 invalid decision %p is 400", async (decision) => {
    const res = makeRes();
    await controller.resolveAppeal(resolveReq(decision), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(Appeal.findById).not.toHaveBeenCalled();
  });

  test("WB-APL-23 unknown appeal is 404", async () => {
    Appeal.findById.mockResolvedValue(null);
    const res = makeRes();
    await controller.resolveAppeal(resolveReq("denied"), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test("WB-APL-24 approve reactivates the user and clears every suspension field", async () => {
    const appeal = makeAppeal();
    Appeal.findById.mockResolvedValue(appeal);
    const user = { isActive: false, accountStatus: "suspended", suspensionReason: "x", suspendedAt: "d", suspendedBy: "s", save: jest.fn() };
    User.findById.mockResolvedValue(user);
    const res = makeRes();
    await controller.resolveAppeal(resolveReq("approved", { adminResponse: "  ok  " }), res);
    expect(appeal.status).toBe("approved");
    expect(appeal.adminResponse).toBe("ok");
    expect(appeal.resolvedAt).toBeInstanceOf(Date);
    expect(appeal.reviewedBy).toBe(OID);
    expect(user).toMatchObject({ isActive: true, accountStatus: "active", suspensionReason: null, suspendedAt: null, suspendedBy: null });
    expect(user.save).toHaveBeenCalledWith({ validateModifiedOnly: true });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ severity: "warning", metadata: { appealId: "a1", decision: "approved" } }));
    expect(createNotificationForUser.mock.calls[0][0].title).toBe("Your appeal was approved");
    expect(res.json).toHaveBeenCalledWith({ message: "Appeal updated", appeal });
  });

  test("WB-APL-25 approve when the user no longer exists still succeeds", async () => {
    Appeal.findById.mockResolvedValue(makeAppeal());
    User.findById.mockResolvedValue(null);
    const res = makeRes();
    await controller.resolveAppeal(resolveReq("approved"), res);
    expect(res.json).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test("WB-APL-26 deny sets resolvedAt, does NOT touch the user, and includes the admin note", async () => {
    const appeal = makeAppeal();
    Appeal.findById.mockResolvedValue(appeal);
    await controller.resolveAppeal(resolveReq("denied", { adminResponse: "repeat offence" }), makeRes());
    expect(User.findById).not.toHaveBeenCalled();
    expect(appeal.resolvedAt).toBeInstanceOf(Date);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ severity: "info" }));
    const n = createNotificationForUser.mock.calls[0][0];
    expect(n.title).toBe("Your appeal was denied");
    expect(n.message).toContain("Note: repeat offence");
  });

  test("WB-APL-27 deny without a note has no 'Note:' text and adminResponse is null", async () => {
    const appeal = makeAppeal();
    Appeal.findById.mockResolvedValue(appeal);
    await controller.resolveAppeal(resolveReq("denied"), makeRes());
    expect(appeal.adminResponse).toBeNull();
    expect(createNotificationForUser.mock.calls[0][0].message).not.toContain("Note:");
  });

  test("WB-APL-28 under_review keeps resolvedAt null and does not touch the user", async () => {
    const appeal = makeAppeal();
    appeal.resolvedAt = new Date();
    Appeal.findById.mockResolvedValue(appeal);
    await controller.resolveAppeal(resolveReq("under_review"), makeRes());
    expect(appeal.resolvedAt).toBeNull();
    expect(User.findById).not.toHaveBeenCalled();
    expect(createNotificationForUser.mock.calls[0][0].title).toBe("Your appeal is under review");
  });

  test("WB-APL-29 notification failure is non-fatal", async () => {
    Appeal.findById.mockResolvedValue(makeAppeal());
    createNotificationForUser.mockRejectedValue(new Error("smtp"));
    const res = makeRes();
    await controller.resolveAppeal(resolveReq("denied"), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Appeal updated" }));
  });

  test("WB-APL-30 save failure is a generic 500", async () => {
    const appeal = makeAppeal();
    appeal.save.mockRejectedValue(new Error("validation internals"));
    Appeal.findById.mockResolvedValue(appeal);
    const res = makeRes();
    await controller.resolveAppeal(resolveReq("denied"), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: "Failed to resolve appeal" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
