// White-box branch coverage for superadminController.js and systemSettingsController.js.
// Tests tagged KNOWN-ISSUE pin CURRENT behaviour that looks like a defect (see
// docs/WHITE_BOX_TEST_REPORT.md).

jest.mock("bcryptjs", () => ({ hash: jest.fn() }));
jest.mock("../models/User", () => ({ find: jest.fn(), findOne: jest.fn(), findById: jest.fn(), create: jest.fn() }));
jest.mock("../models/JobVacancy", () => ({ findById: jest.fn(), findByIdAndDelete: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ countDocuments: jest.fn(), deleteMany: jest.fn() }));
jest.mock("../models/SystemSettings", () => ({ getSingleton: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn() }));
jest.mock("../services/notificationService", () => ({ createNotificationForUser: jest.fn() }));
jest.mock("../services/sessionService", () => ({ forceLogout: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const bcrypt = require("bcryptjs");
const User = require("../models/User");
const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const SystemSettings = require("../models/SystemSettings");
const { logAuditEvent } = require("../services/auditService");
const { createNotificationForUser } = require("../services/notificationService");
const { forceLogout } = require("../services/sessionService");
const sa = require("../controllers/superadminController");
const settings = require("../controllers/systemSettingsController");
const { makeReq, query, failingQuery, call } = require("../testUtils/httpMocks");

const SUPER = { id: "sa1", _id: "sa1", role: "superadmin" };
const sreq = (o = {}) => makeReq({ user: SUPER, ...o });
const saveable = (o = {}) => ({ save: jest.fn().mockResolvedValue(), ...o });
const dbError = () => new Error("secret db internals");
const expect500 = (r, message) => {
  expect(r.status).toBe(500);
  expect(r.body).toEqual({ message });
};

beforeEach(() => {
  jest.resetAllMocks();
  bcrypt.hash.mockImplementation(async (p) => `h:${p}`);
  logAuditEvent.mockResolvedValue();
  createNotificationForUser.mockResolvedValue();
});

// ---------------------------------------------------------------------------
describe("superadminController.listAdmins", () => {
  test("WB-SADM-01 lists only role=admin, newest first, mapped to the console view (defaults for missing fields)", async () => {
    const q = query([
      { _id: "a1", name: "A", email: "a@x", staffNote: "HR", isActive: false, mustChangePassword: true, lastLoginAt: "t", createdAt: "c" },
      { _id: "a2", name: "B", email: "b@x" },
    ]);
    User.find.mockReturnValue(q);
    const { body } = await call(sa.listAdmins, sreq());
    expect(User.find).toHaveBeenCalledWith({ role: "admin" });
    expect(q.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(body.admins[0]).toEqual({ id: "a1", name: "A", email: "a@x", staffNote: "HR", isActive: false, mustChangePassword: true, lastLoginAt: "t", createdAt: "c" });
    expect(body.admins[1]).toMatchObject({ staffNote: null, isActive: true, mustChangePassword: false, lastLoginAt: null });
    expect(JSON.stringify(body)).not.toContain("password");
  });

  test("WB-SADM-02 DB failure is a generic 500", async () => {
    User.find.mockReturnValue(failingQuery(dbError()));
    expect500(await call(sa.listAdmins, sreq()), "Failed to load admin accounts");
  });
});

// ---------------------------------------------------------------------------
describe("superadminController.createAdmin", () => {
  const good = { name: " Ann ", email: " ANN@Peso.gov ", staffNote: " HR Officer " };
  const run = (b) => call(sa.createAdmin, sreq({ body: b }));

  test("WB-SADM-03 validation order: name, email format, staff note", async () => {
    expect((await run({})).body.message).toMatch(/name/);
    expect((await run({ name: "A", email: "nope", staffNote: "x" })).body.message).toMatch(/valid email/);
    expect((await run({ name: "A", email: "a b@x.com", staffNote: "x" })).status).toBe(400);
    expect((await run({ name: "A", email: "a@x.com" })).body.message).toMatch(/note/);
    expect((await run({ name: "A", email: "a@x.com", staffNote: "   " })).status).toBe(400);
    expect(User.findOne).not.toHaveBeenCalled();
  });

  test("WB-SADM-04 duplicate email (normalised) is refused", async () => {
    User.findOne.mockReturnValue(query({ _id: "x" }));
    const r = await run(good);
    expect(r.status).toBe(400);
    expect(User.findOne).toHaveBeenCalledWith({ email: "ann@peso.gov" });
    expect(User.create).not.toHaveBeenCalled();
  });

  test("WB-SADM-05 success: role admin, must-change-password, hashed one-time password in 4x4 format, returned once, critical audit", async () => {
    User.findOne.mockReturnValue(query(null));
    User.create.mockImplementation(async (d) => ({ _id: "new", ...d }));
    const r = await run(good);
    expect(r.status).toBe(201);
    expect(r.body.tempPassword).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}(-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}){3}$/);
    const created = User.create.mock.calls[0][0];
    expect(created).toMatchObject({ name: "Ann", email: "ann@peso.gov", role: "admin", mustChangePassword: true, createdBySuperadmin: "sa1", staffNote: "HR Officer", hasCompletedOnboarding: true, onboardingComplete: true });
    expect(created.password).toBe(`h:${r.body.tempPassword}`);
    expect(JSON.stringify(r.body.admin)).not.toContain("h:");
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "superadmin.admin.created", severity: "critical", actorRole: "superadmin" }));
    expect(JSON.stringify(logAuditEvent.mock.calls)).not.toContain(r.body.tempPassword);
  });

  test("WB-SADM-06 two provisioned passwords differ (random)", async () => {
    User.findOne.mockReturnValue(query(null));
    User.create.mockImplementation(async (d) => ({ _id: "new", ...d }));
    const a = (await run(good)).body.tempPassword;
    const b = (await run(good)).body.tempPassword;
    expect(a).not.toBe(b);
  });

  test("WB-SADM-07 DB failure is a generic 500", async () => {
    User.findOne.mockReturnValue(failingQuery(dbError()));
    expect500(await run(good), "Failed to create admin account");
  });
});

// ---------------------------------------------------------------------------
describe("superadminController.setAdminActive", () => {
  const run = (active, id = "a1") => call(sa.setAdminActive, sreq({ params: { id }, body: { active } }));
  const admin = (o = {}) => saveable({ _id: "a1", role: "admin", name: "A", email: "a@x", ...o });

  test.each([["jobseeker"], ["superadmin"], ["employer"]])("WB-SADM-08 a %s account (or no account) is 'Admin account not found'", async (role) => {
    User.findById.mockResolvedValue(admin({ role }));
    expect((await run(true)).status).toBe(404);
    User.findById.mockResolvedValue(null);
    expect((await run(true)).status).toBe(404);
  });

  test("WB-SADM-09 disabling suspends, records who and why, forces logout with ACCOUNT_DISABLED, audits as critical", async () => {
    const a = admin();
    User.findById.mockResolvedValue(a);
    const r = await run(false);
    expect(a).toMatchObject({ isActive: false, accountStatus: "suspended", suspensionReason: "Disabled by the system superadmin", suspendedBy: "sa1" });
    expect(a.suspendedAt).toBeInstanceOf(Date);
    expect(a.save).toHaveBeenCalledWith({ validateModifiedOnly: true });
    expect(forceLogout).toHaveBeenCalledWith("io", "a1", expect.objectContaining({ code: "ACCOUNT_DISABLED" }));
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "superadmin.admin.disabled", severity: "critical" }));
    expect(r.body.message).toBe("Admin account disabled.");
  });

  test.each([[true], ["true"]])("WB-SADM-10 enabling (active=%p) restores the account, clears suspension fields, no forced logout", async (v) => {
    const a = admin({ isActive: false, accountStatus: "suspended", suspensionReason: "x", suspendedAt: "d", suspendedBy: "s" });
    User.findById.mockResolvedValue(a);
    const r = await run(v);
    expect(a).toMatchObject({ isActive: true, accountStatus: "active", suspensionReason: null, suspendedAt: null, suspendedBy: null });
    expect(forceLogout).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "superadmin.admin.enabled" }));
    expect(r.body.message).toBe("Admin account enabled.");
  });

  test.each([[false], ["false"], ["yes"], [1], [undefined], [null]])("WB-SADM-11 active=%p is treated as DISABLE (only true / 'true' enables)", async (v) => {
    const a = admin();
    User.findById.mockResolvedValue(a);
    await run(v);
    expect(a.isActive).toBe(false);
  });

  test("WB-SADM-12 DB failure is a generic 500", async () => {
    User.findById.mockRejectedValue(dbError());
    expect500(await run(true), "Failed to update admin account");
  });
});

// ---------------------------------------------------------------------------
describe("superadminController.resetAdminPassword", () => {
  const run = () => call(sa.resetAdminPassword, sreq({ params: { id: "a1" } }));

  test("WB-SADM-13 only admin accounts can be reset", async () => {
    User.findById.mockResolvedValue(null);
    expect((await run()).status).toBe(404);
    User.findById.mockResolvedValue(saveable({ role: "superadmin" }));
    expect((await run()).status).toBe(404);
  });

  test("WB-SADM-14 success: new hashed one-time password, must-change flag, tokens invalidated (tokenVersion+1, from 0 when unset), critical audit", async () => {
    const a = saveable({ _id: "a1", role: "admin", tokenVersion: 2 });
    User.findById.mockResolvedValue(a);
    const r = await run();
    expect(a).toMatchObject({ password: `h:${r.body.tempPassword}`, mustChangePassword: true, tokenVersion: 3 });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "superadmin.admin.password_reset", severity: "critical" }));
    const b = saveable({ _id: "a1", role: "admin", tokenVersion: undefined });
    User.findById.mockResolvedValue(b);
    await run();
    expect(b.tokenVersion).toBe(1);
  });

  test("WB-SADM-15 DB failure is a generic 500", async () => {
    User.findById.mockRejectedValue(dbError());
    expect500(await run(), "Failed to reset password");
  });
});

// ---------------------------------------------------------------------------
describe("superadminController.deleteJob", () => {
  const run = (body = {}) => call(sa.deleteJob, sreq({ params: { id: "j1" }, body }));
  const wire = (job) => {
    JobVacancy.findById.mockResolvedValue(job);
    JobApplication.countDocuments.mockResolvedValue(3);
    JobApplication.deleteMany.mockResolvedValue();
    JobVacancy.findByIdAndDelete.mockResolvedValue();
  };

  test("WB-SADM-16 unknown job 404, nothing deleted", async () => {
    JobVacancy.findById.mockResolvedValue(null);
    expect((await run()).status).toBe(404);
    expect(JobApplication.deleteMany).not.toHaveBeenCalled();
  });

  test("WB-SADM-17 hard-deletes the vacancy and all its applications, reports the count, audits with the reason, notifies the employer", async () => {
    wire({ _id: "j1", title: "Welder", employer: "emp" });
    const r = await run({ reason: "  scam  " });
    expect(JobApplication.deleteMany).toHaveBeenCalledWith({ vacancy: "j1" });
    expect(JobVacancy.findByIdAndDelete).toHaveBeenCalledWith("j1");
    expect(r.body).toEqual({ message: "Job permanently removed.", removedApplications: 3 });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "superadmin.job.policy_takedown", metadata: { title: "Welder", employer: "emp", reason: "scam", removedApplications: 3 } }));
    expect(createNotificationForUser.mock.calls[0][0].message).toBe('"Welder" was permanently removed for a policy violation: scam');
  });

  test("WB-SADM-18 no reason: reason is null in the audit and absent from the notice; a job without an employer sends no notice", async () => {
    wire({ _id: "j1", title: "Welder", employer: "emp" });
    await run({});
    expect(logAuditEvent.mock.calls[0][0].metadata.reason).toBeNull();
    expect(createNotificationForUser.mock.calls[0][0].message).toBe('"Welder" was permanently removed for a policy violation.');
    createNotificationForUser.mockClear();
    logAuditEvent.mockClear();
    wire({ _id: "j1", title: "Welder", employer: null });
    await run({ reason: "x" });
    expect(createNotificationForUser).not.toHaveBeenCalled();
    expect(logAuditEvent.mock.calls[0][0].metadata.employer).toBe("");
  });

  test("WB-SADM-19 post-delete audit/notification failures are non-fatal (the job is already gone)", async () => {
    wire({ _id: "j1", title: "Welder", employer: "emp" });
    logAuditEvent.mockRejectedValue(new Error("x"));
    createNotificationForUser.mockRejectedValue(new Error("y"));
    expect((await run()).status).toBe(200);
  });

  test("WB-SADM-20 DB failure is a generic 500", async () => {
    JobVacancy.findById.mockRejectedValue(dbError());
    expect500(await run(), "Failed to remove job");
  });
});

// ---------------------------------------------------------------------------
describe("systemSettingsController", () => {
  const upd = (b) => call(settings.updateSystemSettings, sreq({ body: b }));

  test("WB-SSET-01 getSystemSettings returns the four public fields; failure is a generic 500", async () => {
    SystemSettings.getSingleton.mockResolvedValue({ autoCloseDays: 30, appealWindowDays: 14, requireEmployerVerification: true, updatedAt: "t", secret: "x" });
    expect((await call(settings.getSystemSettings, sreq())).body).toEqual({ autoCloseDays: 30, appealWindowDays: 14, requireEmployerVerification: true, deletedAccountGraceDays: 30, updatedAt: "t" });
    SystemSettings.getSingleton.mockRejectedValue(dbError());
    expect500(await call(settings.getSystemSettings, sreq()), "Could not load system settings");
  });

  test.each([[0], [366], [-1], ["abc"], [NaN], [Infinity], [""], [null]])("WB-SSET-02 autoCloseDays %p is rejected", async (v) => {
    const r = await upd({ autoCloseDays: v });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/between 1 and 365/);
    expect(SystemSettings.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test.each([[1, 1], [365, 365], ["30", 30], [29.6, 30], [1.4, 1]])("WB-SSET-03 autoCloseDays %p is stored as %p", async (v, stored) => {
    SystemSettings.findOneAndUpdate.mockResolvedValue({});
    await upd({ autoCloseDays: v });
    expect(SystemSettings.findOneAndUpdate.mock.calls[0][1].$set.autoCloseDays).toBe(stored);
  });

  test.each([[0], [91], ["x"], [""]])("WB-SSET-04 appealWindowDays %p is rejected", async (v) => {
    const r = await upd({ appealWindowDays: v });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/between 1 and 90/);
  });

  test.each([[1, 1], [90, 90], ["14", 14], [1.4, 1], [89.6, 90]])("WB-SSET-05 appealWindowDays %p is stored as %p", async (v, stored) => {
    SystemSettings.findOneAndUpdate.mockResolvedValue({});
    await upd({ appealWindowDays: v });
    expect(SystemSettings.findOneAndUpdate.mock.calls[0][1].$set.appealWindowDays).toBe(stored);
  });

  test("WB-SSET-06 KNOWN-ISSUE: boolean true and single-element arrays coerce through Number() and are accepted as 1 / that number of days", async () => {
    SystemSettings.findOneAndUpdate.mockResolvedValue({});
    await upd({ autoCloseDays: true });
    expect(SystemSettings.findOneAndUpdate.mock.calls[0][1].$set.autoCloseDays).toBe(1);
    await upd({ appealWindowDays: [7] });
    expect(SystemSettings.findOneAndUpdate.mock.calls[1][1].$set.appealWindowDays).toBe(7);
  });

  test.each([["true"], [1], [0], [null]])("WB-SSET-07 requireEmployerVerification %p must be a real boolean", async (v) => {
    const r = await upd({ requireEmployerVerification: v });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/true or false/);
  });

  test("WB-SSET-08 no recognised field, or no body at all, is 400 'No valid settings'", async () => {
    expect((await upd({ unknown: 1 })).body.message).toBe("No valid settings fields were provided.");
    expect((await call(settings.updateSystemSettings, sreq({ body: undefined }))).status).toBe(400);
    expect(SystemSettings.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("WB-SSET-09 success: upserts the singleton with updatedBy, audits the change as a warning, returns the saved values", async () => {
    SystemSettings.findOneAndUpdate.mockResolvedValue({ autoCloseDays: 30, appealWindowDays: 7, requireEmployerVerification: false, deletedAccountGraceDays: 30, updatedAt: "t" });
    const r = await upd({ autoCloseDays: 30, appealWindowDays: 7, requireEmployerVerification: false });
    expect(SystemSettings.findOneAndUpdate).toHaveBeenCalledWith(
      { singletonKey: "global" },
      { $set: { autoCloseDays: 30, appealWindowDays: 7, requireEmployerVerification: false, updatedBy: "sa1" } },
      { new: true, upsert: true }
    );
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "superadmin.system_settings.updated", severity: "warning", targetId: "global" }));
    expect(r.body).toEqual({ message: "System settings saved.", autoCloseDays: 30, appealWindowDays: 7, requireEmployerVerification: false, deletedAccountGraceDays: 30, updatedAt: "t" });
  });

  test("WB-SSET-10 only the provided fields are written (partial update)", async () => {
    SystemSettings.findOneAndUpdate.mockResolvedValue({});
    await upd({ requireEmployerVerification: true });
    expect(SystemSettings.findOneAndUpdate.mock.calls[0][1].$set).toEqual({ requireEmployerVerification: true, updatedBy: "sa1" });
  });

  test("WB-SSET-11 DB failure is a generic 500", async () => {
    SystemSettings.findOneAndUpdate.mockRejectedValue(dbError());
    expect500(await upd({ autoCloseDays: 5 }), "Could not save system settings");
  });
});
