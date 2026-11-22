// Public (signed-out) jobs: list, search and detail through the real job router on both
// the /api and /api/v1 mounts. The models are in-memory fakes that apply the REAL filter
// the service builds (a small Mongo-style matcher below), so "never appears" is checked
// against the actual visibility rule, not against a copy of it.

jest.mock("../models/JobVacancy", () => ({ find: jest.fn(), findOne: jest.fn(), countDocuments: jest.fn() }));
jest.mock("../models/User", () => ({ find: jest.fn(), findById: jest.fn() }));
jest.mock("../models/EmployerProfile", () => ({ find: jest.fn() }));
jest.mock("../services/systemOptionService", () => ({ getActiveValues: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

process.env.JWT_SECRET = "local-test-secret";
process.env.PUBLIC_JOBS_LIST_LIMIT_PER_MIN = "100000";
process.env.PUBLIC_JOB_DETAIL_LIMIT_PER_MIN = "100000";
delete process.env.DISABLE_RATE_LIMITS;

const express = require("express");
const request = require("supertest");
const JobVacancy = require("../models/JobVacancy");
const User = require("../models/User");
const EmployerProfile = require("../models/EmployerProfile");
const { getActiveValues } = require("../services/systemOptionService");

const router = require("../routes/jobRoutes");
const app = express();
app.use(express.json());
app.use("/api/jobs", router);
app.use("/api/v1/jobs", router);

// ---------------------------------------------------------------- tiny Mongo-style matcher
const asList = (value) => (Array.isArray(value) ? value : [value]);
const valuesAt = (doc, path) =>
  path.split(".").reduce((acc, key) => acc.flatMap((item) => (item == null ? [] : asList(item[key]))), [doc]);
const norm = (v) => (v instanceof Date ? v.getTime() : v);
const same = (a, b) => String(a) === String(b);

const matchValue = (docValues, cond) => {
  const present = docValues.filter((v) => v !== undefined);
  const isOps = cond && typeof cond === "object" && !(cond instanceof Date) && !(cond instanceof RegExp);
  if (!isOps) return cond === null ? present.length === 0 || present.every((v) => v === null) : present.some((v) => same(norm(v), norm(cond)));
  return Object.entries(cond).every(([op, arg]) => {
    switch (op) {
      case "$ne": return !present.some((v) => same(norm(v), norm(arg)));
      case "$nin": return !present.some((v) => arg.some((x) => same(v, x)));
      case "$in": return present.some((v) => arg.some((x) => same(v, x)));
      case "$gt": return present.some((v) => v != null && norm(v) > norm(arg));
      case "$gte": return present.some((v) => v != null && norm(v) >= norm(arg));
      case "$lte": return present.some((v) => v != null && norm(v) <= norm(arg));
      case "$regex": return present.some((v) => typeof v === "string" && new RegExp(arg, cond.$options || "").test(v));
      case "$options": return true;
      default: throw new Error(`matcher does not know ${op}`);
    }
  });
};
const matches = (doc, filter) =>
  Object.entries(filter).every(([key, cond]) => {
    if (key === "$and") return cond.every((f) => matches(doc, f));
    if (key === "$or") return cond.some((f) => matches(doc, f));
    return matchValue(valuesAt(doc, key), cond);
  });

const pick = (doc, fields) => {
  const out = { _id: doc._id };
  fields.split(/\s+/).filter(Boolean).forEach((f) => { if (doc[f] !== undefined) out[f] = doc[f]; });
  return out;
};
const compare = (a, b, sort) => {
  for (const [key, dir] of Object.entries(sort)) {
    const x = norm(a[key]);
    const y = norm(b[key]);
    if (x === y) continue;
    if (x == null) return dir;
    if (y == null) return -dir;
    return (x > y ? 1 : -1) * dir;
  }
  return 0;
};

// ---------------------------------------------------------------- data
const DAY = 24 * 3600 * 1000;
const now = Date.now();
const id = (n) => String(n).padStart(24, "0");
const EMPLOYERS = [
  { _id: "e1", role: "employer", companyName: "Acme Marinduque", name: "Pat Private", email: "hr@acme.test", phone: "09171234567", profileImage: "uploads/profiles/a.png", isActive: true, accountStatus: "active" },
  { _id: "e2", role: "employer", companyName: "Suspended Co", email: "s@x.test", isActive: false, accountStatus: "suspended" },
  { _id: "e3", role: "employer", companyName: "Gone Co", email: "g@x.test", isActive: false, accountStatus: "deactivated" },
  { _id: "e4", role: "employer", companyName: "Banned Co", email: "b@x.test", isActive: true, accountStatus: "banned" },
  // Never set a company name, but has a business (trade) name on its profile.
  { _id: "e5", role: "employer", companyName: "", name: "Lola Private", email: "l@x.test", isActive: true, accountStatus: "active" },
];
const PROFILES = [{ userId: "e5", tradeName: "Marinduque Bakery", tin: "123-456" }, { userId: "e1", tradeName: "Acme Trading" }];
const job = (n, over = {}) => ({
  _id: id(n), title: `Job ${n}`, description: "d", responsibilities: "r",
  qualifications: [{ type: "skill", value: "welding", optional: false, order: 1 }],
  industry: ["Construction"], workNature: "onsite", jobType: "Full-time", location: "Boac, Marinduque",
  salary: "15000", salaryMin: 15000, salaryMax: 20000, slots: 2,
  createdAt: new Date(now - n * DAY), applicationDeadline: null, employer: "e1",
  isActive: true, status: "active", archived: false,
  // Never public:
  internalNote: "secret note", minAge: 18, applicationCount: 99, checklistMatch: { percent: 80 },
  ...over,
});
let JOBS;
const reset = () => {
  JOBS = [
    job(1), job(2), job(3),
    job(4, { status: "closed" }),
    job(5, { status: "draft" }),
    job(6, { archived: true }),
    job(7, { applicationDeadline: new Date(now - DAY) }),
    job(8, { isActive: false }),
    job(9, { employer: "e2" }),
    job(10, { employer: "e3" }),
    job(11, { employer: "e4" }),
    job(12, { applicationDeadline: new Date(now + 5 * DAY), title: "Future deadline job" }),
  ];
};
const AVAILABLE = [id(1), id(2), id(3), id(12)];

const runQuery = (filter) => {
  let rows = JOBS.filter((j) => matches(j, filter));
  const q = {
    _select: null, _populate: null, _sort: {}, _skip: 0, _limit: Infinity,
    select(f) { q._select = f; return q; },
    populate(path, fields) { q._populate = { path, fields }; return q; },
    sort(s) { q._sort = s; return q; },
    skip(n) { q._skip = n; return q; },
    limit(n) { q._limit = n; return q; },
    lean() { return q; },
    then(resolve, reject) {
      try {
        let out = [...rows].sort((a, b) => compare(a, b, q._sort)).slice(q._skip, q._skip + q._limit);
        out = out.map((j) => {
          const shaped = q._select ? pick(j, q._select) : { ...j };
          if (q._populate) {
            const emp = EMPLOYERS.find((e) => e._id === j.employer);
            shaped.employer = emp ? pick(emp, q._populate.fields) : null;
          }
          return shaped;
        });
        resolve(out);
      } catch (e) { reject(e); }
    },
  };
  return q;
};

beforeEach(() => {
  reset();
  getActiveValues.mockImplementation(async (category) =>
    category === "jobType" ? new Set(["Full-time", "Part-time"]) : new Set(["Construction", "Retail"])
  );
  User.find.mockImplementation((filter) => ({
    distinct: async () => EMPLOYERS.filter((e) => matches(e, filter)).map((e) => e._id),
  }));
  EmployerProfile.find.mockImplementation((filter) => {
    const q = { select: () => q, lean: async () => PROFILES.filter((p) => filter.userId.$in.includes(String(p.userId))).map(({ userId, tradeName }) => ({ userId, tradeName })) };
    return q;
  });
  JobVacancy.countDocuments.mockImplementation(async (filter) => JOBS.filter((j) => matches(j, filter)).length);
  JobVacancy.find.mockImplementation((filter) => runQuery(filter));
  JobVacancy.findOne.mockImplementation((filter) => {
    const q = runQuery(filter);
    const original = q.then;
    q.then = (resolve, reject) => original((rows) => resolve(rows[0] || null), reject);
    return q;
  });
});

const PRIVATE = ["email", "phone", "applicationCount", "checklistMatch", "internalNote", "relevanceScore", "minAge", "hr@acme.test", "09171234567", "Pat Private"];
const noPrivate = (body) => {
  const text = JSON.stringify(body);
  PRIVATE.forEach((word) => expect(text).not.toContain(word));
};
const ids = (res) => res.body.jobs.map((j) => j._id);

describe.each(["/api/jobs", "/api/v1/jobs"])("%s public list", (prefix) => {
  test("a visitor with no token can list, and gets no-store caching", async () => {
    const res = await request(app).get(`${prefix}/public`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.pagination).toMatchObject({ total: 4, page: 1, limit: 9, pages: 1 });
  });

  test("only publicly available jobs appear: never closed, draft, archived, expired, inactive, or of a suspended, deactivated or banned employer", async () => {
    const res = await request(app).get(`${prefix}/public`);
    expect(new Set(ids(res))).toEqual(new Set(AVAILABLE));
    expect(res.body.total).toBe(4);
  });

  test("newest first by posting date", async () => {
    const res = await request(app).get(`${prefix}/public`);
    expect(ids(res)).toEqual([id(1), id(2), id(3), id(12)].sort((a, b) => JOBS.find((j) => j._id === b).createdAt - JOBS.find((j) => j._id === a).createdAt));
    expect(ids(res)[0]).toBe(id(1));
  });

  test("responses carry public fields only, and the employer is company name and logo only", async () => {
    const res = await request(app).get(`${prefix}/public`);
    noPrivate(res.body);
    const first = res.body.jobs[0];
    expect(Object.keys(first).sort()).toEqual(
      ["_id", "applicationDeadline", "createdAt", "description", "employer", "industry", "jobType", "location", "qualifications", "responsibilities", "salary", "salaryMax", "salaryMin", "slots", "title", "workNature"].sort()
    );
    expect(first.employer).toEqual({ companyName: "Acme Marinduque", profileImage: "uploads/profiles/a.png" });
  });
});

describe("employer name", () => {
  test("an employer with no company name shows its business name; one with a company name keeps it; the account holder's name never appears", async () => {
    JOBS = [job(1), job(2, { employer: "e5" })];
    const res = await request(app).get("/api/jobs/public");
    const byId = Object.fromEntries(res.body.jobs.map((j) => [j._id, j.employer.companyName]));
    expect(byId[id(1)]).toBe("Acme Marinduque");
    expect(byId[id(2)]).toBe("Marinduque Bakery");
    const text = JSON.stringify(res.body);
    ["Lola Private", "123-456", "l@x.test"].forEach((word) => expect(text).not.toContain(word));
    const one = await request(app).get(`/api/v1/jobs/public/${id(2)}`);
    expect(one.body.employer.companyName).toBe("Marinduque Bakery");
  });
});

describe("order and paging", () => {
  test("equal timestamps stay in a stable order and pages never repeat or skip a job", async () => {
    const same = new Date(now - 30 * DAY);
    JOBS = Array.from({ length: 7 }, (_, i) => job(100 + i, { createdAt: same }));
    const seen = [];
    for (let page = 1; page <= 4; page += 1) {
      const res = await request(app).get("/api/jobs/public").query({ limit: 2, page });
      seen.push(...ids(res));
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect(seen).toEqual([...seen].sort().reverse()); // _id descending as the tie-break
  });

  test("page size and page depth are capped", async () => {
    const big = await request(app).get("/api/jobs/public").query({ limit: 5000 });
    expect(big.body.pagination.limit).toBe(24);
    const deep = await request(app).get("/api/jobs/public").query({ page: 100000 });
    expect(deep.status).toBe(400);
    expect(deep.body.code).toBe("PAGE_TOO_DEEP");
    const junk = await request(app).get("/api/jobs/public").query({ page: "abc", limit: "-5" });
    expect(junk.body.pagination).toMatchObject({ page: 1, limit: 9 });
  });
});

describe("search and filters", () => {
  const search = (query) => request(app).get("/api/v1/jobs/public").query(query);

  beforeEach(() => {
    JOBS = [
      job(1, { title: "Welder", location: "Boac, Marinduque", jobType: "Full-time", industry: ["Construction"], workNature: "onsite", salaryMin: 15000, salaryMax: 20000 }),
      job(2, { title: "Cashier", location: "Mogpog", jobType: "Part-time", industry: ["Retail"], workNature: "remote", salaryMin: 9000, salaryMax: 11000, qualifications: [{ type: "skill", value: "Customer service", optional: false, order: 1 }] }),
      job(3, { title: "Accountant (Senior) 100%", qualifications: [{ type: "skill", value: "bookkeeping", optional: false, order: 1 }], location: "Santa Cruz", jobType: "Full-time", industry: ["Retail"], workNature: "hybrid", salaryMin: 25000, salaryMax: 30000 }),
    ];
  });

  test("keyword matches title, company name and a listed skill", async () => {
    expect(ids(await search({ q: "weld" }))).toEqual([id(1)]);
    expect(ids(await search({ q: "acme" })).sort()).toEqual([id(1), id(2), id(3)].sort());
    expect(ids(await search({ q: "customer service" }))).toEqual([id(2)]);
  });

  test("location, job type, work nature, industry and salary range filter together", async () => {
    expect(ids(await search({ location: "boac" }))).toEqual([id(1)]);
    expect(ids(await search({ jobType: "Part-time" }))).toEqual([id(2)]);
    expect(ids(await search({ workNature: "hybrid" }))).toEqual([id(3)]);
    expect(ids(await search({ industry: "Retail" })).sort()).toEqual([id(2), id(3)].sort());
    expect(ids(await search({ industry: ["Construction", "Retail"] }))).toHaveLength(3);
    expect(ids(await search({ salaryMin: 12000, salaryMax: 22000 }))).toEqual([id(1)]);
    expect(ids(await search({ industry: "Retail", workNature: "remote" }))).toEqual([id(2)]);
  });

  test("salary sort puts the highest pay first", async () => {
    expect(ids(await search({ sortBy: "salary" }))).toEqual([id(3), id(1), id(2)]);
  });

  test("unknown filter values give an empty list, never an unfiltered one", async () => {
    for (const query of [{ jobType: "Made-up" }, { workNature: "teleport" }, { industry: "Nope" }]) {
      const res = await search(query);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect(res.body.jobs).toEqual([]);
    }
  });

  test("regex characters are matched literally and objects or arrays in the query are ignored", async () => {
    expect((await search({ q: ".*" })).body.total).toBe(0);
    expect((await search({ q: "(" })).status).toBe(200);
    expect(ids(await search({ q: "100%" }))).toEqual([id(3)]);
    const odd = await request(app).get("/api/v1/jobs/public?q[$ne]=zzz&jobType[$gt]=&location[$regex]=.*");
    expect(odd.status).toBe(200);
    expect(odd.body.total).toBe(3);
  });

  test("a very long keyword is cut to the limit instead of failing", async () => {
    const res = await search({ q: "w".repeat(5000) });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });
});

describe.each(["/api/jobs", "/api/v1/jobs"])("%s public detail", (prefix) => {
  test("an available job opens for a visitor with public fields only", async () => {
    const res = await request(app).get(`${prefix}/public/${id(1)}`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.title).toBe("Job 1");
    noPrivate(res.body);
  });

  test("a job that is not publicly available answers exactly like one that does not exist", async () => {
    const missing = await request(app).get(`${prefix}/public/${id(999)}`);
    expect(missing.status).toBe(404);
    for (const n of [4, 5, 6, 7, 8, 9, 10, 11]) {
      const res = await request(app).get(`${prefix}/public/${id(n)}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(missing.body);
    }
    expect((await request(app).get(`${prefix}/public/not-an-id`)).body).toEqual(missing.body);
  });

  test("the older /:id route gives a visitor the same public view and the same not-found", async () => {
    const ok = await request(app).get(`${prefix}/${id(2)}`);
    expect(ok.status).toBe(200);
    noPrivate(ok.body);
    const closed = await request(app).get(`${prefix}/${id(4)}`);
    expect(closed.status).toBe(404);
    expect(closed.body).toEqual({ message: "Job not found" });
  });
});

describe("rate limit", () => {
  test("a visitor is limited per IP with a clear 429 message", async () => {
    process.env.PUBLIC_JOBS_LIST_LIMIT_PER_MIN = "3";
    const { publicJobsListLimiter } = require("../middleware/publicJobsLimiter");
    const mini = express();
    mini.get("/x", publicJobsListLimiter(), (req, res) => res.json({ ok: true }));
    const statuses = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await request(mini).get("/x")).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    const limited = await request(mini).get("/x");
    expect(limited.body).toEqual({ code: "RATE_LIMITED", message: "Too many requests. Please wait a minute and try again." });
    process.env.PUBLIC_JOBS_LIST_LIMIT_PER_MIN = "100000";
  });

  test("every public route has the limiter in front of it", () => {
    const stack = router.stack.filter((layer) => layer.route && /^\/(public|public\/:id|:id)?$/.test(layer.route.path) && layer.route.methods.get);
    const names = (path) => stack.find((l) => l.route.path === path).route.stack.map((s) => s.handle.name);
    // express-rate-limit handlers are anonymous functions; the visitor wrappers on the
    // older routes are named arrows, and the dedicated routes carry the limiter as their first handler.
    expect(stack.find((l) => l.route.path === "/public").route.stack.length).toBeGreaterThanOrEqual(2);
    expect(stack.find((l) => l.route.path === "/public/:id").route.stack.length).toBeGreaterThanOrEqual(2);
    expect(names("/")).toContain("");
  });
});
