// Dashboard and Analytics & Reports: one definition per metric, period and municipality validation,
// top-employer minimums, the small-cell rule, needs-attention counts, and "both pages agree".
// Models are mocked; what is checked is the maths and the rules.

jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../models/User", () => ({ aggregate: jest.fn(), countDocuments: jest.fn(), find: jest.fn(), findOne: jest.fn() }));
jest.mock("../models/EmployerProfile", () => ({ find: jest.fn() }));
jest.mock("../models/JobVacancy", () => ({ aggregate: jest.fn(), countDocuments: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ aggregate: jest.fn() }));
jest.mock("../models/AuditLog", () => ({ find: jest.fn() }));
jest.mock("../models/Report", () => ({ countDocuments: jest.fn() }));
jest.mock("../models/Appeal", () => ({ countDocuments: jest.fn() }));
jest.mock("../models/AccountRecoveryRequest", () => ({ countDocuments: jest.fn() }));
jest.mock("../models/SpesPosting", () => ({ aggregate: jest.fn() }));
jest.mock("../models/SpesApplication", () => ({ aggregate: jest.fn() }));
jest.mock("../models/SystemOption", () => ({ find: jest.fn() }));
jest.mock("../utils/jobVisibility", () => ({
  getUnlistedEmployerIds: jest.fn(async () => []),
  withListedEmployers: jest.fn(async (filter) => filter),
  UNLISTED_ACCOUNT_STATUSES: ["suspended", "banned", "deactivated"],
}));

const User = require("../models/User");
const EmployerProfile = require("../models/EmployerProfile");
const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const AuditLog = require("../models/AuditLog");
const Report = require("../models/Report");
const Appeal = require("../models/Appeal");
const AccountRecoveryRequest = require("../models/AccountRecoveryRequest");
const { getUnlistedEmployerIds } = require("../utils/jobVisibility");
const defs = require("../services/analytics/definitions");
const overview = require("../services/analytics/overviewStats");
const { getOverview, getDashboard } = require("../controllers/analyticsController");

const NOW = new Date("2026-11-20T06:00:00Z");

// ---- definitions ---------------------------------------------------------------------------

describe("definitions", () => {
  test("every application lands in exactly one bucket, so the buckets add up to the total", () => {
    const rows = [
      { _id: "pending", count: 5 },
      { _id: "applied", count: 2 },
      { _id: "reviewed", count: 3 },
      { _id: "under_review", count: 1 },
      { _id: "accepted", count: 2 },
      { _id: "hired", count: 4 },
      { _id: "withdrawn", count: 1 },
      { _id: "mystery", count: 2 },
      { _id: "", count: 1 },
    ];
    const result = defs.applicationStatusCounts(rows);
    expect(result.total).toBe(21);
    expect(Object.values(result.counts).reduce((a, b) => a + b, 0)).toBe(result.total);
    expect(result.counts).toMatchObject({ pending: 7, under_review: 4, hired: 6, withdrawn: 1, other: 3 });
    // Hired IS the hires figure, legacy "accepted" included
    expect(result.hires).toBe(result.counts.hired);
  });

  test("closed excludes archived, a draft is not counted, legacy closed spellings are closed", () => {
    const result = defs.vacancyStatusCounts([
      { _id: "active", count: 10 },
      { _id: "closed", count: 21 },
      { _id: "filled", count: 1 },
      { _id: "archived", count: 2 },
      { _id: "draft", count: 9 },
    ]);
    expect(result).toEqual({ open: 10, closed: 22, archived: 2, total: 34 });
  });

  test("role titles are grouped ignoring capitals and spaces, shown as the most common spelling", () => {
    const grouped = defs.groupRoleTitles([
      { title: "Service Crew", count: 5 },
      { title: "service  crew", count: 2 },
      { title: " SERVICE CREW ", count: 1 },
      { title: "Cashier", count: 4 },
      { title: "   ", count: 9 },
    ]);
    expect(grouped).toEqual([
      { title: "Service Crew", count: 8 },
      { title: "Cashier", count: 4 },
    ]);
  });

  test("percent is of an already-returned total and is 0 for an empty total", () => {
    expect(defs.percentOf(1, 3)).toBe(33.3);
    expect(defs.percentOf(0, 0)).toBe(0);
  });
});

// ---- query parsing ---------------------------------------------------------------------------

describe("parseOverviewQuery", () => {
  test("defaults to the last 30 days, all municipalities, in Manila time", () => {
    const parsed = overview.parseOverviewQuery({}, NOW);
    expect(parsed.preset).toBe("30d");
    expect(parsed.municipality).toBeNull();
    expect(parsed.period.label).toBe("Last 30 days");
    expect(parsed.period.from.toISOString()).toBe("2026-10-21T16:00:00.000Z"); // 22 Oct 00:00 Manila
    expect(parsed.period.to.toISOString()).toBe("2026-11-20T16:00:00.000Z"); // 21 Nov 00:00 Manila
  });

  test("only the allowed period values and municipalities are accepted", () => {
    expect(() => overview.parseOverviewQuery({ period: "1y" }, NOW)).toThrow(expect.objectContaining({ status: 400, code: "INVALID_PERIOD" }));
    expect(() => overview.parseOverviewQuery({ period: { $ne: "x" } }, NOW)).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => overview.parseOverviewQuery({ municipality: "Manila" }, NOW)).toThrow(expect.objectContaining({ status: 400, code: "INVALID_FILTER" }));
    expect(() => overview.parseOverviewQuery({ municipality: { $regex: ".*" } }, NOW)).toThrow(expect.objectContaining({ status: 400 }));
    expect(overview.parseOverviewQuery({ municipality: "Gasan" }, NOW).municipality).toBe("Gasan");
    expect(overview.parseOverviewQuery({ municipality: "all" }, NOW).municipality).toBeNull();
  });

  test("the query sanitizer strips parentheses, so Boac (Capital) arrives as Boac Capital and still resolves to the real name", () => {
    const { sanitizeQueryParams } = require("../middleware/validation");
    const req = { query: { municipality: "Boac (Capital)" } };
    sanitizeQueryParams(req, {}, () => {});
    expect(req.query.municipality).toBe("Boac Capital");
    expect(overview.parseOverviewQuery(req.query, NOW).municipality).toBe("Boac (Capital)");
    expect(overview.parseOverviewQuery({ municipality: "Boac (Capital)" }, NOW).municipality).toBe("Boac (Capital)");
    expect(overview.parseOverviewQuery({ municipality: "boac  capital" }, NOW).municipality).toBe("Boac (Capital)");
    expect(overview.parseOverviewQuery({ municipality: "Other / Outside Province" }, NOW).municipality).toBe("Other / Outside Province");
    // still a whitelist
    expect(() => overview.parseOverviewQuery({ municipality: "Boac" }, NOW)).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => overview.parseOverviewQuery({ municipality: "Capital" }, NOW)).toThrow(expect.objectContaining({ status: 400 }));
  });

  test("a custom range needs both real days in order", () => {
    expect(() => overview.parseOverviewQuery({ period: "custom", from: "2026-01-01" }, NOW)).toThrow(expect.objectContaining({ code: "INVALID_PERIOD" }));
    expect(() => overview.parseOverviewQuery({ period: "custom", from: "2026-05-01", to: "2026-03-01" }, NOW)).toThrow(expect.objectContaining({ code: "INVALID_PERIOD" }));
    const ok = overview.parseOverviewQuery({ period: "custom", from: "2026-01-01", to: "2026-03-31" }, NOW);
    expect(ok.period.label).toBe("2026-01-01 to 2026-03-31");
  });

  test("the 12-month preset starts on the first of the month eleven months back", () => {
    const { period } = overview.parseOverviewQuery({ period: "12m" }, NOW);
    expect(period.from.toISOString()).toBe("2025-11-30T16:00:00.000Z"); // 1 Dec 2025 Manila
  });
});

describe("trend buckets", () => {
  test("day up to 31 days, week up to 120, month beyond", () => {
    const g = (preset) => overview.granularityFor(overview.parseOverviewQuery({ period: preset }, NOW).period);
    expect([g("7d"), g("30d"), g("90d"), g("12m")]).toEqual(["day", "day", "week", "month"]);
  });

  test("ISO week keys match MongoDB's %G-W%V", () => {
    expect(overview.isoWeekKey(2026, 11, 16)).toBe("2026-W47");
    expect(overview.isoWeekKey(2026, 1, 1)).toBe("2026-W01");
    expect(overview.isoWeekKey(2025, 12, 29)).toBe("2026-W01");
    expect(overview.isoWeekKey(2027, 1, 3)).toBe("2026-W53");
  });

  test("a quiet day still has a bucket", () => {
    const { period } = overview.parseOverviewQuery({ period: "7d" }, NOW);
    const buckets = overview.bucketList(period, "day");
    expect(buckets.map((b) => b.key)).toEqual(["2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
    expect(buckets[0].label).toBe("Nov 14");
  });
});

// ---- Analytics & Reports ---------------------------------------------------------------------

const route = (Model, fn) => Model.aggregate.mockImplementation((pipeline) => ({ option: () => Promise.resolve(fn(pipeline)) }));
const lastStage = (pipeline) => pipeline[pipeline.length - 1];

const appRows = [
  { _id: "pending", count: 8 },
  { _id: "under_review", count: 4 },
  { _id: "shortlisted", count: 3 },
  { _id: "rejected", count: 6 },
  { _id: "hired", count: 5 },
  { _id: "withdrawn", count: 2 },
];
const vacRows = [
  { _id: "active", count: 12 },
  { _id: "closed", count: 21 },
  { _id: "archived", count: 2 },
];

const mockData = ({ employers = [], titles = [], muniApps = [], muniVacs = [], statusRows = appRows, vacancyRows = vacRows } = {}) => {
  route(JobApplication, (pipeline) => {
    const last = lastStage(pipeline);
    if (last.$facet) return [{ byStatus: statusRows, trendApplications: [{ _id: "2026-11-15", count: 3 }], trendHires: [{ _id: "2026-11-15", count: 1 }], byEmployer: employers, byTitle: titles }];
    if (last.$count) return [{ n: statusRows.reduce((a, r) => a + r.count, 0) }];
    if (last.$group && last.$group._id === "$municipalityBucket") return muniApps;
    if (last.$group && last.$group._id === "$status") return statusRows;
    return [];
  });
  route(JobVacancy, (pipeline) => {
    const last = lastStage(pipeline);
    if (last.$facet) return [{ byStatus: vacancyRows, trend: [{ _id: "2026-11-16", count: 2 }], byEmployer: employers.map((e) => ({ _id: e._id, postings: 2 })) }];
    if (last.$count) return [{ n: vacancyRows.reduce((a, r) => a + r.count, 0) }];
    if (last.$group && last.$group._id === "$municipalityBucket") return muniVacs;
    if (last.$group && last.$group._id === "$bucket") return vacancyRows;
    return [];
  });
  route(User, (pipeline) => {
    const last = lastStage(pipeline);
    if (last.$count) return [{ n: 7 }];
    return [];
  });
};

const employerUser = (id, extra = {}) => ({ _id: id, name: `Owner ${id}`, companyName: `Company ${id}`, role: "employer", verificationStatus: "verified", isActive: true, accountStatus: "active", deletedAt: null, purgedAt: null, ...extra });
const userFind = (docs) => User.find.mockReturnValue({ select: () => ({ lean: async () => docs }) });
const profileFind = (docs = []) => EmployerProfile.find.mockReturnValue({ select: () => ({ lean: async () => docs }) });

beforeEach(() => {
  jest.clearAllMocks();
  getUnlistedEmployerIds.mockResolvedValue([]);
  userFind([]);
  profileFind();
});

describe("getAnalyticsOverview", () => {
  test("the status legend adds up to the application total and Hired equals hires", async () => {
    mockData();
    const result = await overview.getAnalyticsOverview({ period: "30d" }, NOW);
    const legend = result.applicationsByStatus;
    expect(legend.total).toBe(28);
    expect(legend.items.reduce((sum, item) => sum + item.count, 0)).toBe(legend.total);
    expect(result.cards.applications).toBe(legend.total);
    expect(legend.items.find((item) => item.key === "hired").count).toBe(result.cards.hires);
    expect(legend.items.find((item) => item.key === "pending")).toMatchObject({ count: 8, percent: 28.6 });
  });

  test("vacancies by status: closed excludes archived, total is their sum", async () => {
    mockData();
    const result = await overview.getAnalyticsOverview({}, NOW);
    expect(result.vacanciesByStatus.items.map((i) => [i.key, i.count])).toEqual([["open", 12], ["closed", 21], ["archived", 2]]);
    expect(result.vacanciesByStatus.total).toBe(35);
    expect(result.cards.vacancies).toMatchObject({ open: 12, closed: 21, archived: 2, total: 35 });
  });

  test("the trend has a value for every bucket, zeros included", async () => {
    mockData();
    const result = await overview.getAnalyticsOverview({ period: "7d" }, NOW);
    expect(result.trend.granularity).toBe("day");
    expect(result.trend.applications).toHaveLength(7);
    expect(result.trend.applications.find((p) => p.key === "2026-11-15").value).toBe(3);
    expect(result.trend.applications.filter((p) => p.value === 0)).toHaveLength(6);
    expect(result.trend.hires.find((p) => p.key === "2026-11-15").value).toBe(1);
    expect(result.trend.vacancies.find((p) => p.key === "2026-11-16").value).toBe(2);
  });

  test("top employers need 1+ posting, 3+ applicants and 1+ hire, and must be verified and in good standing", async () => {
    mockData({
      employers: [
        { _id: "a", applicants: 10, hires: 4 },
        { _id: "b", applicants: 2, hires: 2 }, // too few applicants
        { _id: "c", applicants: 9, hires: 0 }, // no hire
        { _id: "d", applicants: 8, hires: 3 }, // suspended
        { _id: "e", applicants: 12, hires: 4 }, // ties a on hires, lower Wilson bound than a? (4/12 < 4/10)
      ],
    });
    userFind([employerUser("a"), employerUser("b"), employerUser("c"), employerUser("d", { accountStatus: "suspended" }), employerUser("e")]);
    const { topEmployers } = await overview.getAnalyticsOverview({}, NOW);
    expect(topEmployers.rows.map((r) => r.employerId)).toEqual(["a", "e"]);
    expect(topEmployers.rows[0]).toMatchObject({ rank: 1, name: "Company a", hires: 4, applicants: 10 });
    expect(topEmployers.minimums).toEqual({ postings: 1, applicants: 3, hires: 1 });
  });

  test("when nothing qualifies the list is empty, so the page shows a message instead of empty bars", async () => {
    mockData({ employers: [{ _id: "a", applicants: 9, hires: 0 }] });
    userFind([employerUser("a")]);
    const { topEmployers } = await overview.getAnalyticsOverview({}, NOW);
    expect(topEmployers.rows).toEqual([]);
  });

  test("role titles in two spellings count as one", async () => {
    mockData({ titles: [{ _id: "Service Crew", count: 4 }, { _id: "service  crew", count: 3 }, { _id: "Cashier", count: 5 }] });
    const { topRoles } = await overview.getAnalyticsOverview({}, NOW);
    expect(topRoles).toEqual([{ title: "Service Crew", count: 7 }, { title: "Cashier", count: 5 }]);
  });

  test("municipality table shows the real counts, small ones included, and a zero stays a zero", async () => {
    mockData({
      muniApps: [
        { _id: "Boac (Capital)", applications: 30, hires: 0 },
        { _id: "Gasan", applications: 3, hires: 0 },
        { _id: "Mogpog", applications: 12, hires: 0 },
        { _id: "Santa Cruz", applications: 50, hires: 0 },
      ],
      muniVacs: [{ _id: "Boac (Capital)", vacancies: 9 }],
    });
    const { municipalities } = await overview.getAnalyticsOverview({}, NOW);
    const by = (name) => municipalities.find((row) => row.municipality === name);
    expect(by("Gasan").applications).toEqual({ value: 3, suppressed: false });
    expect(by("Mogpog").applications).toEqual({ value: 12, suppressed: false });
    expect(by("Boac (Capital)").applications).toEqual({ value: 30, suppressed: false });
    expect(by("Boac (Capital)").vacancies).toEqual({ value: 9, suppressed: false });
    expect(by("Torrijos").applications).toEqual({ value: 0, suppressed: false });
    expect(by("Boac (Capital)").hires).toEqual({ value: 0, suppressed: false });
    expect(JSON.stringify(municipalities)).not.toContain("suppressed\":true");
  });

  test("a municipality filter reaches the scope, but the table still lists every municipality", async () => {
    mockData();
    const result = await overview.getAnalyticsOverview({ municipality: "Gasan" }, NOW);
    const stagesWith = JobApplication.aggregate.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(stagesWith.some((s) => s.includes('"municipalityBucket":"Gasan"'))).toBe(true);
    expect(stagesWith.some((s) => s.includes("$municipalityBucket") && !s.includes('"municipalityBucket":"Gasan"'))).toBe(true);
    expect(result.municipality).toBe("Gasan");
    expect(result.municipalities).toHaveLength(7);
  });

  test("enoughData is false below 1 vacancy or 3 applications", async () => {
    mockData({ statusRows: [{ _id: "pending", count: 2 }] });
    expect((await overview.getAnalyticsOverview({}, NOW)).enoughData).toBe(false);
    mockData({ vacancyRows: [] });
    expect((await overview.getAnalyticsOverview({}, NOW)).enoughData).toBe(false);
    mockData();
    expect((await overview.getAnalyticsOverview({}, NOW)).enoughData).toBe(true);
  });

  test("the endpoint answers 400 for a bad period or municipality", async () => {
    const call = async (query) => {
      const res = { statusCode: 200, headers: {} };
      res.status = (c) => ((res.statusCode = c), res);
      res.json = (b) => ((res.body = b), res);
      res.set = (k, v) => ((res.headers[k] = v), res);
      await getOverview({ query }, res);
      return res;
    };
    mockData();
    expect((await call({ period: "forever" })).statusCode).toBe(400);
    expect((await call({ municipality: "Atlantis" })).statusCode).toBe(400);
    const ok = await call({ period: "90d", municipality: "Gasan" });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["Cache-Control"]).toBe("no-store");
  });

  test("scopeCounts feeds the report generator's not-enough-data rule", async () => {
    mockData({ statusRows: [{ _id: "pending", count: 3 }], vacancyRows: [{ _id: "active", count: 1 }] });
    const { period } = overview.parseOverviewQuery({}, NOW);
    expect(await overview.scopeCounts(period, null)).toEqual({ vacancies: 1, applications: 3, enough: true });
    mockData({ statusRows: [{ _id: "pending", count: 2 }], vacancyRows: [{ _id: "active", count: 1 }] });
    expect((await overview.scopeCounts(period, null)).enough).toBe(false);
  });
});

// ---- Dashboard -------------------------------------------------------------------------------

const mockDashboard = ({ pending = 0, unlisted = [], hidden = 0, closing = 0, reports = 0, appeals = 0, recovery = 0 } = {}) => {
  getUnlistedEmployerIds.mockResolvedValue(unlisted);
  User.countDocuments.mockImplementation(async (query) => {
    if (query.role === "jobseeker") return query.createdAt ? 6 : 120;
    if (query.verificationStatus === "verified") return 30;
    if (query.verificationStatus && query.verificationStatus.$in) return pending;
    return 41; // all employers
  });
  User.findOne.mockReturnValue({ sort: () => ({ select: () => ({ lean: async () => (pending ? { verificationSubmittedAt: new Date("2026-11-10T00:00:00Z"), createdAt: new Date("2026-11-01T00:00:00Z") } : null) }) }) });
  JobVacancy.countDocuments.mockImplementation(async (query) => (query.applicationDeadline ? closing : hidden));
  Report.countDocuments.mockResolvedValue(reports);
  Appeal.countDocuments.mockResolvedValue(appeals);
  AccountRecoveryRequest.countDocuments.mockResolvedValue(recovery);
  AuditLog.find.mockReturnValue({ sort: () => ({ limit: () => ({ select: () => ({ lean: async () => [{ _id: "1", action: "employer.verification.approved", severity: "info", createdAt: new Date("2026-11-19T00:00:00Z") }] }) }) }) });
  route(JobApplication, (pipeline) => (lastStage(pipeline).$group ? appRows : []));
  route(JobVacancy, (pipeline) => (lastStage(pipeline).$group ? vacRows : []));
  route(User, () => [{ _id: "Gasan", count: 40 }, { _id: "Boac (Capital)", count: 80 }]);
};

describe("getDashboardOverview", () => {
  test("KPIs: active jobseekers with the last-30-days joiners, verified of total with pending, open vacancies with closing soon, applications to review", async () => {
    mockDashboard({ pending: 3, closing: 4 });
    const { kpis } = await overview.getDashboardOverview(NOW);
    expect(kpis.activeJobseekers).toEqual({ value: 120, joinedLast30: 6 });
    expect(kpis.verifiedEmployers).toEqual({ verified: 30, total: 41, pending: 3 });
    expect(kpis.openVacancies).toEqual({ value: 12, closingSoon: 4 });
    expect(kpis.applicationsToReview).toEqual({ value: 8 });
  });

  test("attention rows: counts, the oldest wait in days, and reports plus appeals together", async () => {
    mockDashboard({ pending: 3, closing: 4, reports: 2, appeals: 1, recovery: 5, hidden: 7, unlisted: ["x"] });
    const { attention, allClear } = await overview.getDashboardOverview(NOW);
    const row = (key) => attention.find((r) => r.key === key);
    expect(row("employerVerification")).toMatchObject({ count: 3, oldestDays: 10 });
    expect(row("moderation")).toMatchObject({ count: 3, reports: 2, appeals: 1 });
    expect(row("accountRecovery").count).toBe(5);
    expect(row("closingSoon").count).toBe(4);
    expect(row("hiddenByEmployer").count).toBe(7);
    expect(allClear).toBe(false);
  });

  test("with nothing to do every row is still present at 0 and allClear is true", async () => {
    mockDashboard();
    const { attention, allClear } = await overview.getDashboardOverview(NOW);
    expect(attention.map((r) => r.key)).toEqual(["employerVerification", "moderation", "accountRecovery", "closingSoon", "hiddenByEmployer"]);
    expect(attention.every((r) => r.count === 0)).toBe(true);
    expect(allClear).toBe(true);
  });

  test("hidden-by-employer counts only open jobs of suspended or deactivated employers, derived at query time", async () => {
    mockDashboard({ unlisted: ["e1", "e2"], hidden: 2 });
    await overview.getDashboardOverview(NOW);
    const query = JobVacancy.countDocuments.mock.calls.map((c) => c[0]).find((q) => q.employer);
    expect(query).toMatchObject({ status: "active", archived: { $ne: true }, employer: { $in: ["e1", "e2"] } });
  });

  test("with no unlisted employer that count is 0 without a query", async () => {
    mockDashboard({ unlisted: [] });
    const { attention } = await overview.getDashboardOverview(NOW);
    expect(attention.find((r) => r.key === "hiddenByEmployer").count).toBe(0);
    expect(JobVacancy.countDocuments.mock.calls.some((c) => c[0].employer)).toBe(false);
  });

  test("jobseekers by municipality show the real counts, small ones included; recent activity carries no person and skips sign-ins", async () => {
    mockDashboard();
    route(User, () => [{ _id: "Gasan", count: 3 }, { _id: "Boac (Capital)", count: 80 }, { _id: "Mogpog", count: 10 }]);
    const result = await overview.getDashboardOverview(NOW);
    expect(result.jobseekersByMunicipality.find((m) => m.municipality === "Gasan")).toEqual({ municipality: "Gasan", value: 3, suppressed: false });
    expect(result.jobseekersByMunicipality.find((m) => m.municipality === "Torrijos")).toEqual({ municipality: "Torrijos", value: 0, suppressed: false });
    expect(result.jobseekersByMunicipality.find((m) => m.municipality === "Boac (Capital)")).toMatchObject({ value: 80 });
    expect(result.recentActivity).toEqual([{ id: "1", action: "employer.verification.approved", severity: "info", at: new Date("2026-11-19T00:00:00Z") }]);
    expect(Object.keys(result.recentActivity[0]).sort()).toEqual(["action", "at", "id", "severity"]);
    expect(AuditLog.find.mock.calls[0][0].action.$not.test("auth.login.failed")).toBe(true);
  });

  test("the handler never caches", async () => {
    mockDashboard();
    const res = { headers: {} };
    res.set = (k, v) => ((res.headers[k] = v), res);
    res.json = (b) => ((res.body = b), res);
    await getDashboard({}, res);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(res.body.kpis).toBeDefined();
  });
});

describe("the two pages agree", () => {
  test("the Dashboard and Analytics give the same status totals and vacancy counts for the same data", async () => {
    mockDashboard();
    mockData({ statusRows: appRows, vacancyRows: vacRows });
    route(User, (pipeline) => (lastStage(pipeline).$count ? [{ n: 1 }] : [{ _id: "Gasan", count: 40 }]));
    const dash = await overview.getDashboardOverview(NOW);
    const analytics = await overview.getAnalyticsOverview({ period: "12m" }, NOW);
    expect(dash.kpis.applicationsToReview.value).toBe(analytics.applicationsByStatus.items.find((i) => i.key === "pending").count);
    expect(dash.kpis.openVacancies.value).toBe(analytics.vacanciesByStatus.items.find((i) => i.key === "open").count);
    expect(analytics.cards.vacancies.closed).toBe(21);
  });
});
