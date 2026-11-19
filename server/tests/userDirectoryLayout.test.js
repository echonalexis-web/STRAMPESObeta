// Counts for the tabs and filter chips, batched per-row figures, and the
// comma-separated verification filter, behind the new User Management layout.

process.env.DISABLE_RATE_LIMITS = "true";

jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../models/User", () => ({ find: jest.fn(), countDocuments: jest.fn(), findById: jest.fn() }));
jest.mock("../models/SystemSettings", () => ({ getSingleton: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ aggregate: jest.fn() }));
jest.mock("../models/JobVacancy", () => ({ aggregate: jest.fn() }));
jest.mock("../models/JobseekerProfile", () => ({ find: jest.fn() }));

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const JobApplication = require("../models/JobApplication");
const JobVacancy = require("../models/JobVacancy");
const JobseekerProfile = require("../models/JobseekerProfile");
const { buildDirectoryQuery, parseVerificationList } = require("../utils/userDirectoryQuery");
const { getDirectoryCounts, getRowDetails } = require("../services/userDirectoryService");

// A chainable, awaitable stand-in for a Mongoose query.
const chain = (value) => {
  const q = {};
  ["select", "sort", "skip", "limit", "lean", "collation"].forEach((m) => { q[m] = jest.fn(() => q); });
  q.then = (resolve, reject) => Promise.resolve(value).then(resolve, reject);
  return q;
};

const NOW = new Date("2026-06-01T00:00:00Z").getTime();

describe("verification filter accepts one status or a comma-separated list", () => {
  const verification = (value) => buildDirectoryQuery({ verificationStatus: value }, { isSuperadmin: true, now: NOW }).filter.verificationStatus;

  test("a single value still filters by equality", () => {
    expect(verification("pending")).toBe("pending");
  });

  test("a list becomes $in, in a fixed order, without repeats", () => {
    expect(verification("under_review,pending,pending")).toEqual({ $in: ["pending", "under_review"] });
  });

  test("unknown names are dropped; nothing valid means no filter", () => {
    expect(verification("pending,bogus")).toBe("pending");
    expect(verification("bogus,also bad")).toBeUndefined();
    expect(verification("")).toBeUndefined();
  });

  test("objects are never passed through", () => {
    expect(parseVerificationList({ $ne: "x" })).toEqual([]);
    expect(parseVerificationList([{ $ne: "x" }])).toEqual([]);
    expect(parseVerificationList(["pending,rejected", "verified"])).toEqual(["pending", "rejected"]);
  });

  test("a very long list is bounded by the enum", () => {
    const huge = Array.from({ length: 5000 }, () => "pending").join(",");
    expect(parseVerificationList(huge)).toEqual(["pending"]);
  });
});

describe("getDirectoryCounts", () => {
  test("each count uses the shared filter for its own tab, deleted excluded, search and other chips ignored", async () => {
    User.countDocuments.mockImplementation(async (filter) => (filter.role === "employer" ? 7 : 3));
    const result = await getDirectoryCounts({ now: NOW });

    expect(Object.keys(result.employers).sort()).toEqual(["idle90", "pendingReview", "total"]);
    expect(Object.keys(result.jobseekers).sort()).toEqual(["idle90", "lockedNow", "noEmail", "total"]);
    expect(result.employers.total).toBe(7);
    expect(result.jobseekers.total).toBe(3);

    const filters = User.countDocuments.mock.calls.map(([f]) => f);
    for (const f of filters) {
      expect(f.deletedAt).toBeNull();
      expect(JSON.stringify(f)).not.toContain("$regex");
    }
    const pending = filters.find((f) => f.role === "employer" && f.verificationStatus);
    expect(pending.verificationStatus).toEqual({ $in: ["pending", "under_review"] });
    const locked = filters.find((f) => f["loginLock.lockedUntil"]);
    expect(locked.role).toBe("jobseeker");
    const noEmail = filters.find((f) => f.$and && JSON.stringify(f.$and).includes("email"));
    expect(noEmail.role).toBe("jobseeker");
  });
});

describe("getRowDetails", () => {
  const J1 = "aaaaaaaaaaaaaaaaaaaaaaa1";
  const J2 = "aaaaaaaaaaaaaaaaaaaaaaa2";
  const E1 = "bbbbbbbbbbbbbbbbbbbbbbb1";
  const E2 = "bbbbbbbbbbbbbbbbbbbbbbb2";
  const V1 = "cccccccccccccccccccccc01";
  const V2 = "cccccccccccccccccccccc02";

  beforeEach(() => {
    jest.clearAllMocks();
    JobApplication.aggregate
      .mockResolvedValueOnce([{ _id: J1, count: 4 }]) // applications by applicant
      .mockResolvedValueOnce([{ _id: V1, hires: 2 }]); // hires by vacancy
    JobVacancy.aggregate.mockResolvedValue([{ _id: E1, ids: [V1, V2] }]);
    User.find.mockReturnValue(chain([{ _id: J1, gender: "female", skills: ["a"] }]));
    JobseekerProfile.find.mockReturnValue(chain([{ userId: J1, civilStatus: "single" }]));
  });

  test("jobseekers get applications and a profile percent; employers get postings and hires", async () => {
    const details = await getRowDetails([
      { _id: J1, role: "jobseeker" }, { _id: J2, role: "jobseeker" },
      { _id: E1, role: "employer" }, { _id: E2, role: "employer" },
    ]);
    expect(details.get(J1).applications).toBe(4);
    expect(details.get(J1).profilePercent).toBeGreaterThan(0);
    expect(details.get(J2)).toEqual({ applications: 0, profilePercent: 0 });
    expect(details.get(E1)).toEqual({ postings: 2, hires: 2 });
    expect(details.get(E2)).toEqual({ postings: 0, hires: 0 });
  });

  test("the work is batched: a fixed number of queries however many rows", async () => {
    await getRowDetails([{ _id: J1, role: "jobseeker" }, { _id: J2, role: "jobseeker" }, { _id: E1, role: "employer" }]);
    expect(JobApplication.aggregate).toHaveBeenCalledTimes(2);
    expect(JobVacancy.aggregate).toHaveBeenCalledTimes(1);
    expect(User.find).toHaveBeenCalledTimes(1);
    expect(JobseekerProfile.find).toHaveBeenCalledTimes(1);
  });

  test("no raw profile fields come back, only the figures", async () => {
    const details = await getRowDetails([{ _id: J1, role: "jobseeker" }]);
    expect(Object.keys(details.get(J1)).sort()).toEqual(["applications", "profilePercent"]);
  });
});

describe("routes", () => {
  const ACTOR = "111111111111111111111111";
  const app = express();
  app.use(express.json());
  const router = require("../routes/adminRoutes");
  app.use("/api/admin", router);
  app.use("/api/v1/admin", router);

  const as = (role) => {
    User.findById.mockImplementationOnce(() => ({ select: jest.fn().mockResolvedValue({ role, isActive: true, tokenVersion: 0 }) }));
    return "Bearer " + jwt.sign({ id: ACTOR }, process.env.JWT_SECRET || (process.env.JWT_SECRET = "local-test-secret"));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    User.countDocuments.mockResolvedValue(5);
  });

  test.each(["/api/admin", "/api/v1/admin"])("%s/users-counts is superadmin only", async (prefix) => {
    for (const role of ["admin", "employer", "jobseeker"]) {
      const res = await request(app).get(`${prefix}/users-counts`).set("Authorization", as(role));
      expect(res.status).toBe(403);
    }
    expect(User.countDocuments).not.toHaveBeenCalled();
    expect((await request(app).get(`${prefix}/users-counts`)).status).toBeGreaterThanOrEqual(401);
    const ok = await request(app).get(`${prefix}/users-counts`).set("Authorization", as("superadmin"));
    expect(ok.status).toBe(200);
    expect(ok.body.employers.total).toBe(5);
    expect(ok.headers["cache-control"]).toMatch(/no-store/);
  });

  const doc = () => ({
    _id: "dddddddddddddddddddddd01",
    role: "jobseeker",
    name: "Ana",
    toJSON() { return { _id: this._id, role: this.role, name: this.name }; },
  });

  test("details=true adds the photo and per-row figures for a superadmin only", async () => {
    User.countDocuments.mockResolvedValue(1);
    User.find.mockReturnValueOnce(chain([doc()])).mockReturnValue(chain([]));
    JobApplication.aggregate.mockResolvedValue([]);
    JobVacancy.aggregate.mockResolvedValue([]);
    JobseekerProfile.find.mockReturnValue(chain([]));

    const sa = await request(app).get("/api/admin/users?role=jobseeker&details=true").set("Authorization", as("superadmin"));
    expect(sa.status).toBe(200);
    expect(sa.body.users[0].details).toEqual({ applications: 0, profilePercent: 0 });
    const selected = User.find.mock.results[0].value.select.mock.calls[0][0];
    expect(selected).toMatch(/profileImage/);

    jest.clearAllMocks();
    User.countDocuments.mockResolvedValue(1);
    User.find.mockReturnValueOnce(chain([doc()]));
    const admin = await request(app).get("/api/admin/users?role=jobseeker&details=true").set("Authorization", as("admin"));
    expect(admin.status).toBe(200);
    expect(admin.body.users[0].details).toBeUndefined();
    expect(User.find.mock.results[0].value.select.mock.calls[0][0]).not.toMatch(/profileImage/);
    expect(JobApplication.aggregate).not.toHaveBeenCalled();
  });
});
