// Dashboard numbers: golden tests for the refactor (commit 5) and the before/after of every rule
// the fix commit changed (commit 6). The aggregation pipelines run through a small in-memory
// evaluator (testSupport/pipelineEval.js) so the numbers are checked without a database.

jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../models/User", () => ({ countDocuments: jest.fn(), aggregate: jest.fn() }));
jest.mock("../models/JobVacancy", () => ({ countDocuments: jest.fn(), aggregate: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ countDocuments: jest.fn(), aggregate: jest.fn() }));
jest.mock("../models/AuditLog", () => ({ countDocuments: jest.fn() }));
jest.mock("../utils/jobVisibility", () => ({ withListedEmployers: jest.fn(async (filter) => ({ ...filter, employer: { $nin: ["hidden-employer"] } })) }));

const User = require("../models/User");
const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const AuditLog = require("../models/AuditLog");
const { runPipeline } = require("../testSupport/pipelineEval");
const { startOfManilaDay, manilaParts } = require("../services/analytics/period");
const {
  getDashboardAnalytics,
  getProvincialAnalytics,
  normalizeApplicationStatus,
  APPLICATION_STATUS_KEYS,
  monthBuckets,
} = require("../services/analytics/dashboardStats");
const { normalizeApplicantMunicipality } = require("../services/analytics/municipality");

// ---- reference implementation: the old inline logic, with the intended Manila rules ---------------
const manilaMonthIndex = (date) => manilaParts(new Date(date)).month - 1;
const referenceBuckets = ({ applications, users, now }) => {
  const today = manilaParts(now);
  const from = startOfManilaDay(today.year, 1, 1);
  const to = startOfManilaDay(today.year + 1, 1, 1);
  const inYear = (d) => d && d >= from && d < to;

  const applicationsThisMonth = monthBuckets();
  applications.filter((a) => inYear(a.createdAt)).forEach((a) => { applicationsThisMonth[manilaMonthIndex(a.createdAt)] += 1; });
  const registrationsThisMonth = monthBuckets();
  users.filter((u) => inYear(u.createdAt) && !u.deletedAt).forEach((u) => { registrationsThisMonth[manilaMonthIndex(u.createdAt)] += 1; });

  const applicationsByStatus = Object.fromEntries(APPLICATION_STATUS_KEYS.map((key) => [key, 0]));
  applications.forEach((a) => {
    const normalized = normalizeApplicationStatus(a.status);
    if (normalized) applicationsByStatus[normalized] += 1;
  });
  return { applicationsThisMonth, registrationsThisMonth, applicationsByStatus };
};

const legacyApplicantMunicipalities = ({ applications, profiles, yearStart, yearEnd }) => {
  const unique = [...new Set(applications.filter((a) => a.createdAt >= yearStart && a.createdAt < yearEnd).map((a) => String(a.applicant)))];
  const counts = new Map();
  profiles.filter((p) => unique.includes(String(p.userId))).forEach((profile) => {
    const address = profile.presentAddress || profile.permanentAddress || {};
    const normalized = normalizeApplicantMunicipality(String(address.municipality || "").trim(), String(address.province || "").trim());
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  });
  return Object.fromEntries([...counts.entries()].sort());
};

// ---- fixtures (UTC instants chosen around Manila edges; Manila is UTC+8) -------------------------
const NOW = new Date("2026-06-15T04:00:00Z");
const applications = [
  { applicant: "u1", createdAt: new Date("2025-12-31T16:00:00.000Z"), status: "pending" }, // 00:00 1 Jan 2026 Manila: January
  { applicant: "u2", createdAt: new Date("2026-12-31T15:59:59.999Z"), status: "hired" }, // last ms of 2026 Manila: December
  { applicant: "u3", createdAt: new Date("2025-12-31T15:59:59.999Z"), status: "Accepted" }, // 2025 in Manila
  { applicant: "u4", createdAt: new Date("2026-12-31T16:00:00.000Z"), status: "rejected" }, // 2027 in Manila
  { applicant: "u5", createdAt: new Date("2026-02-28T15:59:59.999Z"), status: "shortlisted" }, // February
  { applicant: "u6", createdAt: new Date("2026-02-28T16:00:00.000Z"), status: "Reviewed" }, // March (Manila) though 28 Feb UTC
  { applicant: "u7", createdAt: new Date("2026-06-30T16:30:00.000Z"), status: "under_review" }, // July in Manila
  { applicant: "u8", createdAt: new Date("2026-07-01T00:30:00.000Z"), status: "approved" },
  { applicant: "u9", createdAt: new Date("2026-08-08T00:00:00Z"), status: "HIRED" },
  { applicant: "u1", createdAt: new Date("2026-09-09T00:00:00Z"), status: "withdrawn" },
  { applicant: "u10", createdAt: new Date("2026-10-10T00:00:00Z"), status: "weird" },
  { applicant: "u11", createdAt: new Date("2026-11-11T00:00:00Z"), status: null },
  { applicant: "u12", createdAt: new Date("2026-11-12T00:00:00Z") },
  { applicant: "u13", createdAt: new Date("2026-05-05T00:00:00Z"), status: "Rejected" },
];
const users = [
  { createdAt: new Date("2025-12-31T16:00:00.000Z") },
  { createdAt: new Date("2026-12-31T15:59:59.999Z") },
  { createdAt: new Date("2025-12-31T15:59:59.999Z") },
  { createdAt: new Date("2026-04-04T00:00:00Z") },
  { createdAt: new Date("2026-04-05T00:00:00Z"), deletedAt: new Date("2026-05-01T00:00:00Z") }, // soft-deleted: not counted
  { createdAt: new Date("2026-12-31T16:00:00.000Z") },
];
const profiles = [
  { userId: "u1", presentAddress: { municipality: "Gasan", province: "Marinduque" } },
  { userId: "u2", presentAddress: { municipality: " boac ", province: " Marinduque " }, permanentAddress: { municipality: "Mogpog", province: "Marinduque" } },
  { userId: "u3", permanentAddress: { municipality: "Torrijos", province: "Marinduque" } },
  { userId: "u5", presentAddress: { municipality: "Santa Cruz", province: "Marinduque" } },
  { userId: "u6", presentAddress: { municipality: "Cebu City", province: "Cebu" } },
  { userId: "u7", presentAddress: {} },
  { userId: "u8", permanentAddress: { municipality: "Buenavista", province: "Marinduque" } },
  { userId: "u9", presentAddress: { municipality: "Gasan", province: "Marinduque" } },
  { userId: "u10", presentAddress: { municipality: "Atlantis", province: "Marinduque" } },
];
const collections = { jobseekerprofiles: profiles };

beforeEach(() => {
  jest.clearAllMocks();
  User.countDocuments.mockResolvedValue(7);
  JobVacancy.countDocuments.mockResolvedValue(3);
  JobApplication.countDocuments.mockResolvedValue(14);
  AuditLog.countDocuments.mockResolvedValue(2);
  JobApplication.aggregate.mockImplementation(async (pipeline) => runPipeline(pipeline, applications, collections));
  User.aggregate.mockImplementation(async (pipeline) => runPipeline(pipeline, users, collections));
});

describe("getDashboardAnalytics", () => {
  test("monthly and status buckets match the reference for the whole fixture, at Manila edges", async () => {
    const expected = referenceBuckets({ applications, users, now: NOW });
    const actual = await getDashboardAnalytics(NOW);
    expect(actual.applicationsThisMonth).toEqual(expected.applicationsThisMonth);
    expect(actual.registrationsThisMonth).toEqual(expected.registrationsThisMonth);
    expect(actual.applicationsByStatus).toEqual(expected.applicationsByStatus);
    // the fixture really exercises the edges
    expect(expected.applicationsThisMonth[0]).toBe(1); // 00:00 1 January Manila is January, though still 31 December in UTC
    expect(expected.applicationsThisMonth[11]).toBe(1);
    expect(expected.applicationsThisMonth[2]).toBe(1); // 16:00Z on 28 Feb is 00:00 on 1 March in Manila
    expect(expected.registrationsThisMonth[3]).toBe(1); // the soft-deleted user of April is not counted
  });

  test("it gives the same answer in any server time zone, because the edges are Manila's", async () => {
    // the dashboard asks for 'now' as an instant; an instant just before Manila's new year is still the old year
    const lateDecember = new Date("2026-12-31T15:00:00Z"); // 23:00 on 31 December in Manila
    const expected = referenceBuckets({ applications, users, now: lateDecember });
    const actual = await getDashboardAnalytics(lateDecember);
    expect(actual.applicationsThisMonth).toEqual(expected.applicationsThisMonth);
    const earlyJanuary = new Date("2026-12-31T16:30:00Z"); // 00:30 on 1 January 2027 in Manila
    const nextYear = await getDashboardAnalytics(earlyJanuary);
    expect(nextYear.applicationsThisMonth).toEqual(referenceBuckets({ applications, users, now: earlyJanuary }).applicationsThisMonth);
    expect(nextYear.applicationsThisMonth).not.toEqual(actual.applicationsThisMonth);
  });

  test("status chart: every status is counted; under_review, approved and withdrawn are no longer dropped", async () => {
    const { applicationsByStatus } = await getDashboardAnalytics(NOW);
    expect(Object.keys(applicationsByStatus)).toEqual(["pending", "under_review", "reviewed", "shortlisted", "approved", "rejected", "hired", "withdrawn"]);
    expect(applicationsByStatus).toMatchObject({ pending: 1, under_review: 1, reviewed: 1, shortlisted: 1, approved: 1, rejected: 2, hired: 3, withdrawn: 1 });
  });

  test("account counts exclude soft-deleted accounts; the totals ask for deletedAt null", async () => {
    await getDashboardAnalytics(NOW);
    expect(User.countDocuments).toHaveBeenNthCalledWith(1, { role: { $ne: "superadmin" }, deletedAt: null });
    expect(User.countDocuments).toHaveBeenNthCalledWith(2, { role: "employer", deletedAt: null });
    expect(User.countDocuments).toHaveBeenNthCalledWith(3, { role: "jobseeker", deletedAt: null });
    expect(User.countDocuments).toHaveBeenNthCalledWith(4, { role: "employer", verificationStatus: "verified", deletedAt: null });
    expect(User.countDocuments).toHaveBeenNthCalledWith(5, { role: "employer", verificationStatus: "pending", deletedAt: null });
  });

  test("activeJobs follows the visibility rule (and the employer gate); activeJobsAll keeps the old count", async () => {
    const result = await getDashboardAnalytics(NOW);
    const visibleFilter = JobVacancy.countDocuments.mock.calls[1][0];
    expect(visibleFilter).toMatchObject({ isActive: true, status: "active", archived: { $ne: true }, employer: { $nin: ["hidden-employer"] } });
    expect(visibleFilter.$or).toEqual([{ applicationDeadline: null }, { applicationDeadline: { $gt: NOW } }]);
    expect(JobVacancy.countDocuments.mock.calls[2][0]).toEqual({ status: "active" });
    expect(result).toHaveProperty("activeJobs");
    expect(result).toHaveProperty("activeJobsAll");
  });

  test("the response keeps every old key and adds activeJobsAll", async () => {
    const result = await getDashboardAnalytics(NOW);
    expect(Object.keys(result).sort()).toEqual([
      "activeJobs", "activeJobsAll", "applicationsByStatus", "applicationsThisMonth", "auditEventsToday", "closedJobs", "pendingVerification",
      "registrationsThisMonth", "totalAccounts", "totalApplications", "totalEmployers", "totalJobSeekers", "totalVacancies", "verifiedEmployers",
    ]);
  });

  test("'audit events today' counts from Manila midnight", async () => {
    await getDashboardAnalytics(new Date("2026-06-15T20:00:00Z")); // 04:00 on 16 June in Manila
    expect(AuditLog.countDocuments.mock.calls[0][0].createdAt.$gte.toISOString()).toBe("2026-06-15T16:00:00.000Z");
  });
});

describe("getProvincialAnalytics", () => {
  const run = async (year = 2026) => {
    JobVacancy.aggregate.mockResolvedValue([]);
    JobApplication.aggregate
      .mockImplementationOnce(async () => []) // monthly applications
      .mockImplementationOnce(async () => []) // placement summary
      .mockImplementation(async (pipeline) => runPipeline(pipeline, applications, collections)); // applicant municipalities
    User.aggregate.mockResolvedValue([]);
    return getProvincialAnalytics({ year, municipality: "ALL" });
  };

  test("applicant municipalities equal the old profile loop (same quirks), over Manila year edges", async () => {
    const yearStart = startOfManilaDay(2026, 1, 1);
    const yearEnd = startOfManilaDay(2027, 1, 1);
    const expected = legacyApplicantMunicipalities({ applications, profiles, yearStart, yearEnd });
    const result = await run();
    const actual = Object.fromEntries(result.applicantMunicipalities.filter((m) => m.value > 0).map((m) => [m.municipality, m.value]).sort());
    expect(actual).toEqual(expected);
    expect(expected.Other).toBeGreaterThan(0);
  });

  test("the applicants query is one aggregation with a lookup", async () => {
    await run();
    const last = JobApplication.aggregate.mock.calls[JobApplication.aggregate.mock.calls.length - 1][0];
    expect(last.map((stage) => Object.keys(stage)[0])).toEqual(["$match", "$group", "$lookup", "$unwind", "$project", "$group"]);
    expect(last[0].$match.createdAt.$gte.toISOString()).toBe("2025-12-31T16:00:00.000Z");
  });

  test("the monthly registration and application groups use Manila months; registrations skip deleted accounts", async () => {
    await run();
    const registrations = User.aggregate.mock.calls[0][0];
    expect(registrations[0].$match).toMatchObject({ deletedAt: null, role: { $in: ["jobseeker", "employer"] } });
    expect(registrations[1].$group._id.month.$month.timezone).toBe("Asia/Manila");
    const monthly = JobApplication.aggregate.mock.calls[0][0];
    expect(monthly[1].$group._id.month.$month.timezone).toBe("Asia/Manila");
  });

  test("the industry clean-up filter uses the loop variable ($$ind), so blank industries are dropped", async () => {
    await run();
    const sectorPipeline = JobVacancy.aggregate.mock.calls.map((call) => call[0]).find((pipeline) => pipeline.some((stage) => stage.$addFields));
    const cond = sectorPipeline.find((stage) => stage.$addFields).$addFields.industryList.$filter.cond;
    expect(JSON.stringify(cond)).toContain("$$ind");
    expect(JSON.stringify(cond)).not.toMatch(/"\$ind"/);
  });
});
