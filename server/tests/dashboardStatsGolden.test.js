// Golden tests for the analytics refactor: the dashboard numbers computed in the database must
// equal what the old inline code computed by loading documents into memory. The old code is
// kept here as the reference implementation, the new pipelines run through a small in-memory
// evaluator over the same fixtures, and every number is compared.

jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../models/User", () => ({ countDocuments: jest.fn(), aggregate: jest.fn() }));
jest.mock("../models/JobVacancy", () => ({ countDocuments: jest.fn(), aggregate: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ countDocuments: jest.fn(), aggregate: jest.fn() }));
jest.mock("../models/AuditLog", () => ({ countDocuments: jest.fn() }));

const User = require("../models/User");
const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const AuditLog = require("../models/AuditLog");
const { runPipeline } = require("../testSupport/pipelineEval");
const {
  getDashboardAnalytics,
  getProvincialAnalytics,
  normalizeApplicationStatus,
  monthBuckets,
} = require("../services/analytics/dashboardStats");
const { normalizeApplicantMunicipality } = require("../services/analytics/municipality");

// ---- the OLD implementation, as it was in adminController (reference) -------------------------
const legacyDashboardBuckets = ({ applications, users, now }) => {
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const startOfNextYear = new Date(now.getFullYear() + 1, 0, 1);
  const inYear = (d) => d && d >= startOfYear && d < startOfNextYear;

  const yearlyApplications = applications.filter((a) => inYear(a.createdAt));
  const yearlyRegistrations = users.filter((u) => inYear(u.createdAt));

  const applicationsThisMonth = monthBuckets();
  yearlyApplications.forEach((item) => {
    const sourceDate = item.createdAt || item.appliedAt;
    if (!sourceDate) return;
    applicationsThisMonth[new Date(sourceDate).getMonth()] += 1;
  });
  const registrationsThisMonth = monthBuckets();
  yearlyRegistrations.forEach((item) => {
    if (!item.createdAt) return;
    registrationsThisMonth[new Date(item.createdAt).getMonth()] += 1;
  });

  const applicationsByStatus = { pending: 0, reviewed: 0, shortlisted: 0, rejected: 0, hired: 0 };
  applications.forEach((item) => {
    const normalized = normalizeApplicationStatus(item.status);
    if (normalized) applicationsByStatus[normalized] += 1;
  });
  return { applicationsThisMonth, registrationsThisMonth, applicationsByStatus };
};

const legacyApplicantMunicipalities = ({ applications, profiles, yearStart, yearEnd }) => {
  const unique = [...new Set(applications.filter((a) => a.createdAt >= yearStart && a.createdAt < yearEnd).map((a) => String(a.applicant)))];
  const found = profiles.filter((p) => unique.includes(String(p.userId)));
  const counts = new Map();
  found.forEach((profile) => {
    const applicantAddress = profile.presentAddress || profile.permanentAddress || {};
    const municipality = String(applicantAddress.municipality || "").trim();
    const province = String(applicantAddress.province || "").trim();
    const normalized = normalizeApplicantMunicipality(municipality, province);
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  });
  return Object.fromEntries([...counts.entries()].sort());
};

// ---- fixtures ---------------------------------------------------------------------------------
const local = (y, m, d, h = 12, min = 0, s = 0, ms = 0) => new Date(y, m - 1, d, h, min, s, ms);
const NOW = local(2026, 6, 15);

const applications = [
  // edges of the year, in the server's own time zone
  { applicant: "u1", createdAt: local(2026, 1, 1, 0, 0, 0, 0), status: "pending" },
  { applicant: "u2", createdAt: local(2026, 12, 31, 23, 59, 59, 999), status: "hired" },
  { applicant: "u3", createdAt: local(2025, 12, 31, 23, 59, 59, 999), status: "Accepted" },
  { applicant: "u4", createdAt: local(2027, 1, 1, 0, 0, 0, 0), status: "rejected" },
  // month edges
  { applicant: "u5", createdAt: local(2026, 2, 28, 23, 59, 59, 999), status: "shortlisted" },
  { applicant: "u6", createdAt: local(2026, 3, 1, 0, 0, 0, 0), status: "Reviewed" },
  { applicant: "u7", createdAt: local(2026, 6, 30, 23, 30), status: "under_review" },
  { applicant: "u8", createdAt: local(2026, 7, 1, 0, 30), status: "approved" },
  // odd statuses
  { applicant: "u9", createdAt: local(2026, 8, 8), status: "HIRED" },
  { applicant: "u1", createdAt: local(2026, 9, 9), status: "withdrawn" },
  { applicant: "u10", createdAt: local(2026, 10, 10), status: "weird" },
  { applicant: "u11", createdAt: local(2026, 11, 11), status: null },
  { applicant: "u12", createdAt: local(2026, 11, 12) },
  { applicant: "u13", createdAt: local(2026, 5, 5), status: "Rejected" },
];
const users = [
  { createdAt: local(2026, 1, 1, 0, 0, 0, 0) },
  { createdAt: local(2026, 12, 31, 23, 59, 59, 999) },
  { createdAt: local(2025, 12, 31, 23, 59, 59, 999) },
  { createdAt: local(2026, 4, 4) },
  { createdAt: local(2026, 4, 5) },
  { createdAt: local(2027, 1, 1) },
];
const profiles = [
  { userId: "u1", presentAddress: { municipality: "Gasan", province: "Marinduque" } },
  { userId: "u2", presentAddress: { municipality: " boac ", province: " Marinduque " }, permanentAddress: { municipality: "Mogpog", province: "Marinduque" } },
  { userId: "u3", permanentAddress: { municipality: "Torrijos", province: "Marinduque" } }, // applied in 2025: not in 2026
  { userId: "u5", presentAddress: { municipality: "Santa Cruz", province: "Marinduque" } },
  { userId: "u6", presentAddress: { municipality: "Cebu City", province: "Cebu" } },
  { userId: "u7", presentAddress: {} }, // an empty object is truthy: the permanent address is NOT used
  { userId: "u8", permanentAddress: { municipality: "Buenavista", province: "Marinduque" } },
  { userId: "u9", presentAddress: { municipality: "Gasan", province: "Marinduque" } },
  { userId: "u10", presentAddress: { municipality: "Atlantis", province: "Marinduque" } },
  // u11, u12, u13: no profile at all
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

describe("getDashboardAnalytics equals the old inline code", () => {
  test("monthly buckets and status buckets match for the whole fixture, including year and month edges", async () => {
    const expected = legacyDashboardBuckets({ applications, users, now: NOW });
    const actual = await getDashboardAnalytics(NOW);
    expect(actual.applicationsThisMonth).toEqual(expected.applicationsThisMonth);
    expect(actual.registrationsThisMonth).toEqual(expected.registrationsThisMonth);
    expect(actual.applicationsByStatus).toEqual(expected.applicationsByStatus);
    // sanity: the fixture really exercises the edges
    expect(expected.applicationsThisMonth[0]).toBe(1); // 1 Jan 00:00 local is January
    expect(expected.applicationsThisMonth[11]).toBe(1); // 31 Dec 23:59:59.999 local is December
    expect(expected.applicationsByStatus.hired).toBe(3); // hired, Accepted, HIRED
    expect(expected.applicationsByStatus.reviewed).toBe(1);
  });

  test("the same holds for another year and another day (the year edges move with 'now')", async () => {
    for (const now of [local(2025, 12, 31, 23, 59), local(2027, 1, 1, 0, 1), local(2026, 1, 1, 0, 0)]) {
      const expected = legacyDashboardBuckets({ applications, users, now });
      const actual = await getDashboardAnalytics(now);
      expect(actual.applicationsThisMonth).toEqual(expected.applicationsThisMonth);
      expect(actual.registrationsThisMonth).toEqual(expected.registrationsThisMonth);
      expect(actual.applicationsByStatus).toEqual(expected.applicationsByStatus);
    }
  });

  test("the plain counters are unchanged: same queries, same order of meaning", async () => {
    const result = await getDashboardAnalytics(NOW);
    expect(result).toMatchObject({
      totalAccounts: 7, totalEmployers: 7, totalJobSeekers: 7, totalVacancies: 3, totalApplications: 14,
      verifiedEmployers: 7, pendingVerification: 7, activeJobs: 3, closedJobs: 3, auditEventsToday: 2,
    });
    expect(User.countDocuments).toHaveBeenNthCalledWith(1, { role: { $ne: "superadmin" } });
    expect(JobVacancy.countDocuments).toHaveBeenNthCalledWith(2, { status: "active" });
    expect(JobVacancy.countDocuments).toHaveBeenNthCalledWith(3, { status: "closed" });
    expect(Object.keys(result).sort()).toEqual([
      "activeJobs", "applicationsByStatus", "applicationsThisMonth", "auditEventsToday", "closedJobs", "pendingVerification",
      "registrationsThisMonth", "totalAccounts", "totalApplications", "totalEmployers", "totalJobSeekers", "totalVacancies", "verifiedEmployers",
    ]);
  });

  test("no query loads whole collections any more: only counts and aggregations", async () => {
    await getDashboardAnalytics(NOW);
    expect(JobApplication.aggregate).toHaveBeenCalled();
    // the module does not even import a find(): the mocks above have none, so a find() would throw
  });
});

describe("getProvincialAnalytics applicant municipalities equal the old profile loop", () => {
  const run = async () => {
    // placement, vacancy and registration queries are not part of this refactor: return empty results
    JobVacancy.aggregate.mockResolvedValue([]);
    JobApplication.aggregate
      .mockImplementationOnce(async () => []) // monthly applications
      .mockImplementationOnce(async () => []) // placement summary
      .mockImplementation(async (pipeline) => runPipeline(pipeline, applications, collections)); // applicant municipalities
    User.aggregate.mockResolvedValue([]);
    return getProvincialAnalytics({ year: 2026, municipality: "ALL" });
  };

  test("counts per normalized municipality are identical, including trimming, empty address objects and missing profiles", async () => {
    const yearStart = new Date(2026, 0, 1);
    const yearEnd = new Date(2027, 0, 1);
    const expected = legacyApplicantMunicipalities({ applications, profiles, yearStart, yearEnd });
    const result = await run();
    const actual = Object.fromEntries(result.applicantMunicipalities.filter((m) => m.value > 0).map((m) => [m.municipality, m.value]).sort());
    expect(actual).toEqual(expected);
    // the quirks of the old code are kept on purpose in this commit
    expect(expected.Other).toBeGreaterThan(0); // u6 (Cebu), u7 (empty present address), u10 (Atlantis)
    expect(expected["Santa Cruz"]).toBe(1);
  });

  test("the percentages and the sort order are computed as before", async () => {
    const result = await run();
    const total = result.applicantMunicipalities.reduce((sum, m) => sum + m.value, 0);
    for (const entry of result.applicantMunicipalities) {
      expect(entry.percent).toBe(total > 0 ? Number(((entry.value / total) * 100).toFixed(1)) : 0);
    }
    const values = result.applicantMunicipalities.map((m) => m.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  test("the applicants query is one aggregation with a lookup, not a distinct list plus a profile find", async () => {
    await run();
    const lastPipeline = JobApplication.aggregate.mock.calls[JobApplication.aggregate.mock.calls.length - 1][0];
    expect(lastPipeline.map((stage) => Object.keys(stage)[0])).toEqual(["$match", "$group", "$lookup", "$unwind", "$project", "$group"]);
  });
});
