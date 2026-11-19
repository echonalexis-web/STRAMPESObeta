// White-box branch coverage for server/controllers/adminController.js.
// Models/services are mocked; handlers are called directly.
// Tests tagged KNOWN-ISSUE pin CURRENT behaviour that looks like a defect (see
// docs/WHITE_BOX_TEST_REPORT.md).

jest.mock("../controllers/employerController", () => ({ applyJobUpdate: jest.fn() }));
jest.mock("../models/User", () => ({
  countDocuments: jest.fn(), find: jest.fn(), findById: jest.fn(), findByIdAndDelete: jest.fn(),
  aggregate: jest.fn(), updateOne: jest.fn(),
}));
jest.mock("../models/JobVacancy", () => ({
  countDocuments: jest.fn(), find: jest.fn(), findById: jest.fn(), aggregate: jest.fn(), deleteMany: jest.fn(), distinct: jest.fn(),
}));
jest.mock("../models/JobApplication", () => ({
  countDocuments: jest.fn(), find: jest.fn(), aggregate: jest.fn(), distinct: jest.fn(), deleteMany: jest.fn(),
}));
jest.mock("../models/Conversation", () => ({ find: jest.fn(), deleteMany: jest.fn() }));
jest.mock("../models/Message", () => ({ deleteMany: jest.fn() }));
jest.mock("../models/JobseekerProfile", () => ({ find: jest.fn(), findOne: jest.fn() }));
jest.mock("../models/EmployerProfile", () => ({ findOne: jest.fn() }));
jest.mock("../models/AuditLog", () => ({ countDocuments: jest.fn(), aggregate: jest.fn() }));
jest.mock("../utils/jobDisplay", () => ({ getApplicationCountMap: jest.fn(), normalizeFeaturedOrdering: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn() }));
jest.mock("../services/notificationService", () => ({ createNotificationForUser: jest.fn() }));
jest.mock("../services/sessionService", () => ({ forceLogout: jest.fn() }));
jest.mock("../services/storageService", () => ({ remove: jest.fn() }));
jest.mock("../utils/age", () => ({ ...jest.requireActual("../utils/age"), validateDobInput: jest.fn(), getAgeTier: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../services/userDeletionService", () => {
  const actual = jest.requireActual("../services/userDeletionService");
  return { ...actual, softDeleteUser: jest.fn(), restoreUser: jest.fn(), getGraceDays: jest.fn() };
});

const User = require("../models/User");
const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const JobseekerProfile = require("../models/JobseekerProfile");
const EmployerProfile = require("../models/EmployerProfile");
const AuditLog = require("../models/AuditLog");
const { applyJobUpdate } = require("../controllers/employerController");
const { getApplicationCountMap, normalizeFeaturedOrdering } = require("../utils/jobDisplay");
const { logAuditEvent } = require("../services/auditService");
const { createNotificationForUser } = require("../services/notificationService");
const { forceLogout } = require("../services/sessionService");
const storage = require("../services/storageService");
const { validateDobInput, getAgeTier } = require("../utils/age");
const userDeletion = require("../services/userDeletionService");
const c = require("../controllers/adminController");
const { currentManilaYear } = require("../services/analytics/period");
const { makeReq, makeRes, query, failingQuery, call } = require("../testUtils/httpMocks");

const ADMIN = "aaaaaaaaaaaaaaaaaaaaaaaa";
const TARGET = "bbbbbbbbbbbbbbbbbbbbbbbb";

beforeEach(() => {
  jest.resetAllMocks();
  logAuditEvent.mockResolvedValue();
  createNotificationForUser.mockResolvedValue();
  getApplicationCountMap.mockResolvedValue({});
  normalizeFeaturedOrdering.mockResolvedValue();
  storage.remove.mockResolvedValue();
});

const adminReq = (o = {}) => makeReq({ user: { id: ADMIN, _id: ADMIN, role: "admin" }, ...o });
const saveable = (o = {}) => ({ save: jest.fn().mockResolvedValue(), ...o });
const dbError = () => new Error("secret db internals");
const expect500 = (r, message) => {
  expect(r.status).toBe(500);
  expect(r.body).toEqual({ message });
};

// ---------------------------------------------------------------------------
describe("exported pure helpers", () => {
  test.each([
    ["draft", "pending"], ["pending", "pending"], ["review", "pending"], ["  ACTIVE ", "active"],
    ["closed", "closed"], ["filled", "closed"], ["hired", "closed"], ["completed", "closed"],
    ["rejected", "rejected"], ["declined", "rejected"], ["denied", "rejected"],
    ["whatever", "pending"], ["", "pending"], [undefined, "pending"], [null, "pending"],
  ])("WB-ADM-01 normalizeAdminJobStatus(%p) = %s", (input, out) => {
    expect(c.normalizeAdminJobStatus(input)).toBe(out);
  });

  test.each([
    ["Boac", "Boac (Capital)"], ["the capital", "Boac (Capital)"], ["Santa Cruz", "Santa Cruz"], ["GASAN town", "Gasan"],
    ["Mogpog", "Mogpog"], ["Torrijos", "Torrijos"], ["Buenavista", "Buenavista"],
    ["Other / Outside Province", "Other / Outside Province"], ["other marinduque", "Other / Outside Province"],
    ["Manila", "Other / Outside Province"], ["", "Other / Outside Province"], [undefined, "Other / Outside Province"],
  ])("WB-ADM-02 normalizeMunicipalityLabel(%p) = %s", (input, out) => {
    expect(c.normalizeMunicipalityLabel(input)).toBe(out);
  });

  test("WB-ADM-03 escapeRegExp escapes metacharacters and tolerates empty input", () => {
    expect(c.escapeRegExp("a.b*c")).toBe("a\\.b\\*c");
    expect(c.escapeRegExp()).toBe("");
    expect(c.escapeRegExp(null)).toBe("");
  });
});

// ---------------------------------------------------------------------------
describe("getAdminAnalytics", () => {
  // yearlyApps / yearlyUsers: [{ _id: month (1-12), count }]; apps: [{ _id: lower-cased status, count }]
  const setup = ({ yearlyApps = [], yearlyUsers = [], apps = [] } = {}) => {
    User.countDocuments.mockResolvedValueOnce(10).mockResolvedValueOnce(3).mockResolvedValueOnce(6).mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    // totalVacancies, activeJobs (what the public can see), activeJobsAll (status active), closedJobs
    JobVacancy.countDocuments.mockResolvedValueOnce(20).mockResolvedValueOnce(12).mockResolvedValueOnce(15).mockResolvedValueOnce(8);
    User.find.mockReturnValue(query([])); // the unlisted-employer lookup behind the visibility rule
    JobApplication.countDocuments.mockResolvedValue(30);
    JobApplication.aggregate.mockResolvedValueOnce(yearlyApps).mockResolvedValueOnce(apps);
    User.aggregate.mockResolvedValue(yearlyUsers);
    AuditLog.countDocuments.mockResolvedValue(4);
  };

  test("WB-ADM-04 returns every counter in order", async () => {
    setup();
    const r = await call(c.getAdminAnalytics);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      totalAccounts: 10, totalEmployers: 3, totalJobSeekers: 6, totalVacancies: 20, totalApplications: 30,
      verifiedEmployers: 2, pendingVerification: 1, activeJobs: 12, activeJobsAll: 15, closedJobs: 8, auditEventsToday: 4,
    });
    expect(User.countDocuments).toHaveBeenNthCalledWith(1, { role: { $ne: "superadmin" }, deletedAt: null });
  });

  test("WB-ADM-05 monthly buckets come from the database month groups; out-of-range months are ignored", async () => {
    setup({
      yearlyApps: [{ _id: 1, count: 1 }, { _id: 3, count: 1 }, { _id: 13, count: 9 }, { _id: 0, count: 9 }],
      yearlyUsers: [{ _id: 12, count: 1 }],
    });
    const { body } = await call(c.getAdminAnalytics);
    expect(body.applicationsThisMonth[0]).toBe(1);
    expect(body.applicationsThisMonth[2]).toBe(1);
    expect(body.applicationsThisMonth.reduce((a, b) => a + b, 0)).toBe(2);
    expect(body.registrationsThisMonth[11]).toBe(1);
    expect(body.registrationsThisMonth.reduce((a, b) => a + b, 0)).toBe(1);
  });

  test("WB-ADM-06 status counts: 'accepted' counts as hired, unknown statuses ignored", async () => {
    setup({ apps: [{ _id: "pending", count: 1 }, { _id: "reviewed", count: 1 }, { _id: "accepted", count: 1 }, { _id: "hired", count: 1 }, { _id: "rejected", count: 1 }, { _id: "shortlisted", count: 1 }, { _id: "weird", count: 1 }, { _id: "", count: 1 }] });
    const { body } = await call(c.getAdminAnalytics);
    expect(body.applicationsByStatus).toEqual({ pending: 1, under_review: 0, reviewed: 1, shortlisted: 1, approved: 0, rejected: 1, hired: 2, withdrawn: 0 });
  });

  test("WB-ADM-07 DB failure is a generic 500", async () => {
    User.countDocuments.mockRejectedValue(dbError());
    JobVacancy.countDocuments.mockResolvedValue(0);
    JobApplication.countDocuments.mockResolvedValue(0);
    JobApplication.aggregate.mockResolvedValue([]);
    User.aggregate.mockResolvedValue([]);
    User.find.mockReturnValue(query([]));
    AuditLog.countDocuments.mockResolvedValue(0);
    expect500(await call(c.getAdminAnalytics), "Failed to fetch analytics");
  });
});

// ---------------------------------------------------------------------------
describe("getProvincialAnalytics", () => {
  const setup = (o = {}) => {
    User.aggregate.mockResolvedValue(o.regs || []);
    JobApplication.aggregate.mockResolvedValueOnce(o.apps || []).mockResolvedValueOnce(o.placement || []).mockResolvedValueOnce(o.applicantRows || []);
    JobVacancy.countDocuments.mockResolvedValueOnce(o.active ?? 0).mockResolvedValueOnce(o.closed ?? 0);
    JobVacancy.aggregate
      .mockResolvedValueOnce(o.avgFill || [])
      .mockResolvedValueOnce(o.sectors || [])
      .mockResolvedValueOnce(o.roles || [])
      .mockResolvedValueOnce(o.munis || []);
  };
  const get = (q = {}) => call(c.getProvincialAnalytics, adminReq({ query: q }));

  test("WB-ADM-08 empty data: defaults to the current Manila year, ALL, zeros, 12 months", async () => {
    setup();
    const { body } = await get();
    expect(body.period).toBe(String(currentManilaYear()));
    expect(body.selectedMunicipality).toBe("ALL");
    expect(body.metrics).toEqual({ placementRate: 0, avgDaysToFill: 0, activeVacancies: 0, closedVacancies: 0, activeVsClosedRatio: "0:0" });
    expect(body.months).toHaveLength(12);
    expect(body.months.every((m) => m.registered === 0 && m.applied === 0)).toBe(true);
    expect(body.municipalities).toHaveLength(7);
    expect(body.municipalities.every((m) => m.value === 0 && m.percent === 0)).toBe(true);
    expect(body.topSectors).toEqual([]);
    expect(body.topRoles).toEqual([]);
  });

  test.each([["2024", "2024"], ["abc", "CURRENT"], ["0", "CURRENT"], ["", "CURRENT"]])("WB-ADM-09 year %p gives period %s", async (year, period) => {
    setup();
    expect((await get({ year })).body.period).toBe(period === "CURRENT" ? String(currentManilaYear()) : period);
  });

  test("WB-ADM-10 monthly registration and application counts land in the right month", async () => {
    setup({ regs: [{ _id: { month: 1 }, registered: 5 }, { _id: { month: 12 }, registered: 2 }], apps: [{ _id: { month: 3 }, applied: 7 }] });
    const { body } = await get();
    expect(body.months[0]).toEqual({ month: "Jan", registered: 5, applied: 0 });
    expect(body.months[2]).toEqual({ month: "Mar", registered: 0, applied: 7 });
    expect(body.months[11]).toEqual({ month: "Dec", registered: 2, applied: 0 });
  });

  test.each([
    ["Boac", "Boac (Capital)", /boac\|capital/],
    ["Santa Cruz", "Santa Cruz", /santa/],
    ["Gasan", "Gasan", /gasan/],
    ["Mogpog", "Mogpog", /mogpog/],
    ["Torrijos", "Torrijos", /torrijos/],
    ["Buenavista", "Buenavista", /buenavista/],
    ["Other / Outside Province", "Other / Outside Province", /\(\?!/],
    ["Atlantis", "Atlantis", /\(\?!/],
  ])("WB-ADM-11 municipality filter %p", async (q, selected, pattern) => {
    setup();
    const { body } = await get({ municipality: q });
    expect(body.selectedMunicipality).toBe(selected);
    const filter = JobVacancy.countDocuments.mock.calls[0][0];
    expect(filter.location.$regex).toMatch(pattern);
    expect(filter.location.$options).toBe("i");
  });

  test("WB-ADM-12 municipality ALL (or blank) adds no location filter", async () => {
    setup();
    await get({ municipality: "ALL" });
    expect(JobVacancy.countDocuments.mock.calls[0][0].location).toBeUndefined();
  });

  test("WB-ADM-13 placement rate and ratio", async () => {
    setup({ placement: [{ totalApplications: 8, hiredApplications: 3 }], active: 5, closed: 2 });
    const { body } = await get();
    expect(body.metrics.placementRate).toBe(37.5);
    expect(body.metrics.activeVsClosedRatio).toBe("5:2");
    expect(body.metrics.activeVacancies).toBe(5);
    expect(body.metrics.closedVacancies).toBe(2);
  });

  test("WB-ADM-14 placement summary with zero applications gives rate 0 (no divide by zero)", async () => {
    setup({ placement: [{ totalApplications: 0, hiredApplications: 0 }] });
    expect((await get()).body.metrics.placementRate).toBe(0);
  });

  test.each([[12.345, 12.3], [0, 0], [undefined, 0]])("WB-ADM-15 avgDaysToFill %p gives %p", async (avg, out) => {
    setup({ avgFill: [{ avgDaysToFill: avg }] });
    expect((await get()).body.metrics.avgDaysToFill).toBe(out);
  });

  test("WB-ADM-16 topSectors normalises names, merges duplicates, sorts and keeps 5", async () => {
    setup({
      sectors: [
        { _id: "Public Administration", vacancies: 2 },
        { _id: "Government public service", vacancies: 3 },
        { _id: "Agriculture", vacancies: 1 },
        { _id: "Fishing", vacancies: 1 },
        { _id: "Retail shop", vacancies: 4 },
        { _id: "Wholesale", vacancies: 1 },
        { _id: "Commerce", vacancies: 1 },
        { _id: "Hotel", vacancies: 1 },
        { _id: "Tourism", vacancies: 1 },
        { _id: "Customer support", vacancies: 1 },
        { _id: "Child care", vacancies: 1 },
        { _id: "IT", vacancies: 9 },
        { _id: "", vacancies: 1 },
        { _id: "BPO", vacancies: undefined },
      ],
    });
    const { body } = await get();
    // Tourism & Hospitality (2) ties with Agriculture & Fisheries (2) and is cut by slice(0, 5).
    expect(body.topSectors).toEqual([
      { sector: "IT", vacancies: 9 },
      { sector: "Wholesale & Retail", vacancies: 6 },
      { sector: "Public Sector", vacancies: 5 },
      { sector: "Services", vacancies: 3 },
      { sector: "Agriculture & Fisheries", vacancies: 2 },
    ]);
  });

  test("WB-ADM-17 topRoles are sorted by vacancies and limited to 5", async () => {
    setup({ roles: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ _id: `r${n}`, vacancies: n })).concat([{ _id: "none" }]) });
    const { body } = await get();
    expect(body.topRoles.map((r) => r.title)).toEqual(["r7", "r6", "r5", "r4", "r3"]);
  });

  test("WB-ADM-18 vacancy municipality breakdown computes percent and sorts", async () => {
    setup({ munis: [{ _id: "Boac (Capital)", value: 3 }, { _id: "Gasan", value: 1 }] });
    const { body } = await get();
    expect(body.municipalities[0]).toEqual({ municipality: "Boac (Capital)", value: 3, percent: 75 });
    expect(body.municipalities[1]).toEqual({ municipality: "Gasan", value: 1, percent: 25 });
  });

  test("WB-ADM-19 applicant municipalities: rows are grouped by address, province rules, 'Other' bucket", async () => {
    // rows as the aggregation returns them: one per distinct (municipality, province) pair with a count
    setup({
      applicantRows: [
        { _id: { municipality: "Boac", province: "Marinduque" }, count: 1 },
        { _id: { municipality: " Gasan ", province: "Marinduque" }, count: 1 },
        { _id: { municipality: "Mogpog", province: "Marinduque" }, count: 1 },
        { _id: { municipality: "Quezon City", province: "Metro Manila" }, count: 1 },
        { _id: { municipality: "Faraway", province: "Marinduque" }, count: 1 },
        { _id: { municipality: "", province: "" }, count: 2 },
        { _id: { municipality: "Boac", province: "" }, count: 1 },
      ],
    });
    const { body } = await get();
    const byName = Object.fromEntries(body.applicantMunicipalities.map((m) => [m.municipality, m.value]));
    expect(byName["Boac (Capital)"]).toBe(1);
    expect(byName.Gasan).toBe(1);
    expect(byName.Mogpog).toBe(1);
    expect(byName.Other).toBe(5);
    expect(body.applicantMunicipalities[0].municipality).toBe("Other");
    expect(JobseekerProfile.find).not.toHaveBeenCalled();
  });

  test("WB-ADM-20 DB failure is a generic 500", async () => {
    User.aggregate.mockRejectedValue(dbError());
    JobApplication.aggregate.mockResolvedValue([]);
    expect500(await get(), "Failed to fetch provincial analytics");
  });
});

// ---------------------------------------------------------------------------
describe("getAllUsers", () => {
  const run = (q = {}, rows = [], total = 0) => {
    User.countDocuments.mockResolvedValue(total);
    const q1 = query(rows);
    User.find.mockReturnValue(q1);
    return call(c.getAllUsers, adminReq({ query: q })).then((r) => ({ ...r, q1 }));
  };

  test("WB-ADM-21 default filter hides superadmin; defaults page 1 limit 20", async () => {
    const r = await run();
    expect(User.find).toHaveBeenCalledWith({ role: { $ne: "superadmin" }, deletedAt: null });
    expect(r.q1.skip).toHaveBeenCalledWith(0);
    expect(r.q1.limit).toHaveBeenCalledWith(20);
    expect(r.body).toMatchObject({ total: 0, totalPages: 1, currentPage: 1 });
  });

  test.each(["employer", "jobseeker", "admin"])("WB-ADM-22 role %s is applied", async (role) => {
    await run({ role });
    expect(User.find.mock.calls[0][0].role).toBe(role);
  });

  test("WB-ADM-23 role=superadmin (or junk) can never be requested", async () => {
    await run({ role: "superadmin" });
    expect(User.find.mock.calls[0][0].role).toEqual({ $ne: "superadmin" });
    await run({ role: "$ne" });
    expect(User.find.mock.calls[1][0].role).toEqual({ $ne: "superadmin" });
  });

  test("WB-ADM-24 verificationStatus and isActive filters accept only allowed values", async () => {
    await run({ verificationStatus: "verified", isActive: "false" });
    expect(User.find.mock.calls[0][0]).toMatchObject({ verificationStatus: "verified", isActive: false });
    await run({ verificationStatus: "bogus", isActive: "maybe" });
    const f = User.find.mock.calls[1][0];
    expect(f.verificationStatus).toBeUndefined();
    expect(f.isActive).toBeUndefined();
    await run({ isActive: "true" });
    expect(User.find.mock.calls[2][0].isActive).toBe(true);
  });

  test("WB-ADM-25 search builds an escaped $or over name, email and username", async () => {
    await run({ search: "a.b(" });
    const f = User.find.mock.calls[0][0];
    expect(f.$and[0].$or).toHaveLength(3);
    expect(f.$and[0].$or[0].name.$regex).toBe("a\\.b\\(");
  });

  test("WB-ADM-26 pagination maths", async () => {
    const r = await run({ page: "3", limit: "10" }, [], 25);
    expect(r.q1.skip).toHaveBeenCalledWith(20);
    expect(r.body).toMatchObject({ totalPages: 3, currentPage: 3 });
    const bad = await run({ page: "-4", limit: "0" });
    expect(bad.body.currentPage).toBe(1);
    expect(bad.q1.limit).toHaveBeenCalledWith(20);
  });

  test("WB-ADM-27 KNOWN-ISSUE: limit has no upper bound (other list endpoints cap at 50/100/200)", async () => {
    const r = await run({ limit: "5000000" });
    expect(r.q1.limit).toHaveBeenCalledWith(5000000);
  });

  test("WB-ADM-28 DB failure is a generic 500", async () => {
    User.countDocuments.mockRejectedValue(dbError());
    User.find.mockReturnValue(query([]));
    expect500(await call(c.getAllUsers, adminReq()), "Failed to fetch users");
  });
});

// ---------------------------------------------------------------------------
describe("getAuditLogs", () => {
  const run = (q = {}, result = [{ data: [], totalCount: [] }]) => {
    AuditLog.aggregate.mockResolvedValue(result);
    return call(c.getAuditLogs, adminReq({ query: q }));
  };
  const pipeline = () => AuditLog.aggregate.mock.calls[AuditLog.aggregate.mock.calls.length - 1][0];
  const match = () => pipeline()[0].$match;

  test("WB-ADM-29 no filters: empty match, defaults page 1 limit 20, empty result", async () => {
    const r = await run();
    expect(match()).toEqual({});
    expect(r.body).toEqual({ items: [], total: 0, currentPage: 1, totalPages: 1 });
    const facet = pipeline()[pipeline().length - 1].$facet;
    expect(facet.data).toEqual([{ $sort: { createdAt: -1 } }, { $skip: 0 }, { $limit: 20 }]);
  });

  test("WB-ADM-30 aggregate returning nothing is tolerated", async () => {
    const r = await run({}, []);
    expect(r.body).toMatchObject({ items: [], total: 0 });
  });

  test("WB-ADM-31 action filter is an escaped case-insensitive regex", async () => {
    await run({ action: "auth.login" });
    expect(match().$and[0]).toEqual({ action: { $regex: "auth\\.login", $options: "i" } });
  });

  test.each([["info", true], ["warning", true], ["critical", true], ["debug", false], ["", false]])("WB-ADM-32 severity %p applied=%p", async (severity, applied) => {
    await run({ severity });
    expect(Boolean(match().$and)).toBe(applied);
  });

  test("WB-ADM-33 category: every known key maps to prefixes; 'all' and unknown are ignored", async () => {
    await run({ category: "auth-security" });
    expect(match().$and[0].$or).toEqual([{ action: { $regex: "^auth\\." } }]);
    await run({ category: "user-management" });
    expect(match().$and[0].$or).toHaveLength(2);
    await run({ category: "all" });
    expect(match()).toEqual({});
    await run({ category: "constructor" });
    expect(match()).toEqual({});
  });

  test("WB-ADM-34 date range: valid from/to, invalid dates ignored, both invalid adds nothing", async () => {
    await run({ fromDate: "2026-01-01", toDate: "2026-01-31" });
    const cond = match().$and[0].createdAt;
    expect(cond.$gte).toBeInstanceOf(Date);
    expect(cond.$lte).toBeInstanceOf(Date);
    await run({ fromDate: "2026-01-01" });
    expect(match().$and[0].createdAt.$lte).toBeUndefined();
    await run({ toDate: "2026-01-31" });
    expect(match().$and[0].createdAt.$gte).toBeUndefined();
    await run({ fromDate: "nope", toDate: "nope" });
    expect(match()).toEqual({});
    await run({ fromDate: "nope", toDate: "2026-02-01" });
    expect(match().$and[0].createdAt).toEqual({ $lte: expect.any(Date) });
  });

  test("WB-ADM-35 search adds a second $match over six fields", async () => {
    await run({ search: "bob" });
    const stages = pipeline();
    const searchStage = stages[stages.length - 2].$match;
    expect(searchStage.$or).toHaveLength(6);
  });

  test("WB-ADM-36 limit is clamped to 1..100 and page to >=1", async () => {
    await run({ limit: "9999", page: "2" });
    const facet = pipeline()[pipeline().length - 1].$facet;
    expect(facet.data[1]).toEqual({ $skip: 100 });
    expect(facet.data[2]).toEqual({ $limit: 100 });
    await run({ limit: "-3", page: "0" });
    expect(pipeline()[pipeline().length - 1].$facet.data[2]).toEqual({ $limit: 1 });
    await run({ limit: "0", page: "abc" });
    expect(pipeline()[pipeline().length - 1].$facet.data[2]).toEqual({ $limit: 20 });
  });

  test("WB-ADM-37 actor/target lookups are flattened; fall back to raw ids when no lookup match", async () => {
    const r = await run({}, [{
      data: [
        { _id: 1, actorId: "a", targetUserId: "t", actorInfo: { _id: "a", name: "A", email: "a@x", role: "admin", password: "x" }, targetInfo: { _id: "t", name: "T", email: "t@x", role: "jobseeker" } },
        { _id: 2, actorId: "a2", targetUserId: "t2" },
      ],
      totalCount: [{ count: 45 }],
    }]);
    expect(r.body.items[0].actorId).toEqual({ _id: "a", name: "A", email: "a@x", role: "admin" });
    expect(r.body.items[0].targetUserId).toEqual({ _id: "t", name: "T", email: "t@x", role: "jobseeker" });
    expect(r.body.items[1]).toMatchObject({ actorId: "a2", targetUserId: "t2" });
    expect(r.body).toMatchObject({ total: 45, totalPages: 3 });
  });

  test("WB-ADM-38 DB failure is a generic 500", async () => {
    AuditLog.aggregate.mockRejectedValue(dbError());
    expect500(await call(c.getAuditLogs, adminReq()), "Failed to load audit logs");
  });
});

// ---------------------------------------------------------------------------
describe("vacancy filter, list and stats", () => {
  const runList = (q = {}, jobs = [], total = jobs.length) => {
    JobVacancy.countDocuments.mockResolvedValue(total);
    const q1 = query(jobs);
    JobVacancy.find.mockReturnValue(q1);
    return call(c.getAdminVacancies, adminReq({ query: q })).then((r) => ({ ...r, q1 }));
  };
  const filter = () => JobVacancy.countDocuments.mock.calls[JobVacancy.countDocuments.mock.calls.length - 1][0];

  test("WB-ADM-39 no query: empty filter", async () => {
    await runList();
    expect(filter()).toEqual({});
  });

  test("WB-ADM-40 search builds an $or over title, industry, description, location", async () => {
    await runList({ search: "weld" });
    expect(filter().$or).toHaveLength(4);
  });

  test("WB-ADM-41 municipality: named town uses a regex, 'Other' and unknown use a negative regex, 'all' none", async () => {
    await runList({ municipality: "Gasan" });
    expect(filter().location.$regex).toBe("gasan");
    await runList({ municipality: "Other / Outside Province" });
    expect(filter().location.$not).toBeInstanceOf(RegExp);
    await runList({ municipality: "Atlantis" });
    expect(filter().location.$not).toBeInstanceOf(RegExp);
    await runList({ municipality: "all" });
    expect(filter().location).toBeUndefined();
  });

  test.each([["active", "active"], ["closed", "closed"], ["filled", "closed"], ["rejected", "rejected"], ["denied", "rejected"]])(
    "WB-ADM-42 status %p filters status=%s", async (status, expected) => {
      await runList({ status });
      expect(filter().status).toBe(expected);
    }
  );

  test.each(["pending", "draft", "review", "bogus"])("WB-ADM-43 status %p maps to pending: not active, closed or rejected", async (status) => {
    await runList({ status });
    expect(filter().status).toEqual({ $nin: ["active", "closed", "filled", "hired", "completed", "rejected", "declined", "denied"] });
    expect(filter().$or).toBeUndefined();
  });

  test("WB-ADM-44 search + status=pending are two separate conditions (AND); the old merged-$or defect is fixed", async () => {
    await runList({ search: "weld", status: "pending" });
    expect(filter().$or).toHaveLength(4);
    expect(filter().status.$nin).toContain("active");
  });

  test("WB-ADM-45 category adds an escaped industry regex; 'all' adds none", async () => {
    await runList({ category: "IT (BPO)" });
    expect(filter().industry.$regex).toBe("IT \\(BPO\\)");
    await runList({ category: "all" });
    expect(filter().industry).toBeUndefined();
  });

  test("WB-ADM-46 pagination clamps limit to 1..50 and page to >=1", async () => {
    let r = await runList({ page: "3", limit: "10" }, [], 25);
    expect(r.q1.skip).toHaveBeenCalledWith(20);
    expect(r.body).toMatchObject({ page: 3, limit: 10, totalPages: 3 });
    r = await runList({ limit: "999" });
    expect(r.body.limit).toBe(50);
    r = await runList({ page: "0", limit: "0" });
    expect(r.body).toMatchObject({ page: 1, limit: 1 });
    r = await runList({});
    expect(r.body).toMatchObject({ page: 1, limit: 10 });
    r = await runList({}, [], 0);
    expect(r.body.totalPages).toBe(1);
  });

  test("WB-ADM-47 KNOWN-ISSUE: non-numeric page/limit become NaN and reach skip()/limit()", async () => {
    const r = await runList({ page: "abc", limit: "xyz" });
    expect(Number.isNaN(r.body.page)).toBe(true);
    expect(Number.isNaN(r.body.limit)).toBe(true);
    expect(Number.isNaN(r.q1.skip.mock.calls[0][0])).toBe(true);
  });

  test("WB-ADM-48 job mapping: severity thresholds, industry join, salary fallback, employer defaults, applicant counts", async () => {
    getApplicationCountMap.mockResolvedValue({ j1: 4 });
    const r = await runList({}, [
      { _id: "j1", title: "A", slots: 8, status: "draft", location: "Boac", industry: ["IT", "BPO"], salary: "20k", isActive: 1, employer: { _id: "e", name: "E", companyName: "Co", email: "e@x", verificationStatus: "verified" }, qualifications: [{ a: 1 }] },
      { _id: "j2", slots: 4, status: "closed", industry: "Retail", salaryMin: 1, salaryMax: 2 },
      { _id: "j3", slots: 3, industry: [], location: undefined },
      { _id: "j4", slots: 7, industry: [null, ""], salaryMin: 5 },
    ]);
    const [j1, j2, j3, j4] = r.body.jobs;
    expect(j1).toMatchObject({ severity: "High Demand", industry: "IT, BPO", salary: "20k", status: "pending", municipality: "Boac (Capital)", applicantCount: 4, isActive: true });
    expect(j1.employer.verificationStatus).toBe("verified");
    expect(j2).toMatchObject({ severity: "Priority", industry: "Retail", salary: "₱1 - ₱2", status: "closed", applicantCount: 0, qualifications: [] });
    expect(j2.employer).toEqual({ _id: undefined, name: undefined, companyName: undefined, email: undefined, verificationStatus: "unverified" });
    expect(j3).toMatchObject({ severity: "Standard", industry: "General", municipality: "Other / Outside Province" });
    expect(j4).toMatchObject({ industry: "General", salary: "Not specified" });
  });

  test("WB-ADM-49 list: DB failure is a generic 500", async () => {
    JobVacancy.countDocuments.mockRejectedValue(dbError());
    JobVacancy.find.mockReturnValue(query([]));
    expect500(await call(c.getAdminVacancies, adminReq()), "Failed to fetch admin job monitoring list");
  });

  test("WB-ADM-50 stats: totals, status counts, slots, municipality buckets, application sum (from the aggregation)", async () => {
    JobVacancy.aggregate.mockResolvedValue([{
      totals: [{ _id: null, totalPostings: 5, totalSlots: 10 }],
      byStatus: [{ _id: "active", count: 1 }, { _id: "pending", count: 2 }, { _id: "closed", count: 1 }, { _id: "rejected", count: 1 }],
      byMunicipality: [
        { _id: "Boac (Capital)", jobs: 1, slots: 2 },
        { _id: "Gasan", jobs: 1, slots: 3 },
        { _id: "Other / Outside Province", jobs: 2, slots: 1 },
        { _id: "Torrijos", jobs: 1, slots: 4 },
      ],
    }]);
    JobVacancy.distinct.mockResolvedValue(["1", "2", "3", "4", "5"]);
    JobApplication.aggregate.mockResolvedValue([{ total: 5 }]);
    const { body } = await call(c.getAdminVacancyStats, adminReq({ query: {} }));
    expect(body.totals).toEqual({ totalPostings: 5, active: 1, pending: 2, closed: 1, rejected: 1, totalSlots: 10, applications: 5 });
    const byLabel = Object.fromEntries(body.municipalityBreakdown.map((m) => [m.label, m]));
    expect(byLabel["Boac (Capital)"]).toEqual({ label: "Boac (Capital)", jobs: 1, slots: 2 });
    expect(byLabel["Other / Outside Province"]).toEqual({ label: "Other / Outside Province", jobs: 2, slots: 1 });
    expect(body.municipalityBreakdown).toHaveLength(7);
  });

  test("WB-ADM-51 stats: empty result and DB failure", async () => {
    JobVacancy.aggregate.mockResolvedValue([{ totals: [], byStatus: [], byMunicipality: [] }]);
    JobVacancy.distinct.mockResolvedValue([]);
    const ok = await call(c.getAdminVacancyStats, adminReq({ query: {} }));
    expect(ok.body.totals.totalPostings).toBe(0);
    expect(ok.body.totals.applications).toBe(0);
    JobVacancy.aggregate.mockRejectedValue(dbError());
    expect500(await call(c.getAdminVacancyStats, adminReq({ query: {} })), "Failed to fetch job monitoring stats");
  });
});

// ---------------------------------------------------------------------------
describe("getHomepageJobManagement", () => {
  const job = (id, createdAt, isFeatured = false) => ({ _id: id, createdAt, isFeatured, toObject() { return { _id: id, createdAt, isFeatured }; } });

  test("WB-ADM-52 ranks by application count, ties by newest, counts featured", async () => {
    JobVacancy.find.mockReturnValue(query([job("a", "2026-01-01", true), job("b", "2026-03-01"), job("c", "2026-02-01", true), job("d", undefined)]));
    getApplicationCountMap.mockResolvedValue({ a: 1, b: 1, c: 5 });
    const { body } = await call(c.getHomepageJobManagement, adminReq());
    expect(body.rankedJobs.map((j) => j._id)).toEqual(["c", "b", "a", "d"]);
    expect(body.jobs.map((j) => j.applicationCount)).toEqual([1, 1, 5, 0]);
    expect(body.featuredCount).toBe(2);
    expect(JobVacancy.find).toHaveBeenCalledWith({ isActive: true, status: { $ne: "closed" } });
  });

  test("WB-ADM-53 DB failure is a generic 500", async () => {
    JobVacancy.find.mockReturnValue(failingQuery(dbError()));
    expect500(await call(c.getHomepageJobManagement, adminReq()), "Failed to fetch homepage job management data");
  });
});

// ---------------------------------------------------------------------------
describe("toggleHomepageFeature", () => {
  const req = (isFeatured, extra = {}) => adminReq({ params: { id: "j1" }, body: { isFeatured }, ...extra });
  const activeJob = (o = {}) => saveable({ _id: "j1", isActive: true, status: "active", isFeatured: false, employer: "emp", title: "Welder", ...o });
  const wire = (job, { featuredCount = 0, featured = [] } = {}) => {
    JobVacancy.findById.mockReturnValueOnce(query(job)).mockReturnValueOnce(query({ _id: "j1", updated: true }));
    JobVacancy.countDocuments.mockResolvedValue(featuredCount);
    JobVacancy.find.mockReturnValue(query(featured));
  };

  test("WB-ADM-54 unknown job is 404", async () => {
    JobVacancy.findById.mockReturnValue(query(null));
    expect((await call(c.toggleHomepageFeature, req(true))).status).toBe(404);
  });

  test.each([[{ isActive: false }], [{ status: "closed" }]])("WB-ADM-55 inactive or closed job (%j) cannot be featured", async (o) => {
    JobVacancy.findById.mockReturnValue(query(activeJob(o)));
    const r = await call(c.toggleHomepageFeature, req(true));
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Only active jobs/);
  });

  test("WB-ADM-56 4 already featured blocks a 5th", async () => {
    const job = activeJob();
    wire(job, { featuredCount: 4 });
    const r = await call(c.toggleHomepageFeature, req(true));
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/up to 4/);
    expect(job.save).not.toHaveBeenCalled();
  });

  test("WB-ADM-57 boundary: 3 featured allows the 4th, which gets order = existing + 1; employer is notified", async () => {
    const job = activeJob();
    wire(job, { featuredCount: 3, featured: [{}, {}, {}] });
    const r = await call(c.toggleHomepageFeature, req(true));
    expect(job).toMatchObject({ isFeatured: true, featuredOrder: 4 });
    expect(job.save).toHaveBeenCalled();
    expect(normalizeFeaturedOrdering).toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.job.featured_enabled" }));
    expect(createNotificationForUser).toHaveBeenCalledWith(expect.objectContaining({ recipientId: "emp", title: "Your job posting was featured" }));
    expect(r.body.message).toBe("Job featured on homepage");
    expect(r.body.job).toEqual({ _id: "j1", updated: true });
  });

  test("WB-ADM-58 featuring an already-featured job changes nothing but still saves and notifies", async () => {
    const job = activeJob({ isFeatured: true, featuredOrder: 2 });
    wire(job);
    await call(c.toggleHomepageFeature, req(true));
    expect(job.featuredOrder).toBe(2);
    expect(JobVacancy.countDocuments).not.toHaveBeenCalled();
    expect(job.save).toHaveBeenCalled();
  });

  test("WB-ADM-59 un-featuring clears flag and order, audits, and does not notify", async () => {
    const job = activeJob({ isFeatured: true, featuredOrder: 1 });
    wire(job);
    const r = await call(c.toggleHomepageFeature, req(false));
    expect(job).toMatchObject({ isFeatured: false, featuredOrder: null });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.job.featured_disabled" }));
    expect(createNotificationForUser).not.toHaveBeenCalled();
    expect(r.body.message).toBe("Job removed from homepage featured list");
  });

  test("WB-ADM-60 audit/notification failures are non-fatal", async () => {
    wire(activeJob(), { featuredCount: 0 });
    logAuditEvent.mockRejectedValue(new Error("x"));
    createNotificationForUser.mockRejectedValue(new Error("y"));
    expect((await call(c.toggleHomepageFeature, req(true))).status).toBe(200);
  });

  test("WB-ADM-61 save failure is a generic 500", async () => {
    const job = activeJob();
    job.save.mockRejectedValue(dbError());
    wire(job);
    expect500(await call(c.toggleHomepageFeature, req(false)), "Failed to update homepage feature");
  });
});

// ---------------------------------------------------------------------------
describe("user moderation", () => {
  const userDoc = (o = {}) => saveable({ _id: TARGET, role: "jobseeker", ...o });
  const withUser = (u) => User.findById.mockReturnValue(query(u));

  describe("updateUserRole", () => {
    const run = (role, id = TARGET) => call(c.updateUserRole, adminReq({ params: { id }, body: { role } }));

    test.each(["admin", "superadmin", "", undefined, "JOBSEEKER"])("WB-ADM-62 role %p is rejected", async (role) => {
      expect((await run(role)).status).toBe(400);
      expect(User.findById).not.toHaveBeenCalled();
    });

    test("WB-ADM-63 unknown user is 404", async () => {
      withUser(null);
      expect((await run("employer")).status).toBe(404);
    });

    test.each(["admin", "superadmin"])("WB-ADM-64 staff account (%s) cannot be changed", async (role) => {
      const u = userDoc({ role });
      withUser(u);
      expect((await run("employer")).status).toBe(403);
      expect(u.save).not.toHaveBeenCalled();
    });

    test("WB-ADM-65 success saves with validateModifiedOnly, audits at warning and notifies", async () => {
      const u = userDoc();
      withUser(u);
      const r = await run("employer");
      expect(u.role).toBe("employer");
      expect(u.save).toHaveBeenCalledWith({ validateModifiedOnly: true });
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.user.role_updated", severity: "warning", metadata: { newRole: "employer" } }));
      expect(createNotificationForUser).toHaveBeenCalledWith(expect.objectContaining({ metadata: { newRole: "employer" } }));
      expect(r.body.message).toBe("User role updated");
    });

    test("WB-ADM-66 post-commit failures are non-fatal; save failure is a generic 500", async () => {
      withUser(userDoc());
      logAuditEvent.mockRejectedValue(new Error("x"));
      createNotificationForUser.mockRejectedValue(new Error("y"));
      expect((await run("jobseeker")).status).toBe(200);
      const bad = userDoc();
      bad.save.mockRejectedValue(dbError());
      withUser(bad);
      expect500(await run("jobseeker"), "Failed to update role");
    });
  });

  describe("deactivateUser", () => {
    const run = (body = {}, id = TARGET, user) => call(c.deactivateUser, adminReq({ params: { id }, body, ...(user ? { user } : {}) }));

    test("WB-ADM-67 admin cannot deactivate themselves (string compare)", async () => {
      expect((await run({}, ADMIN)).status).toBe(400);
      expect(User.findById).not.toHaveBeenCalled();
    });

    test("WB-ADM-68 unknown user 404; superadmin 403", async () => {
      withUser(null);
      expect((await run()).status).toBe(404);
      const sa = userDoc({ role: "superadmin" });
      withUser(sa);
      expect((await run()).status).toBe(403);
      expect(sa.save).not.toHaveBeenCalled();
    });

    test("WB-ADM-69 temporary suspension with a reason", async () => {
      const u = userDoc();
      withUser(u);
      const r = await run({ reason: "  spam  " });
      expect(u).toMatchObject({ isActive: false, accountStatus: "suspended", suspensionReason: "spam", suspendedBy: ADMIN });
      expect(u.suspendedAt).toBeInstanceOf(Date);
      expect(forceLogout).toHaveBeenCalledWith("io", TARGET, expect.objectContaining({ code: "ACCOUNT_SUSPENDED", message: expect.stringContaining("suspended") }));
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ severity: "critical", metadata: { accountStatus: "suspended", reason: "spam" } }));
      expect(createNotificationForUser.mock.calls[0][0]).toMatchObject({ title: "Your account was suspended" });
      expect(createNotificationForUser.mock.calls[0][0].message).toContain("Reason: spam");
      expect(r.body.message).toBe("User suspended");
    });

    test.each([[true], ["true"]])("WB-ADM-70 permanent=%p bans; blank reason becomes null and the message has no reason text", async (permanent) => {
      const u = userDoc();
      withUser(u);
      const r = await run({ permanent, reason: "   " });
      expect(u).toMatchObject({ accountStatus: "banned", suspensionReason: null });
      expect(forceLogout.mock.calls[0][2].message).toContain("banned");
      expect(createNotificationForUser.mock.calls[0][0].title).toBe("Your account was banned");
      expect(createNotificationForUser.mock.calls[0][0].message).not.toContain("Reason");
      expect(r.body.message).toBe("User banned");
    });

    test.each([[false], ["false"], ["yes"], [1], [undefined]])("WB-ADM-71 permanent=%p is NOT treated as a ban", async (permanent) => {
      const u = userDoc();
      withUser(u);
      await run({ permanent });
      expect(u.accountStatus).toBe("suspended");
    });

    test("WB-ADM-72 KNOWN-ISSUE: an admin can suspend/ban another ADMIN (updateUserRole and deleteUser forbid staff targets; only superadmin is blocked here)", async () => {
      const otherAdmin = userDoc({ role: "admin" });
      withUser(otherAdmin);
      const r = await run({ permanent: true });
      expect(r.status).toBe(200);
      expect(otherAdmin.accountStatus).toBe("banned");
    });

    test("WB-ADM-73 post-commit failures are non-fatal; save failure is a generic 500", async () => {
      withUser(userDoc());
      logAuditEvent.mockRejectedValue(new Error("x"));
      createNotificationForUser.mockRejectedValue(new Error("y"));
      expect((await run()).status).toBe(200);
      const bad = userDoc();
      bad.save.mockRejectedValue(dbError());
      withUser(bad);
      expect500(await run(), "Failed to deactivate user");
    });
  });

  describe("reactivateUser", () => {
    const run = (id = TARGET) => call(c.reactivateUser, adminReq({ params: { id } }));

    test("WB-ADM-74 unknown user is 404", async () => {
      withUser(null);
      expect((await run()).status).toBe(404);
    });

    test("WB-ADM-75 reactivation clears every suspension field, audits and notifies", async () => {
      const u = userDoc({ isActive: false, accountStatus: "banned", suspensionReason: "x", suspendedAt: "d", suspendedBy: "s" });
      withUser(u);
      const r = await run();
      expect(u).toMatchObject({ isActive: true, accountStatus: "active", suspensionReason: null, suspendedAt: null, suspendedBy: null });
      expect(u.save).toHaveBeenCalledWith({ validateModifiedOnly: true });
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.user.reactivated" }));
      expect(r.body.message).toBe("User reactivated");
    });

    test("WB-ADM-76 KNOWN-ISSUE: no staff guard, so an admin can reactivate a staff account that a superadmin disabled", async () => {
      const disabledAdmin = userDoc({ role: "admin", isActive: false });
      withUser(disabledAdmin);
      const r = await run();
      expect(r.status).toBe(200);
      expect(disabledAdmin.isActive).toBe(true);
    });

    test("WB-ADM-77 post-commit failures are non-fatal; DB failure is a generic 500", async () => {
      withUser(userDoc());
      logAuditEvent.mockRejectedValue(new Error("x"));
      createNotificationForUser.mockRejectedValue(new Error("y"));
      expect((await run()).status).toBe(200);
      User.findById.mockReturnValue(failingQuery(dbError()));
      expect500(await run(), "Failed to reactivate user");
    });
  });

  // The old hard delete now lives only in the purge job
  // (services/userDeletionService.purgeUser, covered in userDeletion.test.js).
  // The route handlers are a thin layer over softDeleteUser / restoreUser.
  describe("deleteUser (soft delete)", () => {
    const run = (body = {}, id = TARGET) => call(c.deleteUser, adminReq({ params: { id }, body }));
    const ok = {
      user: { role: "jobseeker" },
      summary: { role: "jobseeker", applications: 2 },
      deletedAt: new Date("2026-01-01"),
      purgeAfter: new Date("2026-01-31"),
      graceDays: 30,
      reason: "other",
      note: null,
    };

    test("WB-ADM-78 delegates to the service with the actor, target, reason and typed confirmation", async () => {
      userDeletion.softDeleteUser.mockResolvedValue(ok);
      const r = await run({ reason: "other", note: "x", confirm: "u@x.com" });
      expect(userDeletion.softDeleteUser).toHaveBeenCalledWith(expect.objectContaining({
        actorId: ADMIN, targetId: TARGET, reason: "other", note: "x", confirm: "u@x.com",
      }));
      expect(r.status).toBe(200);
      expect(r.body.purgeAfter).toEqual(ok.purgeAfter);
    });

    test("WB-ADM-79 service guard errors keep their status and stable code (self, staff, not deactivated, bad confirmation)", async () => {
      for (const [status, code] of [[400, "DELETE_SELF"], [403, "DELETE_STAFF"], [409, "NOT_DEACTIVATED"], [400, "CONFIRMATION_MISMATCH"]]) {
        userDeletion.softDeleteUser.mockRejectedValue(new userDeletion.DeletionError(status, "m", code));
        const r = await run({ reason: "other", confirm: "x" });
        expect(r.status).toBe(status);
        expect(r.body.code).toBe(code);
      }
      expect(forceLogout).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    test("WB-ADM-80 success ends the live session and writes a critical audit entry with the affected counts", async () => {
      userDeletion.softDeleteUser.mockResolvedValue(ok);
      await run({ reason: "other", confirm: "u@x.com" });
      expect(forceLogout).toHaveBeenCalledWith("io", TARGET, expect.objectContaining({ code: "ACCOUNT_DELETED" }));
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
        action: "admin.user.soft_deleted",
        severity: "critical",
        actorRole: "superadmin",
        metadata: expect.objectContaining({ reason: "other", graceDays: 30, affected: ok.summary }),
      }));
    });

    test("WB-ADM-81 the preview route returns the summary and the grace period and writes nothing; DELETE ignores dryRun", async () => {
      userDeletion.softDeleteUser.mockResolvedValue({ user: { role: "jobseeker", name: "J" }, summary: ok.summary });
      userDeletion.getGraceDays.mockResolvedValue(45);
      const r = await call(c.previewDeleteUser, adminReq({ params: { id: TARGET } }));
      expect(userDeletion.softDeleteUser).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
      expect(r.body).toMatchObject({ graceDays: 45, summary: ok.summary });
      expect(forceLogout).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
      // a real DELETE never previews, even if the body asks
      userDeletion.softDeleteUser.mockClear();
      userDeletion.softDeleteUser.mockResolvedValue(ok);
      await run({ dryRun: true, reason: "other", confirm: "x" });
      expect(userDeletion.softDeleteUser).toHaveBeenCalledWith(expect.not.objectContaining({ dryRun: true }));
    });

    test("WB-ADM-84 unexpected failure is a generic 500 and no audit event is written", async () => {
      userDeletion.softDeleteUser.mockRejectedValue(dbError());
      expect500(await run({ reason: "other", confirm: "x" }), "Failed to delete user");
      expect(logAuditEvent).not.toHaveBeenCalled();
    });
  });

  describe("restoreUser", () => {
    const run = (id = TARGET) => call(c.restoreUser, adminReq({ params: { id } }));

    test("WB-ADM-85 restores inside the grace period and audits it", async () => {
      userDeletion.restoreUser.mockResolvedValue({ user: {} });
      const r = await run();
      expect(userDeletion.restoreUser).toHaveBeenCalledWith({ targetId: TARGET });
      expect(r.status).toBe(200);
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.user.restored" }));
    });

    test("WB-ADM-86 after the grace period the service error (410) is passed through", async () => {
      userDeletion.restoreUser.mockRejectedValue(new userDeletion.DeletionError(410, "late", "GRACE_ENDED"));
      const r = await run();
      expect(r.status).toBe(410);
      expect(r.body.code).toBe("GRACE_ENDED");
      expect(logAuditEvent).not.toHaveBeenCalled();
    });
  });
});
