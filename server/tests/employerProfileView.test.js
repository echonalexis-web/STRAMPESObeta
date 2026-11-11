// A jobseeker viewing an employer profile sees five things only: header, About,
// business address, owner and authorized person (name and position), and the open
// postings (GET /profiles/:id/jobs). Forbidden fields must be ABSENT from the JSON.

jest.mock("../models/User", () => ({ findById: jest.fn() }));
jest.mock("../models/JobseekerProfile", () => ({ findOne: jest.fn() }));
jest.mock("../models/EmployerProfile", () => ({ findOne: jest.fn() }));
jest.mock("../models/JobVacancy", () => ({ find: jest.fn(), countDocuments: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ find: jest.fn() }));
jest.mock("../models/Follow", () => ({ exists: jest.fn() }));
jest.mock("../models/ContactShare", () => ({ find: jest.fn() }));
jest.mock("../models/BannerTemplate", () => ({ find: jest.fn() }));
jest.mock("../utils/jobDisplay", () => ({ getHiredCountMap: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const express = require("express");
const request = require("supertest");

const User = require("../models/User");
const EmployerProfile = require("../models/EmployerProfile");
const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const BannerTemplate = require("../models/BannerTemplate");
const { getHiredCountMap } = require("../utils/jobDisplay");
const bannerService = require("../services/bannerTemplateService");
const { getSummary, getProfile, getEmployerJobs } = require("../controllers/profileViewController");
const { buildVisibleJobFilter, isJobVisibleToJobseekers } = require("../utils/jobVisibility");

const ID = "507f1f77bcf86cd799439011";
const ADULT = new Date("1995-01-01T00:00:00.000Z");
const MINOR = new Date(Date.now() - 16 * 365.25 * 24 * 3600 * 1000);

const plainDoc = (obj) => ({
  ...obj,
  toObject() {
    return { ...obj };
  },
});
const employer = (extra = {}) =>
  plainDoc({
    _id: ID,
    role: "employer",
    name: "Jollibee",
    companyName: "Jollibee Foods",
    industry: "Food",
    email: "hr@jollibee.com",
    phone: "09171234567",
    website: "https://jollibee.example",
    companySize: "large",
    companyDescription: "We serve joy.",
    businessAddress: "legacy string",
    profileImage: "/logo.png",
    verificationStatus: "verified",
    isActive: true,
    loginLock: { n: 1 },
    password: "hash",
    governmentIdNumber: "SECRET-ID",
    validIdFile: "id.png",
    businessPermit: "permit.pdf",
    staffNote: "internal",
    ...extra,
  });
const empProfile = (extra = {}) =>
  plainDoc({
    tin: "999-TIN",
    fax: "02-1234",
    tradeName: "Jolly",
    officeType: "main",
    businessAddress: { street: "1 Ayala", barangay: "Poblacion", municipality: "Boac", province: "Marinduque", region: "IV-B" },
    ownerName: "Maria Santos",
    contactPersonName: "Juan Dela Cruz",
    contactPersonPosition: "Authorized representative",
    ...extra,
  });

const appFor = (user) => {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.get("/:id/summary", getSummary);
  app.get("/:id/jobs", getEmployerJobs);
  app.get("/:id", getProfile);
  return app;
};

const SEEKER = { id: "seeker1", role: "jobseeker", dateOfBirth: ADULT };
const MINOR_SEEKER = { id: "seeker2", role: "jobseeker", dateOfBirth: MINOR };
const OTHER_EMPLOYER = { id: "emp2", role: "employer" };
const ADMIN = { id: "adm", role: "admin" };
const SUPER = { id: "sup", role: "superadmin" };
const OWNER = { id: ID, role: "employer" };

const wire = ({ target = employer(), profile = empProfile() } = {}) => {
  User.findById.mockResolvedValue(target);
  EmployerProfile.findOne.mockResolvedValue(profile);
};

const query = (docs) => {
  const q = {
    select: jest.fn(() => q),
    sort: jest.fn(() => q),
    skip: jest.fn(() => q),
    limit: jest.fn(() => q),
    lean: jest.fn(() => Promise.resolve(docs)),
  };
  return q;
};

beforeEach(() => {
  jest.resetAllMocks();
  bannerService.invalidateCache();
  BannerTemplate.find.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve([]) }) });
});

describe("employer profile for a jobseeker: only the five allowed things", () => {
  test("exact allowed fields", async () => {
    wire();
    const res = await request(appFor(SEEKER)).get(`/${ID}`);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("jobseeker");
    expect(res.body.role).toBe("employer");
    expect(Object.keys(res.body.user).sort()).toEqual(["_id", "companyDescription", "companyName", "cover", "industry", "name", "profileImage", "role", "verified"]);
    expect(res.body.user.verified).toBe(true);
    expect(res.body.profile).toEqual({
      businessAddress: { street: "1 Ayala", barangay: "Poblacion", municipality: "Boac", province: "Marinduque" },
      owner: { name: "Maria Santos" },
      authorizedPerson: { name: "Juan Dela Cruz", position: "Authorized representative" },
    });
  });

  test("every forbidden field is absent from the JSON", async () => {
    wire();
    const res = await request(appFor(SEEKER)).get(`/${ID}`);
    const json = JSON.stringify(res.body);
    [
      "hr@jollibee.com",
      "09171234567",
      "email",
      "phone",
      "website",
      "companySize",
      "loginLock",
      "password",
      "SECRET-ID",
      "governmentId",
      "validIdFile",
      "businessPermit",
      "staffNote",
      "999-TIN",
      '"tin"',
      "fax",
      "tradeName",
      "officeType",
      "region",
      "verificationStatus",
      "legacy string",
      "applicant",
      "matchWeight",
    ].forEach((k) => expect(json).not.toContain(k));
  });

  test("not verified: the flag is false", async () => {
    wire({ target: employer({ verificationStatus: "pending" }) });
    const res = await request(appFor(SEEKER)).get(`/${ID}`);
    expect(res.body.user.verified).toBe(false);
  });

  test("empty sections are absent, not null", async () => {
    wire({
      target: employer({ companyDescription: "  " }),
      profile: empProfile({ businessAddress: { street: "", barangay: "", municipality: "", province: "" }, ownerName: "", contactPersonName: "", contactPersonPosition: "" }),
    });
    const res = await request(appFor(SEEKER)).get(`/${ID}`);
    expect("companyDescription" in res.body.user).toBe(false);
    expect(res.body.profile).toEqual({});
  });

  test("authorized person without a position shows the name only", async () => {
    wire({ profile: empProfile({ ownerName: "", contactPersonPosition: "" }) });
    const res = await request(appFor(SEEKER)).get(`/${ID}`);
    expect(res.body.profile.authorizedPerson).toEqual({ name: "Juan Dela Cruz" });
    expect("owner" in res.body.profile).toBe(false);
  });

  test("a 15 to 17 year old can view the profile", async () => {
    wire();
    const res = await request(appFor(MINOR_SEEKER)).get(`/${ID}`);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("jobseeker");
  });

  test.each([
    ["inactive", { isActive: false }],
    ["banned", { accountStatus: "banned" }],
    ["suspended status", { accountStatus: "suspended" }],
  ])("%s employer: the neutral unavailable answer", async (_n, extra) => {
    wire({ target: employer(extra) });
    const res = await request(appFor(SEEKER)).get(`/${ID}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: "PROFILE_UNAVAILABLE", message: "This profile is unavailable." });
  });

  test("deleted employer: the neutral unavailable answer", async () => {
    User.findById.mockResolvedValue(null);
    const res = await request(appFor(SEEKER)).get(`/${ID}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("PROFILE_UNAVAILABLE");
  });

  test("the hover card has header-level fields only", async () => {
    wire();
    const res = await request(appFor(SEEKER)).get(`/${ID}/summary`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["avatar", "cover", "headline", "id", "location", "name", "ownerLink", "role", "verified"]);
    expect(JSON.stringify(res.body)).not.toMatch(/Maria|Juan|Ayala|hr@/);
  });
});

describe("other viewers keep their behavior", () => {
  test("owner: full view, no secrets", async () => {
    wire();
    const res = await request(appFor(OWNER)).get(`/${ID}`);
    expect(res.body.mode).toBe("full");
    expect(res.body.user.email).toBe("hr@jollibee.com");
    expect(JSON.stringify(res.body)).not.toMatch(/loginLock|"password"/);
  });

  test.each([
    ["admin", ADMIN],
    ["superadmin", SUPER],
  ])("%s: staff view", async (_n, viewer) => {
    wire();
    const res = await request(appFor(viewer)).get(`/${ID}`);
    expect(res.body.mode).toBe("staff");
    expect(res.body.profile.tin).toBe("999-TIN");
  });

  test("another employer: the existing public view (not the jobseeker view)", async () => {
    wire();
    const res = await request(appFor(OTHER_EMPLOYER)).get(`/${ID}`);
    expect(res.body.mode).toBe("public");
    expect(res.body.user.website).toBe("https://jollibee.example");
    expect(JSON.stringify(res.body)).not.toMatch(/hr@jollibee|09171234567|Maria/);
  });

  test("signed out: the projection returns nothing (the route also needs a token)", () => {
    const { projectEmployer } = require("../services/profileProjection");
    expect(projectEmployer({ viewer: null, target: employer(), profile: empProfile() })).toBeNull();
  });
});

describe("GET /profiles/:id/jobs", () => {
  const job = (n, extra = {}) => ({
    _id: `j${n}`,
    title: `Job ${n}`,
    location: "Boac",
    salary: "15000",
    jobType: "Full-time",
    createdAt: new Date(),
    applicationDeadline: null,
    slots: 3,
    ...extra,
  });

  const wireJobs = (docs, total = docs.length) => {
    wire();
    JobApplication.find.mockReturnValue({ select: () => Promise.resolve([]) });
    JobVacancy.countDocuments.mockResolvedValue(total);
    const q = query(docs);
    JobVacancy.find.mockReturnValue(q);
    getHiredCountMap.mockResolvedValue({ j1: 1 });
    return q;
  };

  test("returns only job card fields, no applicant data", async () => {
    wireJobs([job(1, { applicationCount: 9, matchWeights: {}, description: "x", qualifications: [], employer: "x" })]);
    const res = await request(appFor(SEEKER)).get(`/${ID}/jobs`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 1, page: 1, limit: 10 });
    const item = res.body.items[0];
    expect(Object.keys(item).sort()).toEqual(["_id", "applicationDeadline", "createdAt", "employer", "jobType", "location", "remainingSlots", "salary", "title"]);
    expect(item.remainingSlots).toBe(2);
    expect(Object.keys(item.employer).sort()).toEqual(["_id", "companyName", "name", "profileImage"]);
    expect(JSON.stringify(res.body)).not.toMatch(/applicationCount|matchWeights|hr@jollibee|09171234567|description|qualifications/);
  });

  test("filters by the board's visibility rules, newest first", async () => {
    const q = wireJobs([job(1)]);
    await request(appFor(SEEKER)).get(`/${ID}/jobs`);
    const filter = JobVacancy.countDocuments.mock.calls[0][0];
    expect(filter).toMatchObject({ employer: ID, isActive: true, status: "active", archived: { $ne: true } });
    expect(filter.$or).toEqual([{ applicationDeadline: null }, { applicationDeadline: { $gt: expect.any(Date) } }]);
    expect(q.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
  });

  test("paginates and caps the page size", async () => {
    const q = wireJobs([job(1)], 120);
    const res = await request(appFor(SEEKER)).get(`/${ID}/jobs?page=3&limit=500`);
    expect(res.body).toMatchObject({ total: 120, page: 3, limit: 50 });
    expect(q.skip).toHaveBeenCalledWith(100);
    expect(q.limit).toHaveBeenCalledWith(50);
    const bad = await request(appFor(SEEKER)).get(`/${ID}/jobs?page=-4&limit=abc`);
    expect(bad.body).toMatchObject({ page: 1, limit: 10 });
  });

  test("no postings: empty list, no query for rows", async () => {
    wireJobs([], 0);
    const res = await request(appFor(SEEKER)).get(`/${ID}/jobs`);
    expect(res.body).toEqual({ items: [], total: 0, page: 1, limit: 10 });
    expect(JobVacancy.find).not.toHaveBeenCalled();
  });

  test("hides jobs the viewer was already hired for", async () => {
    wireJobs([job(1)]);
    JobApplication.find.mockReturnValue({ select: () => Promise.resolve([{ vacancy: "jHired" }]) });
    await request(appFor(SEEKER)).get(`/${ID}/jobs`);
    expect(JobVacancy.countDocuments.mock.calls[0][0]._id).toEqual({ $nin: ["jHired"] });
  });

  test.each([
    ["inactive", { isActive: false }],
    ["banned", { accountStatus: "banned" }],
  ])("%s employer: the neutral unavailable answer, no query", async (_n, extra) => {
    wire({ target: employer(extra) });
    const res = await request(appFor(SEEKER)).get(`/${ID}/jobs`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("PROFILE_UNAVAILABLE");
    expect(JobVacancy.countDocuments).not.toHaveBeenCalled();
  });

  test("a deleted employer or a jobseeker target is unavailable", async () => {
    User.findById.mockResolvedValue(null);
    expect((await request(appFor(SEEKER)).get(`/${ID}/jobs`)).status).toBe(404);
    User.findById.mockResolvedValue(plainDoc({ _id: ID, role: "jobseeker", isActive: true }));
    expect((await request(appFor(SEEKER)).get(`/${ID}/jobs`)).status).toBe(404);
  });

  test.each([
    ["an employer", OTHER_EMPLOYER],
    ["an admin", ADMIN],
    ["the owner", OWNER],
  ])("%s gets the neutral answer (not part of this view)", async (_n, viewer) => {
    wire();
    const res = await request(appFor(viewer)).get(`/${ID}/jobs`);
    expect(res.status).toBe(404);
    expect(JobVacancy.countDocuments).not.toHaveBeenCalled();
  });

  test("a 15 to 17 year old can browse the postings; apply rules are unchanged", async () => {
    wireJobs([job(1)]);
    const res = await request(appFor(MINOR_SEEKER)).get(`/${ID}/jobs`);
    expect(res.status).toBe(200);
    // No apply data in the payload; applying stays on POST /jobs/:id/apply (requireJobApplyAge).
    expect(JSON.stringify(res.body)).not.toMatch(/canApply|applyUrl/);
  });

  test("under 15 or no date of birth: same denial as the job board", async () => {
    wireJobs([job(1)]);
    const little = { id: "s3", role: "jobseeker", dateOfBirth: new Date(Date.now() - 10 * 365.25 * 24 * 3600 * 1000) };
    expect((await request(appFor(little)).get(`/${ID}/jobs`)).status).toBe(403);
    expect((await request(appFor({ id: "s4", role: "jobseeker" })).get(`/${ID}/jobs`)).body.code).toBe("DOB_REQUIRED");
  });
});

describe("job visibility: the query and the board's in-memory rule agree", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const past = new Date("2026-05-01T00:00:00Z");
  const future = new Date("2026-07-01T00:00:00Z");
  const matches = (job) => {
    const f = buildVisibleJobFilter("e", now);
    const okDeadline = f.$or.some((c) => (c.applicationDeadline === null ? !job.applicationDeadline : Boolean(job.applicationDeadline) && job.applicationDeadline > c.applicationDeadline.$gt));
    return job.isActive === f.isActive && job.status === f.status && job.archived !== true && okDeadline;
  };
  test.each([
    ["open", { isActive: true, status: "active", archived: false, applicationDeadline: null }, true],
    ["open with a future deadline", { isActive: true, status: "active", archived: false, applicationDeadline: future }, true],
    ["expired", { isActive: true, status: "active", archived: false, applicationDeadline: past }, false],
    ["closed", { isActive: true, status: "closed", archived: false, applicationDeadline: null }, false],
    ["draft", { isActive: true, status: "draft", archived: false, applicationDeadline: null }, false],
    ["archived", { isActive: true, status: "active", archived: true, applicationDeadline: null }, false],
    ["inactive", { isActive: false, status: "active", archived: false, applicationDeadline: null }, false],
  ])("%s", (_n, job, visible) => {
    expect(matches(job)).toBe(visible);
    // The board's rule agrees on everything except draft and isActive, which the board filters elsewhere.
    if (job.status !== "draft" && job.isActive) expect(isJobVisibleToJobseekers(job, now)).toBe(visible);
  });
});

describe("both mounts and rate limiting", () => {
  test("profileRoutes registers /:id/jobs behind the burst limiter and the budget", () => {
    jest.isolateModules(() => {
      jest.doMock("../middleware/auth", () => ({ verifyToken: (_q, _s, n) => n() }));
      jest.doMock("../middleware/budgets", () => ({ profileViewBudget: (_q, _s, n) => n() }));
      const router = require("../routes/profileRoutes");
      const names = router.stack.map((l) => (l.route ? `${Object.keys(l.route.methods)[0]} ${l.route.path}` : "mw"));
      expect(names).toEqual(["mw", "mw", "mw", "get /:id/summary", "get /:id/jobs", "get /:id"]);
    });
  });

  test("server.js mounts profileRoutes on every base path, which include /api and /api/v1", () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "../server.js"), "utf8");
    expect(src).toContain("app.use(`${basePath}/profiles`, profileRoutes)");
    expect(src).toContain('mountApiRoutes("/api/v1")');
    expect(src).toContain('mountApiRoutes("/api")');
  });
});
