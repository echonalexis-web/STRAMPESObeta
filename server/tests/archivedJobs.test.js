// Archived tab: GET /employer/jobs/archived. Status, close reason, funnel, hired people,
// filters, sort, pagination and stats are computed on the server.

jest.mock("../models/JobVacancy", () => ({ find: jest.fn(), updateMany: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ find: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn() }));
jest.mock("../models/JobseekerProfile", () => ({}));
jest.mock("../models/User", () => ({ find: jest.fn() }));
jest.mock("../models/Follow", () => ({}));
jest.mock("../models/Message", () => ({}));
jest.mock("../models/SystemSettings", () => ({ getSingleton: jest.fn() }));
jest.mock("../models/ContactShare", () => ({}));
jest.mock("../services/notificationService", () => ({ createNotificationForUser: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../controllers/messageController", () => ({ ensureConversationBetweenUsers: jest.fn() }));

const fs = require("fs");
const path = require("path");
const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const User = require("../models/User");
const SystemSettings = require("../models/SystemSettings");
const employerController = require("../controllers/employerController");
const svc = require("../services/archivedJobsService");

const makeRes = () => ({
  statusCode: 200,
  body: null,
  headers: {},
  set(k, v) {
    this.headers[k] = v;
  },
  status(c) {
    this.statusCode = c;
    return this;
  },
  json(b) {
    this.body = b;
    return this;
  },
});

beforeEach(() => jest.resetAllMocks());

const D = (s) => new Date(s);
const job = (id, extra = {}) => ({ _id: id, title: `Job ${id}`, location: "Boac", slots: 1, createdAt: D("2026-08-01"), closedAt: D("2026-09-13"), archiveReason: null, closeReason: null, closedBy: null, applicationDeadline: null, ...extra });
const app = (vacancy, applicant, status, extra = {}) => ({ vacancy, applicant, status, appliedAt: D("2026-08-03"), statusUpdatedAt: D("2026-08-20"), includePhoto: false, ...extra });
const select = (docs) => ({ select: () => ({ lean: () => Promise.resolve(docs) }) });

const wire = ({ jobs, apps = [], users = [] }) => {
  JobVacancy.find.mockReturnValue(select(jobs));
  JobApplication.find.mockReturnValue(select(apps));
  User.find.mockReturnValue(select(users));
};
const call = async (query = {}, userId = "emp1") => {
  const res = makeRes();
  await employerController.getArchivedJobs({ user: { _id: userId }, query }, res);
  return res;
};

describe("pure rules", () => {
  test("close reason: stored, legacy map, deadline, none", () => {
    expect(svc.deriveCloseReason({ closeReason: "inactivity" })).toBe("inactivity");
    expect(svc.deriveCloseReason({ archiveReason: "manual_close" })).toBe("manual");
    expect(svc.deriveCloseReason({ archivedMetrics: { archiveReason: "deadline_passed" } })).toBe("expired");
    expect(svc.deriveCloseReason({ archiveReason: "quota_reached" })).toBe("filled");
    expect(svc.deriveCloseReason({ applicationDeadline: D("2026-09-01"), closedAt: D("2026-09-02") })).toBe("expired");
    expect(svc.deriveCloseReason({ applicationDeadline: D("2026-10-01"), closedAt: D("2026-09-02") })).toBeNull();
    expect(svc.deriveCloseReason({})).toBeNull();
  });

  test("status: filled wins; multi-vacancy needs all filled; neutral for unknown", () => {
    expect(svc.deriveStatus({ hired: 1, slots: 1, closeReason: "manual" })).toBe("filled");
    expect(svc.deriveStatus({ hired: 1, slots: 3, closeReason: "manual" })).toBe("closed_manually");
    expect(svc.deriveStatus({ hired: 3, slots: 3, closeReason: null })).toBe("filled");
    expect(svc.deriveStatus({ hired: 0, slots: 1, closeReason: "expired" })).toBe("expired");
    expect(svc.deriveStatus({ hired: 0, slots: 1, closeReason: "inactivity" })).toBe("auto_closed");
    expect(svc.deriveStatus({ hired: 0, slots: 1, closeReason: null })).toBe("closed");
    expect(svc.deriveStatus({ hired: 0, slots: 1, closeReason: "admin" })).toBe("closed");
  });

  test("closed by", () => {
    expect(svc.deriveClosedBy({}, "expired")).toBe("system");
    expect(svc.deriveClosedBy({}, "manual")).toBe("employer");
    expect(svc.deriveClosedBy({ closedBy: "admin" }, "manual")).toBe("admin");
    expect(svc.deriveClosedBy({}, null)).toBeNull();
  });

  test("duration uses closedAt, in whole days", () => {
    expect(svc.durationDays(D("2026-08-01"), D("2026-09-13"))).toBe(43);
    expect(svc.durationDays(D("2026-08-01T00:00:00Z"), D("2026-08-01T10:00:00Z"))).toBe(0);
    expect(svc.durationDays(null, D("2026-08-01"))).toBeNull();
  });

  test("funnel counts", () => {
    const f = svc.buildFunnel([{ status: "pending" }, { status: "under_review" }, { status: "shortlisted" }, { status: "hired" }, { status: "rejected" }]);
    expect(f).toEqual({ applicants: 5, qualified: 3, shortlisted: 2, hired: 1 });
  });

  test("stats: time to fill over filled jobs only, fill rate over jobs with applicants", () => {
    const filled = svc.buildArchivedItem(job("a"), [app("a", "u1", "hired")], new Map());
    const expired = svc.buildArchivedItem(job("b", { archiveReason: "deadline_passed" }), [app("b", "u2", "pending")], new Map());
    const empty = svc.buildArchivedItem(job("c", { archiveReason: "deadline_passed" }), [], new Map());
    const stats = svc.buildStats([filled, expired, empty]);
    expect(stats).toMatchObject({ archivedJobs: 3, totalApplicants: 2, hiredCandidates: 1, fillRate: 50, noApplicantJobs: 1 });
    expect(stats.avgTimeToFillDays).toBe(19); // 2026-08-01 to 2026-08-20
    expect(svc.buildStats([empty])).toMatchObject({ avgTimeToFillDays: null, fillRate: null });
  });
});

describe("GET /employer/jobs/archived", () => {
  test("shape, hired candidates with id, name and avatar only, no forbidden fields", async () => {
    wire({
      jobs: [job("j1", { archiveReason: "manual_close" })],
      apps: [app("j1", "u1", "hired")],
      users: [{ _id: "u1", name: "Maria Santos", profileImage: "/p.png", email: "m@x.com", phone: "0917", dateOfBirth: D("1990-01-01"), privacy: { profileVisibility: "public" } }],
    });
    const res = await call();
    expect(res.statusCode).toBe(200);
    const item = res.body.items[0];
    expect(Object.keys(item).sort()).toEqual(["_id", "closeReason", "closedAt", "closedBy", "durationDays", "filled", "firstApplicantAt", "funnel", "hiredCandidates", "location", "postedAt", "slots", "status", "title", "vacancies"]);
    expect(item).toMatchObject({ status: "filled", closeReason: "manual", closedBy: "employer", durationDays: 43, filled: 1, vacancies: 1 });
    expect(item.hiredCandidates).toEqual([{ id: "u1", name: "Maria Santos", avatar: "/p.png" }]);
    const json = JSON.stringify(res.body);
    ["m@x.com", "0917", "dateOfBirth", "email", "phone", "_timeToFillDays"].forEach((k) => expect(json).not.toContain(k));
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  test("hidden profile: name only unless the applicant shared their photo; deleted account is former", async () => {
    wire({
      jobs: [job("j1", { slots: 3 })],
      apps: [app("j1", "u1", "hired"), app("j1", "u2", "hired", { includePhoto: true }), app("j1", "ghost", "hired")],
      users: [
        { _id: "u1", name: "Hidden One", profileImage: "/a.png", privacy: { profileVisibility: "hidden" } },
        { _id: "u2", name: "Hidden Two", profileImage: "/b.png", privacy: { profileVisibility: "hidden" } },
      ],
    });
    const res = await call();
    expect(res.body.items[0].hiredCandidates).toEqual([{ id: "u1", name: "Hidden One" }, { id: "u2", name: "Hidden Two", avatar: "/b.png" }, { id: "ghost", former: true }]);
  });

  test("scoped to the signed-in employer", async () => {
    wire({ jobs: [] });
    await call({}, "empA");
    const filter = JobVacancy.find.mock.calls[0][0];
    expect(filter.employer).toBe("empA");
    expect(filter.$or).toEqual([{ archived: true }, { status: "closed" }]);
    // Applications are only loaded for this employer's job ids (none here).
    expect(JobApplication.find).not.toHaveBeenCalled();
  });

  test("a zero-applicant job has a zero funnel and no hired list", async () => {
    wire({ jobs: [job("j1", { archiveReason: "deadline_passed" })] });
    const res = await call();
    expect(res.body.items[0]).toMatchObject({ status: "expired", funnel: { applicants: 0, qualified: 0, shortlisted: 0, hired: 0 }, hiredCandidates: [], firstApplicantAt: null });
  });

  test("filters, counts, search and sort", async () => {
    const jobs = [
      job("a", { title: "Cook", archiveReason: "manual_close", closedAt: D("2026-09-10") }),
      job("b", { title: "Cashier", archiveReason: "deadline_passed", closedAt: D("2026-09-20") }),
      job("c", { title: "Driver", closedAt: D("2026-09-30") }),
    ];
    const apps = [app("a", "u1", "hired"), app("a", "u2", "pending"), app("b", "u3", "pending"), app("b", "u4", "pending"), app("b", "u5", "pending")];
    wire({ jobs, apps, users: [{ _id: "u1", name: "A" }] });
    let res = await call({ filter: "no_applicants" });
    expect(res.body.items.map((i) => i.title)).toEqual(["Driver"]);
    expect(res.body.counts).toEqual({ all: 3, filled: 1, closed_manually: 0, expired: 1, no_applicants: 1 });
    wire({ jobs, apps, users: [{ _id: "u1", name: "A" }] });
    res = await call({ filter: "filled" });
    expect(res.body.items.map((i) => i.title)).toEqual(["Cook"]);
    wire({ jobs, apps, users: [{ _id: "u1", name: "A" }] });
    res = await call({});
    expect(res.body.items.map((i) => i.title)).toEqual(["Driver", "Cashier", "Cook"]); // recently closed
    wire({ jobs, apps, users: [{ _id: "u1", name: "A" }] });
    res = await call({ sort: "applicants" });
    expect(res.body.items.map((i) => i.title)).toEqual(["Cashier", "Cook", "Driver"]);
    wire({ jobs, apps, users: [{ _id: "u1", name: "A" }] });
    res = await call({ q: "cash" });
    expect(res.body.items.map((i) => i.title)).toEqual(["Cashier"]);
    expect(res.body.stats.archivedJobs).toBe(3); // stats cover every archived job, not the filter
  });

  test("pagination with a capped page size", async () => {
    const jobs = Array.from({ length: 12 }, (_, i) => job(`j${i}`, { closedAt: D(`2026-09-${String(i + 1).padStart(2, "0")}`) }));
    wire({ jobs });
    let res = await call({ limit: "500", page: "2" });
    expect(res.body).toMatchObject({ total: 12, page: 2, limit: 50 });
    wire({ jobs });
    res = await call({ limit: "5", page: "3" });
    expect(res.body.items).toHaveLength(2);
    wire({ jobs });
    res = await call({ limit: "abc", page: "-1" });
    expect(res.body).toMatchObject({ page: 1, limit: 10 });
    expect(res.body.items).toHaveLength(10);
  });

  test("a legacy job with no data is a neutral closed row", async () => {
    wire({ jobs: [job("j1", { closedAt: null, archivedAt: D("2026-09-13") })], apps: [app("j1", "u1", "pending")] });
    const res = await call();
    expect(res.body.items[0]).toMatchObject({ status: "closed", closeReason: null, closedBy: null });
  });

  test("a failure is a plain 500", async () => {
    JobVacancy.find.mockImplementation(() => {
      throw new Error("db");
    });
    const res = await call();
    expect(res.statusCode).toBe(500);
  });
});

describe("close sites record a reason; mounts", () => {
  test("the deadline and inactivity sweeps set closeReason and closedBy", async () => {
    JobVacancy.updateMany.mockResolvedValue({});
    JobVacancy.find
      .mockReturnValueOnce({ select: () => Promise.resolve([{ _id: "o1", title: "Old" }]) }) // overdue
      .mockReturnValueOnce({ select: () => Promise.resolve([]) }); // inactivity (none)
    SystemSettings.getSingleton.mockResolvedValue({ autoCloseDays: 30 });
    JobApplication.aggregate.mockResolvedValue([]);
    const res = { json: jest.fn(), status: jest.fn(() => res) };
    await employerController.getEmployerJobs({ user: { _id: "emp1" }, app: { get: () => null }, query: {} }, res).catch(() => {});
    const set = JobVacancy.updateMany.mock.calls[0]?.[1]?.$set;
    expect(set).toMatchObject({ status: "closed", closeReason: "expired", closedBy: "system" });
  });

  test("the inactivity sweep records inactivity (source check)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../controllers/employerController.js"), "utf8");
    expect(src).toContain('closeReason: "inactivity", closedBy: "system"');
  });

  test("archiveJobRecord stores hired names from User and a close reason (source check)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../controllers/jobController.js"), "utf8");
    expect(src).toContain("User.find({ _id: { $in: hiredCandidateIds } })");
    expect(src).toContain("job.closeReason =");
  });

  test("the route is registered before any /jobs/:id route and mounted on /api and /api/v1", () => {
    const routes = fs.readFileSync(path.join(__dirname, "../routes/employerRoutes.js"), "utf8");
    expect(routes.indexOf('router.get("/jobs/archived"')).toBeGreaterThan(-1);
    expect(routes.indexOf('router.get("/jobs/archived"')).toBeLessThan(routes.indexOf('router.put("/jobs/:id"'));
    const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
    expect(server).toContain("app.use(`${basePath}/employer`, employerRoutes)");
    expect(server).toContain('mountApiRoutes("/api/v1")');
    expect(server).toContain('mountApiRoutes("/api")');
  });

  test("the backfill script is dry-run by default (source check)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../scripts/backfillCloseReason.js"), "utf8");
    expect(src).toContain('process.argv.includes("--apply")');
    expect(src).toMatch(/if \(apply && ops\.length\)/);
  });
});
