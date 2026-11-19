// Soft delete, restore and purge of employer / jobseeker accounts, and the
// places that must refuse a deleted account (token check, login).

jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../models/User", () => ({ findById: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn(), find: jest.fn() }));
jest.mock("../models/SystemSettings", () => ({ getSingleton: jest.fn() }));
jest.mock("../models/JobVacancy", () => ({ find: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ aggregate: jest.fn() }));
jest.mock("../models/AccountRecoveryRequest", () => ({ updateMany: jest.fn() }));
jest.mock("../models/Conversation", () => ({ find: jest.fn(), deleteMany: jest.fn() }));
jest.mock("../models/Message", () => ({ deleteMany: jest.fn() }));
jest.mock("../models/JobseekerDocument", () => ({ find: jest.fn(), deleteMany: jest.fn() }));
["JobseekerProfile", "EmployerProfile", "JobLike", "NewsLike", "NewsComment", "Follow", "Notification", "ContactShare", "EmailOutbox", "QualificationTemplate", "MatchWeightProfile"].forEach((name) => {
  jest.mock(`../models/${name}`, () => ({ deleteMany: jest.fn() }));
});

const User = require("../models/User");
const SystemSettings = require("../models/SystemSettings");
const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const AccountRecoveryRequest = require("../models/AccountRecoveryRequest");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const JobseekerDocument = require("../models/JobseekerDocument");
const JobLike = require("../models/JobLike");
const svc = require("../services/userDeletionService");
const { query } = require("../testUtils/httpMocks");

const ACTOR = "aaaaaaaaaaaaaaaaaaaaaaaa";
const TARGET = "bbbbbbbbbbbbbbbbbbbbbbbb";
const DAY = 24 * 60 * 60 * 1000;

const deactivated = (over = {}) => ({
  _id: TARGET,
  role: "jobseeker",
  isActive: false,
  accountStatus: "suspended",
  deletedAt: null,
  username: "juan.dc",
  email: undefined,
  ...over,
});

beforeEach(() => {
  jest.resetAllMocks();
  SystemSettings.getSingleton.mockResolvedValue({ deletedAccountGraceDays: 30 });
  JobApplication.aggregate.mockResolvedValue([]);
  JobVacancy.find.mockReturnValue(query([]));
  User.findById.mockImplementation(() => query(deactivated()));
  User.findOneAndUpdate.mockResolvedValue({ _id: TARGET, role: "jobseeker" });
  AccountRecoveryRequest.updateMany.mockResolvedValue({ modifiedCount: 1 });
});

const del = (over = {}) => svc.softDeleteUser({ actorId: ACTOR, targetId: TARGET, reason: "other", confirm: "juan.dc", ...over });
const rejects = async (promise, status, code) => {
  await expect(promise).rejects.toMatchObject({ status, code });
};

describe("softDeleteUser guards", () => {
  test("a superadmin cannot delete their own account", async () => {
    await rejects(del({ targetId: ACTOR }), 400, "DELETE_SELF");
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("admin and superadmin accounts cannot be deleted from this screen", async () => {
    for (const role of ["admin", "superadmin"]) {
      User.findById.mockImplementation(() => query(deactivated({ role })));
      await rejects(del(), 403, "DELETE_STAFF");
    }
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("an active account cannot be deleted before it is deactivated", async () => {
    User.findById.mockImplementation(() => query(deactivated({ isActive: true, accountStatus: "active" })));
    await rejects(del(), 409, "NOT_DEACTIVATED");
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("suspended, banned and self-deactivated accounts can all be deleted", async () => {
    for (const accountStatus of ["suspended", "banned", "deactivated"]) {
      User.findById.mockImplementation(() => query(deactivated({ accountStatus })));
      await expect(del()).resolves.toMatchObject({ reason: "other" });
    }
  });

  test("an unknown user is 404 and an already deleted one is 409", async () => {
    User.findById.mockImplementation(() => query(null));
    await rejects(del(), 404, "NOT_FOUND");
    User.findById.mockImplementation(() => query(deactivated({ deletedAt: new Date() })));
    await rejects(del(), 409, "ALREADY_DELETED");
  });

  test("a reason from the list and the typed username or email are both required", async () => {
    await rejects(del({ reason: "" }), 400, "REASON_REQUIRED");
    await rejects(del({ reason: "because" }), 400, "REASON_REQUIRED");
    await rejects(del({ confirm: "" }), 400, "CONFIRMATION_MISMATCH");
    await rejects(del({ confirm: "someone.else" }), 400, "CONFIRMATION_MISMATCH");
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    // case-insensitive, and an email-bearing account accepts the email
    await expect(del({ confirm: "JUAN.DC" })).resolves.toBeTruthy();
    User.findById.mockImplementation(() => query(deactivated({ username: undefined, email: "a@b.com" })));
    await expect(del({ confirm: "a@b.com" })).resolves.toBeTruthy();
  });

  test("a lost race (the guarded update matches nothing) is a 409, not a silent success", async () => {
    User.findOneAndUpdate.mockResolvedValue(null);
    await rejects(del(), 409, "CONFLICT");
  });

  test("dryRun returns the summary and writes nothing", async () => {
    const result = await svc.softDeleteUser({ actorId: ACTOR, targetId: TARGET, dryRun: true });
    expect(result.summary.role).toBe("jobseeker");
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    expect(AccountRecoveryRequest.updateMany).not.toHaveBeenCalled();
  });
});

describe("softDeleteUser effect", () => {
  test("marks the account, keeps isActive false, revokes sessions and closes recovery requests", async () => {
    const result = await del({ note: "  duplicate of another  " });
    const [filter, update] = User.findOneAndUpdate.mock.calls[0];
    expect(filter).toMatchObject({ _id: TARGET, isActive: false, deletedAt: null });
    expect(update.$inc).toEqual({ tokenVersion: 1 });
    expect(update.$set).toMatchObject({ deletedBy: ACTOR, deleteReason: "other", deleteNote: "duplicate of another" });
    // does not flip isActive or accountStatus, so a restore returns the prior state
    expect(update.$set).not.toHaveProperty("isActive");
    expect(update.$set).not.toHaveProperty("accountStatus");
    expect(AccountRecoveryRequest.updateMany).toHaveBeenCalled();
    expect(result.summary.recoveryRequestsClosed).toBe(1);
  });

  test("purgeAfter uses the grace period in effect now (setting), default 30 days", async () => {
    const before = Date.now();
    const r30 = await del();
    expect(r30.graceDays).toBe(30);
    expect(r30.purgeAfter.getTime() - before).toBeGreaterThanOrEqual(30 * DAY - 1000);

    SystemSettings.getSingleton.mockResolvedValue({ deletedAccountGraceDays: 60 });
    expect((await del()).graceDays).toBe(60);
  });

  test("an out-of-range or missing setting falls back to 30 days", async () => {
    for (const value of [3, 4000, undefined, "x"]) {
      SystemSettings.getSingleton.mockResolvedValue({ deletedAccountGraceDays: value });
      expect((await del()).graceDays).toBe(30);
    }
    SystemSettings.getSingleton.mockRejectedValue(new Error("db"));
    expect((await del()).graceDays).toBe(30);
  });

  test("the summary counts what is affected, from aggregation (employer)", async () => {
    User.findById.mockImplementation(() => query(deactivated({ role: "employer", username: undefined, email: "e@x.com" })));
    JobVacancy.find.mockReturnValue(query([{ _id: "v1", status: "open", isActive: true }, { _id: "v2", status: "closed", isActive: true }]));
    JobApplication.aggregate.mockResolvedValue([{ _id: "hired", count: 2 }, { _id: "shortlisted", count: 3 }, { _id: "rejected", count: 1 }]);
    const { summary } = await del({ confirm: "e@x.com" });
    expect(summary).toMatchObject({ role: "employer", postings: 2, openPostings: 1, applicationsReceived: 6, applicationsInProgress: 3, hires: 2 });
    expect(JobApplication.aggregate).toHaveBeenCalledTimes(1);
  });
});

describe("restoreUser", () => {
  const deleted = (over = {}) => deactivated({ deletedAt: new Date(), purgeAfter: new Date(Date.now() + 5 * DAY), purgedAt: null, ...over });

  test("restores within the grace period back to the deactivated state and revokes tokens again", async () => {
    User.findById.mockImplementation(() => query(deleted()));
    await svc.restoreUser({ targetId: TARGET });
    const [filter, update] = User.findOneAndUpdate.mock.calls[0];
    expect(filter.deletedAt).toEqual({ $ne: null });
    expect(update.$set).toMatchObject({ deletedAt: null, deletedBy: null, deleteReason: null, purgeAfter: null });
    expect(update.$set).not.toHaveProperty("isActive");
    expect(update.$inc).toEqual({ tokenVersion: 1 });
  });

  test("after purgeAfter, or once purged, it is refused (410)", async () => {
    User.findById.mockImplementation(() => query(deleted({ purgeAfter: new Date(Date.now() - 1000) })));
    await rejects(svc.restoreUser({ targetId: TARGET }), 410, "GRACE_ENDED");
    User.findById.mockImplementation(() => query(deleted({ purgedAt: new Date() })));
    await rejects(svc.restoreUser({ targetId: TARGET }), 410, "GRACE_ENDED");
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("an account that is not deleted (409) or is staff (403) is refused", async () => {
    User.findById.mockImplementation(() => query(deactivated()));
    await rejects(svc.restoreUser({ targetId: TARGET }), 409, "NOT_DELETED");
    User.findById.mockImplementation(() => query(deleted({ role: "admin" })));
    await rejects(svc.restoreUser({ targetId: TARGET }), 403, "DELETE_STAFF");
  });
});

describe("purgeUser", () => {
  const due = (over = {}) => ({
    _id: TARGET, role: "jobseeker", deletedAt: new Date(Date.now() - 40 * DAY), purgeAfter: new Date(Date.now() - DAY),
    purgedAt: null, profileImage: "avatar.jpg", resumeFile: "cv.pdf", ...over,
  });
  const wire = (user) => {
    User.findById.mockImplementation(() => query(user));
    JobseekerDocument.find.mockReturnValue(query([{ _id: "d1", storedValue: "doc1" }]));
    JobseekerDocument.deleteMany.mockResolvedValue({ deletedCount: 1 });
    Conversation.find.mockReturnValue(query([{ _id: "c1" }]));
    Message.deleteMany.mockResolvedValue({ deletedCount: 4 });
    Conversation.deleteMany.mockResolvedValue({ deletedCount: 1 });
    ["JobseekerProfile", "EmployerProfile", "NewsLike", "NewsComment", "Follow", "Notification", "ContactShare", "EmailOutbox", "QualificationTemplate", "MatchWeightProfile"].forEach((name) => {
      require(`../models/${name}`).deleteMany.mockResolvedValue({ deletedCount: 0 });
    });
    JobLike.deleteMany.mockResolvedValue({ deletedCount: 2 });
    User.updateOne.mockResolvedValue({ modifiedCount: 1 });
  };
  const storage = () => ({ remove: jest.fn().mockResolvedValue() });

  test("is skipped before purgeAfter, for staff and when already purged", async () => {
    wire(due({ purgeAfter: new Date(Date.now() + DAY) }));
    expect((await svc.purgeUser(TARGET, { storage: storage() })).status).toBe("not_due");
    wire(due({ deletedAt: null, purgeAfter: null }));
    expect((await svc.purgeUser(TARGET, { storage: storage() })).status).toBe("not_due");
    wire(due({ role: "admin" }));
    expect((await svc.purgeUser(TARGET, { storage: storage() })).status).toBe("skipped_role");
    wire(due({ purgedAt: new Date() }));
    expect((await svc.purgeUser(TARGET, { storage: storage() })).status).toBe("already_purged");
    expect(User.updateOne).not.toHaveBeenCalled();
  });

  test("removes personal data and files, then anonymizes the stub and keeps the document", async () => {
    wire(due());
    const files = storage();
    const result = await svc.purgeUser(TARGET, { storage: files });
    expect(result.status).toBe("purged");
    expect(files.remove).toHaveBeenCalledWith("avatar.jpg", { strict: true });
    expect(files.remove).toHaveBeenCalledWith("cv.pdf", { strict: true });
    expect(files.remove).toHaveBeenCalledWith("doc1", { strict: true });
    expect(Message.deleteMany).toHaveBeenCalledWith({ $or: [{ conversationId: { $in: ["c1"] } }, { sender: TARGET }] });
    expect(JobLike.deleteMany).toHaveBeenCalledWith({ userId: TARGET });
    const [filter, update] = User.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: TARGET, purgedAt: null });
    expect(update.$set).toMatchObject({ name: "Deleted user", isActive: false });
    expect(update.$set.purgedAt).toBeInstanceOf(Date);
    ["email", "username", "phone", "profileImage", "businessPermitUrl", "dateOfBirth", "cover"].forEach((f) => expect(update.$unset).toHaveProperty(f));
    expect(result.counts).toMatchObject({ messages: 4, conversations: 1, JobLike: 2 });
  });

  test("never deletes applications, jobs, reports or audit entries (kept as anonymized records)", async () => {
    wire(due());
    await svc.purgeUser(TARGET, { storage: storage() });
    expect(JobApplication.aggregate).not.toHaveBeenCalled();
    expect(JobVacancy.find).not.toHaveBeenCalled();
  });

  test("dryRun changes nothing", async () => {
    wire(due());
    expect((await svc.purgeUser(TARGET, { storage: storage(), dryRun: true })).status).toBe("would_purge");
    expect(User.updateOne).not.toHaveBeenCalled();
  });

  test("a failed file removal leaves the account unpurged, keeps the document rows, and a re-run can retry", async () => {
    wire(due());
    const logs = [];
    const failing = { remove: jest.fn().mockRejectedValue(new Error("cloud down")) };
    const result = await svc.purgeUser(TARGET, { storage: failing, log: (m) => logs.push(m) });
    expect(result.status).toBe("partial");
    expect(result.failures).toBeGreaterThan(0);
    expect(logs.length).toBeGreaterThan(0);
    // the file references must survive for the retry
    expect(User.updateOne).not.toHaveBeenCalled();
    expect(JobseekerDocument.deleteMany).not.toHaveBeenCalled();

    // storage recovers: the same call now finishes
    const retry = await svc.purgeUser(TARGET, { storage: storage() });
    expect(retry.status).toBe("purged");
    expect(JobseekerDocument.deleteMany).toHaveBeenCalledWith({ _id: { $in: ["d1"] } });
    expect(User.updateOne).toHaveBeenCalledTimes(1);
  });

  test("a failed deletion in any personal collection also leaves the account unpurged", async () => {
    wire(due());
    JobLike.deleteMany.mockRejectedValue(new Error("mongo blip"));
    const result = await svc.purgeUser(TARGET, { storage: storage(), log: () => {} });
    expect(result.status).toBe("partial");
    expect(User.updateOne).not.toHaveBeenCalled();
  });

  test("it refuses to run without a storage service", async () => {
    wire(due());
    await expect(svc.purgeUser(TARGET, {})).rejects.toThrow(/storage/);
  });
});

describe("a deleted account is refused", () => {
  test("login() answers ACCOUNT_DELETED before the lock clearing, alerts and self-reactivation", () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "../controllers/authController.js"), "utf8");
    const login = src.slice(src.indexOf("exports.login = async"));
    const deleted = login.indexOf("if (user.deletedAt)");
    expect(deleted).toBeGreaterThan(-1);
    expect(deleted).toBeLessThan(login.indexOf("if (lockable) {"));
    expect(deleted).toBeLessThan(login.indexOf("user.accountStatus === \"deactivated\""));
  });

  const jwt = require("jsonwebtoken");

  test("verifyToken answers 403 ACCOUNT_DELETED (not a suspension) for a valid token", async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
    const { verifyToken } = require("../middleware/auth");
    User.findById.mockImplementation(() => query({
      _id: TARGET, role: "jobseeker", isActive: false, accountStatus: "suspended", tokenVersion: 3, deletedAt: new Date(),
    }));
    const token = jwt.sign({ id: TARGET, tokenVersion: 3 }, process.env.JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${token}` }, cookies: {}, get: () => undefined };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();
    await verifyToken(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "ACCOUNT_DELETED" }));
  });

  test("an old token fails after delete because tokenVersion was bumped", async () => {
    const { verifyToken } = require("../middleware/auth");
    User.findById.mockImplementation(() => query({
      _id: TARGET, role: "jobseeker", isActive: false, accountStatus: "suspended", tokenVersion: 4, deletedAt: new Date(),
    }));
    const token = jwt.sign({ id: TARGET, tokenVersion: 3 }, process.env.JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${token}` }, cookies: {}, get: () => undefined };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await verifyToken(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "SESSION_EXPIRED" }));
  });
});
