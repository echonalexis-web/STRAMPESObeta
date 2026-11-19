// Superadmin "Account insights": numbers, privacy of the response, who can read it.

process.env.DISABLE_RATE_LIMITS = "true";

jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../models/User", () => ({ findById: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock("../models/SystemSettings", () => ({ getSingleton: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ aggregate: jest.fn() }));
jest.mock("../models/JobVacancy", () => ({ find: jest.fn() }));
jest.mock("../models/JobLike", () => ({ countDocuments: jest.fn() }));
jest.mock("../models/JobseekerProfile", () => ({ findOne: jest.fn() }));
jest.mock("../models/Report", () => ({ find: jest.fn(), countDocuments: jest.fn() }));
jest.mock("../models/Appeal", () => ({ find: jest.fn() }));
jest.mock("../models/AuditLog", () => ({ find: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue() }));

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const JobApplication = require("../models/JobApplication");
const JobVacancy = require("../models/JobVacancy");
const JobLike = require("../models/JobLike");
const JobseekerProfile = require("../models/JobseekerProfile");
const Report = require("../models/Report");
const Appeal = require("../models/Appeal");
const AuditLog = require("../models/AuditLog");
const { logAuditEvent } = require("../services/auditService");
const { buildInsights } = require("../services/userInsightsService");
const { getAccountType, hasVerifiedEmail } = require("../utils/accountType");
const { query } = require("../testUtils/httpMocks");

const ID = "bbbbbbbbbbbbbbbbbbbbbbbb";
const DAY = 24 * 60 * 60 * 1000;
const yearsAgo = (n) => new Date(Date.now() - n * 365.25 * DAY);

const baseUser = (over = {}) => ({
  _id: ID, name: "Juan", role: "jobseeker", username: "juan.dc", email: "juan@x.com", isEmailVerified: true,
  createdAt: new Date("2026-01-01"), lastLoginAt: new Date(), lastActiveAt: new Date(), isActive: true,
  accountStatus: "active", dateOfBirth: yearsAgo(25), skills: ["a", "b"],
  // fields that must never appear in the response
  password: "HASH", tokenVersion: 9, validIdFile: "id.png", resumeFile: "cv.pdf", governmentIdNumber: "123",
  businessPermitUrl: "permit.pdf", emailCode: { hash: "h" },
  ...over,
});

const wire = ({ user = baseUser(), statusRows = [], vacancies = [], hired = [], totals = [] } = {}) => {
  User.findById.mockImplementation(() => query(user));
  User.find.mockImplementation(() => query([{ _id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Admin Ana" }]));
  JobseekerProfile.findOne.mockImplementation(() => query({ civilStatus: "single" }));
  JobLike.countDocuments.mockResolvedValue(3);
  JobVacancy.find.mockImplementation(() => query(vacancies));
  JobApplication.aggregate.mockImplementation(async (pipeline) => {
    const group = pipeline.find((s) => s.$group);
    if (pipeline[0].$match.applicant) {
      return group.$group._id === null ? [{ _id: null, at: new Date("2026-03-01") }] : statusRows;
    }
    return pipeline[0].$match.status === "hired" ? hired : totals;
  });
  Report.find.mockImplementation(() => query([{ category: "spam", status: "resolved", resolution: { action: "warning" }, createdAt: new Date(), details: "SECRET", reporter: "x" }]));
  Report.countDocuments.mockResolvedValue(2);
  Appeal.find.mockImplementation(() => query([{ status: "denied", accountStatus: "suspended", createdAt: new Date(), message: "SECRET" }]));
  AuditLog.find.mockImplementation(() => query([{
    action: "admin.user.deactivated", severity: "critical", actorRole: "admin", actorId: "aaaaaaaaaaaaaaaaaaaaaaaa",
    createdAt: new Date(), metadata: { reason: "fraud" }, ipAddress: "1.2.3.4", userAgent: "UA",
  }]));
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("account type", () => {
  test("protected = verified email (or confirmed recovery email); basic = username-only", () => {
    expect(getAccountType({ email: "a@b.c", isEmailVerified: true })).toBe("protected");
    // legacy account: isEmailVerified never set, login treats it as verified
    expect(getAccountType({ email: "a@b.c" })).toBe("protected");
    expect(getAccountType({ email: "a@b.c", isEmailVerified: false })).toBe("basic");
    expect(getAccountType({ username: "x" })).toBe("basic");
    expect(getAccountType({ username: "x", recoveryEmail: "r@b.c", recoveryEmailVerifiedAt: new Date() })).toBe("protected");
    expect(getAccountType({ username: "x", recoveryEmail: "r@b.c" })).toBe("basic");
    expect(hasVerifiedEmail(null)).toBe(false);
  });
});

describe("buildInsights", () => {
  test("unknown users and staff accounts return null", async () => {
    User.findById.mockImplementation(() => query(null));
    expect(await buildInsights(ID)).toBeNull();
    for (const role of ["admin", "superadmin"]) {
      User.findById.mockImplementation(() => query(baseUser({ role })));
      expect(await buildInsights(ID)).toBeNull();
    }
  });

  test("jobseeker numbers: applications by status, saved jobs, skills, completeness, idle flag", async () => {
    wire({ statusRows: [{ _id: "pending", count: 2 }, { _id: "shortlisted", count: 1 }, { _id: "hired", count: 1 }, { _id: "rejected", count: 3 }, { _id: "withdrawn", count: 1 }] });
    const { jobseeker, account } = await buildInsights(ID);
    expect(jobseeker.applications).toMatchObject({ total: 8, shortlisted: 1, hired: 1, rejected: 3, withdrawn: 1 });
    expect(jobseeker.applications.lastApplicationAt).toEqual(new Date("2026-03-01"));
    expect(jobseeker.savedJobs).toBe(3);
    expect(jobseeker.skillsCount).toBe(2);
    expect(jobseeker.profileCompleteness.percent).toBeGreaterThan(0);
    expect(jobseeker.profileCompleteness.missingSections).toEqual(expect.any(Array));
    expect(jobseeker.idle90Days).toBe(false);
    expect(account.accountType).toBe("protected");
    // one grouped query per metric, not one per record
    expect(JobApplication.aggregate).toHaveBeenCalledTimes(2);
  });

  test("idle for 90+ days is flagged", async () => {
    wire({ user: baseUser({ lastActiveAt: new Date(Date.now() - 120 * DAY), lastLoginAt: new Date(Date.now() - 120 * DAY) }) });
    expect((await buildInsights(ID)).jobseeker.idle90Days).toBe(true);
  });

  test("age is a bracket and SPES eligibility, never a date of birth; an adult gets their email", async () => {
    wire();
    const result = await buildInsights(ID);
    expect(result.jobseeker.ageBracket).toBe("adult18to30");
    expect(result.jobseeker.spesEligible).toBe(true);
    expect(result.account.email).toBe("juan@x.com");
  });

  test("a minor's email address is withheld (only the flag stays)", async () => {
    wire({ user: baseUser({ dateOfBirth: yearsAgo(16) }) });
    const { account, jobseeker } = await buildInsights(ID);
    expect(jobseeker.ageBracket).toBe("minor15to17");
    expect(account.hasEmail).toBe(true);
    expect(account.email).toBeNull();
  });

  test("a username-only account is basic with a no-email flag", async () => {
    wire({ user: baseUser({ email: undefined, isEmailVerified: undefined }) });
    const { account } = await buildInsights(ID);
    expect(account).toMatchObject({ accountType: "basic", hasEmail: false, emailVerified: false, email: null });
  });

  test("the response never contains sensitive or internal fields or values", async () => {
    wire({ user: baseUser({ dateOfBirth: yearsAgo(16) }) });
    const json = JSON.stringify(await buildInsights(ID));
    ["password", "HASH", "tokenVersion", "dateOfBirth", "validIdFile", "id.png", "resumeFile", "cv.pdf", "governmentIdNumber",
      "businessPermit", "emailCode", "ipAddress", "1.2.3.4", "userAgent", "SECRET", "knownDevices"].forEach((word) => {
      expect(json).not.toContain(word);
    });
  });

  test("lock info is live: locked only while lockedUntil is in the future", async () => {
    const future = new Date(Date.now() + 60 * 1000);
    wire({ user: baseUser({ loginLock: { failures: 2, lockedUntil: future, level: 1 } }) });
    expect((await buildInsights(ID)).security).toMatchObject({ failedLoginCount: 2, lockLevel: 1, lockedNow: true, lockedUntil: future });
    wire({ user: baseUser({ loginLock: { failures: 0, lockedUntil: new Date(Date.now() - 1000), level: 1 } }) });
    expect((await buildInsights(ID)).security).toMatchObject({ lockedNow: false, lockedUntil: null });
    wire();
    expect((await buildInsights(ID)).security).toMatchObject({ failedLoginCount: 0, lockedNow: false });
  });

  test("status history names who acted; timeline and reports/appeals carry outcomes only", async () => {
    wire();
    const result = await buildInsights(ID);
    expect(result.statusHistory[0]).toMatchObject({ action: "admin.user.deactivated", byName: "Admin Ana", reason: "fraud" });
    expect(result.timeline[0]).toEqual(expect.objectContaining({ action: "admin.user.deactivated" }));
    expect(result.reports).toMatchObject({ againstCount: 2, filedCount: 2 });
    expect(result.reports.against[0]).toEqual({ category: "spam", status: "resolved", outcome: "warning", createdAt: expect.any(Date) });
    expect(result.appeals[0]).toMatchObject({ status: "denied", accountStatus: "suspended" });
    const timelineCall = AuditLog.find.mock.calls.find(([filter]) => filter.$or);
    expect(timelineCall).toBeTruthy();
  });

  test("employer numbers: postings by state, applicants, hires, time to hire, share with a hire", async () => {
    wire({
      user: baseUser({ role: "employer", verificationStatus: "verified", verificationReviewedAt: new Date("2026-02-01") }),
      vacancies: [
        { _id: "v1", status: "active", isActive: true }, { _id: "v2", status: "closed", isActive: true },
        { _id: "v3", status: "closed", archived: true, isActive: true }, { _id: "v4", status: "active", isActive: true },
      ],
      totals: [{ _id: null, count: 10 }],
      hired: [{ _id: "v1", hires: 2, days: 4 }, { _id: "v2", hires: 1, days: 8 }],
    });
    const { employer } = await buildInsights(ID);
    expect(employer.verification).toEqual({ status: "verified", reviewedAt: new Date("2026-02-01") });
    expect(employer.postings).toEqual({ total: 4, active: 2, closed: 1, archived: 1 });
    expect(employer.applicantsReceived).toBe(10);
    expect(employer.hires).toBe(3);
    expect(employer.averageDaysToHire).toBe(6);
    expect(employer.hireShare).toBe(50);
  });

  test("an employer with no postings has zeros and no division by zero", async () => {
    wire({ user: baseUser({ role: "employer" }) });
    const { employer } = await buildInsights(ID);
    expect(employer).toMatchObject({ postings: { total: 0 }, applicantsReceived: 0, hires: 0, hireShare: 0, averageDaysToHire: null });
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

  test.each(["/api/admin", "/api/v1/admin"])("%s insights and notes are superadmin only", async (prefix) => {
    for (const role of ["admin", "employer", "jobseeker"]) {
      expect((await request(app).get(`${prefix}/users/${ID}/insights`).set("Authorization", as(role))).status).toBe(403);
      expect((await request(app).put(`${prefix}/users/${ID}/notes`).set("Authorization", as(role)).send({ notes: "x" })).status).toBe(403);
    }
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("a superadmin gets insights with no-store caching", async () => {
    wire();
    User.findById.mockImplementationOnce(() => ({ select: jest.fn().mockResolvedValue({ role: "superadmin", isActive: true, tokenVersion: 0 }) }));
    const token = "Bearer " + jwt.sign({ id: ACTOR }, process.env.JWT_SECRET);
    const res = await request(app).get(`/api/admin/users/${ID}/insights`).set("Authorization", token);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.insights.account.role).toBe("jobseeker");
  });

  test("notes: saved, trimmed, limited to 2000 characters, audited by length only", async () => {
    User.findOneAndUpdate.mockResolvedValue({ _id: ID, role: "jobseeker" });
    const ok = await request(app).put(`/api/admin/users/${ID}/notes`).set("Authorization", as("superadmin")).send({ notes: "  called the office  " });
    expect(ok.status).toBe(200);
    expect(ok.body.notes).toBe("called the office");
    expect(User.findOneAndUpdate.mock.calls[0][0]).toEqual({ _id: ID, role: { $in: ["employer", "jobseeker"] } });
    const audit = logAuditEvent.mock.calls.find(([entry]) => entry.action === "admin.user.notes_updated")[0];
    expect(audit.metadata).toEqual({ length: 17 });
    expect(JSON.stringify({ ...audit, req: undefined })).not.toContain("called the office");

    const tooLong = await request(app).put(`/api/admin/users/${ID}/notes`).set("Authorization", as("superadmin")).send({ notes: "x".repeat(2001) });
    expect(tooLong.status).toBe(400);
    const wrongType = await request(app).put(`/api/admin/users/${ID}/notes`).set("Authorization", as("superadmin")).send({ notes: { a: 1 } });
    expect(wrongType.status).toBe(400);

    User.findOneAndUpdate.mockResolvedValue(null);
    const staff = await request(app).put(`/api/admin/users/${ID}/notes`).set("Authorization", as("superadmin")).send({ notes: "x" });
    expect(staff.status).toBe(404);
  });
});
