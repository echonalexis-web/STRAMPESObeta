// Job Monitoring: the status=pending filter fix, and the stats moved into the database.
// The aggregation expressions are run through a tiny evaluator and compared with the
// JavaScript rules they replace, so "same numbers" is checked, not assumed.

const { buildAdminVacancyFilter, getAdminVacancyStats } = require("../controllers/adminController");
const { municipalityBucketExpression, normalizeMunicipalityLabel, MUNICIPALITY_LABELS } = require("../services/analytics/municipality");
const { statusGroupExpression, normalizeAdminJobStatus } = require("../services/analytics/jobStatus");

jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../models/JobVacancy", () => ({ aggregate: jest.fn(), distinct: jest.fn(), find: jest.fn(), countDocuments: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ aggregate: jest.fn() }));
jest.mock("../controllers/employerController", () => ({ applyJobUpdate: jest.fn() }));

const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");

// Evaluates the small subset of aggregation operators these expressions use.
const evaluate = (expr, doc) => {
  if (typeof expr === "string") return expr.startsWith("$") ? doc[expr.slice(1)] : expr;
  if (Array.isArray(expr)) return expr.map((item) => evaluate(item, doc));
  if (expr === null || typeof expr !== "object") return expr;
  const [op] = Object.keys(expr);
  const arg = expr[op];
  switch (op) {
    case "$ifNull": {
      const [value, fallback] = arg.map((item) => evaluate(item, doc));
      return value === undefined || value === null ? fallback : value;
    }
    case "$trim":
      return String(evaluate(arg.input, doc)).trim();
    case "$toLower":
      return String(evaluate(arg, doc)).toLowerCase();
    case "$eq": {
      const [a, b] = arg.map((item) => evaluate(item, doc));
      return a === b;
    }
    case "$in": {
      const [value, list] = arg.map((item) => evaluate(item, doc));
      return list.includes(value);
    }
    case "$and":
      return arg.every((item) => evaluate(item, doc));
    case "$regexMatch":
      return new RegExp(arg.regex).test(String(evaluate(arg.input, doc)));
    case "$switch": {
      for (const branch of arg.branches) {
        if (evaluate(branch.case, doc)) return evaluate(branch.then, doc);
      }
      return evaluate(arg.default, doc);
    }
    default:
      throw new Error(`operator not supported by the test evaluator: ${op}`);
  }
};

describe("status=pending filter", () => {
  const NOT_PENDING = ["active", "closed", "filled", "hired", "completed", "rejected", "declined", "denied"];

  test("pending is its own condition: it never merges into the search $or, and it no longer matches active jobs", () => {
    const filter = buildAdminVacancyFilter({ search: "weld", status: "pending" });
    expect(filter.$or).toHaveLength(4); // title, industry, description, location only
    expect(filter.status).toEqual({ $nin: NOT_PENDING });
    expect(filter.status.$nin).toContain("active");
  });

  test.each(["pending", "review", "draft", "bogus"])("status %p means pending", (status) => {
    expect(buildAdminVacancyFilter({ status }).status).toEqual({ $nin: NOT_PENDING });
  });

  test.each([["active", "active"], ["closed", "closed"], ["filled", "closed"], ["rejected", "rejected"], ["denied", "rejected"]])(
    "status %p still filters status=%s",
    (status, expected) => {
      expect(buildAdminVacancyFilter({ status }).status).toBe(expected);
    }
  );

  test("no status and no search: an empty filter", () => {
    expect(buildAdminVacancyFilter({})).toEqual({});
  });
});

describe("aggregation expressions equal the JavaScript rules", () => {
  const LOCATIONS = [
    "", "   ", undefined, null,
    "Boac", "boac, Marinduque", "Brgy. Poblacion, Boac, Marinduque, MIMAROPA", "Capital town",
    "Santa Cruz", "Brgy. Bangcuangan, Santa Cruz, Marinduque", "SANTA CRUZ",
    "Gasan", "Mogpog", "Torrijos", "Buenavista", "Gasan, Marinduque",
    "Manila", "Quezon City", "Other / Outside Province", "Brgy Other, Gasan, Marinduque", "Overseas, other, outside",
    "Santa   Cruz", "Sta. Cruz", "Mother Lode, Torrijos",
  ];

  test("municipality bucket expression matches normalizeMunicipalityLabel for every sample", () => {
    const expr = municipalityBucketExpression("$location");
    for (const location of LOCATIONS) {
      const viaExpression = evaluate(expr, { location });
      expect(viaExpression).toBe(normalizeMunicipalityLabel(location || ""));
      expect(MUNICIPALITY_LABELS).toContain(viaExpression);
    }
  });

  test("status group expression matches normalizeAdminJobStatus for every sample", () => {
    const expr = statusGroupExpression("$status");
    for (const status of ["active", "Active", " ACTIVE ", "closed", "filled", "hired", "completed", "rejected", "declined", "denied", "draft", "pending", "review", "weird", "", null, undefined]) {
      expect(evaluate(expr, { status })).toBe(normalizeAdminJobStatus(status));
    }
  });
});

describe("getAdminVacancyStats", () => {
  const run = async (query = {}) => {
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getAdminVacancyStats({ query, user: { role: "admin" } }, res);
    return res;
  };

  beforeEach(() => jest.clearAllMocks());

  test("builds the totals from the database groups and sums the applications of the matching postings", async () => {
    JobVacancy.aggregate.mockResolvedValue([{
      totals: [{ _id: null, totalPostings: 4, totalSlots: 9 }],
      byStatus: [{ _id: "active", count: 2 }, { _id: "closed", count: 1 }, { _id: "pending", count: 1 }],
      byMunicipality: [{ _id: "Gasan", jobs: 3, slots: 6 }, { _id: "Other / Outside Province", jobs: 1, slots: 3 }],
    }]);
    JobVacancy.distinct.mockResolvedValue(["a", "b", "c", "d"]);
    JobApplication.aggregate.mockResolvedValue([{ total: 11 }]);

    const res = await run({ status: "all" });
    const body = res.json.mock.calls[0][0];
    expect(body.totals).toEqual({ totalPostings: 4, active: 2, pending: 1, closed: 1, rejected: 0, totalSlots: 9, applications: 11 });
    expect(body.municipalityBreakdown.map((m) => m.label)).toEqual(MUNICIPALITY_LABELS);
    expect(body.municipalityBreakdown.find((m) => m.label === "Gasan")).toEqual({ label: "Gasan", jobs: 3, slots: 6 });
    // the stats are computed in one aggregation, never by loading the postings
    expect(JobVacancy.find).not.toHaveBeenCalled();
  });

  test("the same filter reaches the aggregation and the id lookup (stats follow the list)", async () => {
    JobVacancy.aggregate.mockResolvedValue([{ totals: [], byStatus: [], byMunicipality: [] }]);
    JobVacancy.distinct.mockResolvedValue([]);
    await run({ municipality: "Gasan", status: "pending" });
    const matchStage = JobVacancy.aggregate.mock.calls[0][0][0].$match;
    expect(matchStage).toEqual(buildAdminVacancyFilter({ municipality: "Gasan", status: "pending" }));
    expect(JobVacancy.distinct.mock.calls[0][1]).toEqual(matchStage);
    expect(JobApplication.aggregate).not.toHaveBeenCalled();
  });
});
