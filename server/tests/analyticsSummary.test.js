// GET /admin/analytics/summary and /filter-options: validation, response shape, the
// pipeline's filters, the small-cell rule and error mapping. Aggregations are mocked
// (the facet output is canned); what is checked is what is asked of the database and
// what is returned.

jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const mockAggregate = () => {
  const fn = jest.fn();
  return { aggregate: fn };
};
jest.mock("../models/User", () => mockAggregate());
jest.mock("../models/JobVacancy", () => mockAggregate());
jest.mock("../models/JobApplication", () => mockAggregate());
jest.mock("../models/SpesPosting", () => mockAggregate());
jest.mock("../models/SpesApplication", () => mockAggregate());
jest.mock("../models/SystemOption", () => ({
  find: jest.fn(() => ({ sort: () => ({ select: () => ({ lean: async () => [{ category: "industry", value: "Retail" }, { category: "jobType", value: "Part-time" }] }) }) })),
}));
jest.mock("../utils/jobVisibility", () => ({
  withListedEmployers: jest.fn(async (filter) => ({ ...filter, employer: { $nin: ["x"] } })),
  getUnlistedEmployerIds: jest.fn(async () => ["x"]),
}));

const User = require("../models/User");
const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const SpesApplication = require("../models/SpesApplication");
const { getAnalyticsSummary: handler, getAnalyticsFilterOptions } = require("../controllers/analyticsController");
const { monthKeys, breakdown } = require("../services/analytics/summaryStats");
const { periodBounds } = require("../services/analytics/period");

// aggregate(...) returns an object with .option(), like a Mongoose Aggregate.
const answer = (model, rows) => {
  model.aggregate.mockImplementation((pipeline) => ({ option: () => Promise.resolve(rows), pipeline }));
};

const call = async (query) => {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (code) => ((res.statusCode = code), res);
  res.json = (body) => ((res.body = body), res);
  res.set = (key, value) => ((res.headers[key] = value), res);
  await handler({ query }, res);
  return res;
};

const lastPipeline = (model) => model.aggregate.mock.calls[model.aggregate.mock.calls.length - 1][0];

beforeEach(() => jest.clearAllMocks());

describe("summary validation", () => {
  test("unknown section is 400 INVALID_FILTER", async () => {
    const res = await call({ section: "nope" });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("INVALID_FILTER");
  });

  test("an industry outside the catalog is refused", async () => {
    const res = await call({ section: "jobs", industry: "Made up" });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("INVALID_FILTER");
  });

  test("an object-valued filter is refused, never used as an operator", async () => {
    const res = await call({ section: "jobs", municipality: { $ne: "x" } });
    expect(res.statusCode).toBe(400);
  });

  test("a bad period is 400 INVALID_PERIOD", async () => {
    const res = await call({ section: "jobs", period: "quarter", year: "2026", quarter: "9" });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("INVALID_PERIOD");
  });
});

describe("jobs section", () => {
  const facets = {
    totals: [{ postings: 4, slots: 6, applications: 10, hires: 2 }],
    byStatus: [{ _id: "active", value: 3 }, { _id: "archived", value: 1 }],
    byMunicipality: [{ _id: "Gasan", value: 4 }],
    byIndustry: [{ _id: "Retail", value: 4 }],
    byJobType: [{ _id: "Full-time", value: 4 }],
    byWorkNature: [{ _id: "unspecified", value: 4 }],
    byMonth: [{ _id: "2026-02", value: 4 }],
  };

  test("returns cards, series and breakdowns; the period is echoed in Manila dates", async () => {
    answer(JobVacancy, [facets]);
    const res = await call({ section: "jobs", period: "quarter", year: "2026", quarter: "1" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(res.body.period).toMatchObject({ type: "quarter", from: "2026-01-01", to: "2026-03-31" });
    expect(res.body.cards.map((c) => [c.key, c.value])).toEqual([["postings", 4], ["slots", 6], ["applications", 10], ["hires", 2]]);
    const series = res.body.series[0];
    expect(series.points.map((p) => p.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(series.points[1].value).toBe(4);
    const status = res.body.breakdowns.find((b) => b.key === "status");
    expect(status.items.map((i) => i.key)).toEqual(["active", "closed", "draft", "archived"]);
    expect(status.total).toBe(4);
  });

  test("filters become match clauses and the quarter uses Manila midnight bounds", async () => {
    answer(JobVacancy, [facets]);
    await call({ section: "jobs", period: "quarter", year: "2026", quarter: "1", industry: "Retail", workNature: "remote", jobStatus: "archived", municipality: "Gasan" });
    const pipeline = lastPipeline(JobVacancy);
    const match = pipeline[0].$match.$and;
    const period = periodBounds({ type: "quarter", year: 2026, quarter: 1 });
    expect(match[0]).toEqual({ createdAt: { $gte: period.from, $lt: period.to } });
    expect(match).toContainEqual({ industry: "Retail" });
    expect(match).toContainEqual({ workNature: "remote" });
    expect(match).toContainEqual({ archived: true });
    expect(pipeline.some((stage) => stage.$match && stage.$match.municipalityBucket === "Gasan")).toBe(true);
  });

  test("scope=public adds the visibility rule; scope=all does not", async () => {
    answer(JobVacancy, [facets]);
    await call({ section: "jobs", scope: "public", period: "year", year: "2026" });
    expect(JSON.stringify(lastPipeline(JobVacancy)[0])).toContain("applicationDeadline");
    await call({ section: "jobs", period: "year", year: "2026" });
    expect(JSON.stringify(lastPipeline(JobVacancy)[0])).not.toContain("applicationDeadline");
  });

  test("a filter from another section is dropped, not an error", async () => {
    answer(JobVacancy, [facets]);
    const res = await call({ section: "jobs", ageBracket: "15-17", verification: "verified", period: "year", year: "2026" });
    expect(res.statusCode).toBe(200);
    expect(res.body.filters.ageBracket).toBeUndefined();
  });

  test("a database time limit becomes 504 QUERY_TIMEOUT", async () => {
    JobVacancy.aggregate.mockImplementation(() => ({ option: () => Promise.reject(Object.assign(new Error("operation exceeded time limit"), { code: 50 })) }));
    const res = await call({ section: "jobs", period: "year", year: "2026" });
    expect(res.statusCode).toBe(504);
    expect(res.body.code).toBe("QUERY_TIMEOUT");
  });
});

describe("employers section", () => {
  test("verification list and account status reach the match; scope public excludes unlisted employers", async () => {
    answer(User, [{ totals: [{ employers: 3, verified: 2, pendingReview: 1, goodStanding: 3 }], byVerification: [], byAccountStatus: [], byMunicipality: [], byIndustry: [], byMonth: [] }]);
    const res = await call({ section: "employers", verification: "pending,under_review", accountStatus: "active", scope: "public", period: "year", year: "2026" });
    expect(res.statusCode).toBe(200);
    const match = lastPipeline(User)[0].$match;
    expect(match).toMatchObject({ role: "employer", deletedAt: null, verificationStatus: { $in: ["pending", "under_review"] }, accountStatus: "active", _id: { $nin: ["x"] } });
    expect(res.body.cards.map((c) => c.key)).toEqual(["employers", "verified", "pendingReview", "goodStanding"]);
  });
});

describe("applicants section and the small-cell rule", () => {
  const applicantFacets = {
    totals: [{ applicants: 40, records: 60 }],
    byAgeBracket: [{ _id: "15-17", value: 3 }, { _id: "18-24", value: 20 }, { _id: "25-30", value: 12 }, { _id: "31+", value: 5 }],
    byMunicipality: [{ _id: "Gasan", value: 40 }],
    byMonth: [{ _id: "2026-01", value: 60 }],
    byStatus: [{ _id: "hired", value: 30 }, { _id: "accepted", value: 2 }, { _id: "pending", value: 28 }],
  };

  test("age cells under 5 are hidden and the total cannot be got by subtraction", async () => {
    answer(JobApplication, [applicantFacets]);
    const res = await call({ section: "applicants", period: "year", year: "2026" });
    const ages = res.body.breakdowns.find((b) => b.key === "ageBracket");
    const minors = ages.items.find((i) => i.key === "15-17");
    expect(minors).toMatchObject({ value: null, suppressed: true });
    // one hidden cell with a total shown: the smallest visible cell is hidden too
    expect(ages.items.filter((i) => i.suppressed).length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(res.body)).not.toContain('"value":3,');
  });

  test("legacy accepted rows are merged into hired", async () => {
    answer(JobApplication, [applicantFacets]);
    const res = await call({ section: "applicants", period: "year", year: "2026" });
    const status = res.body.breakdowns.find((b) => b.key === "status");
    expect(status.items.find((i) => i.key === "hired").value).toBe(32);
  });

  test("an age-bracket filter makes the cards follow the small-cell rule", async () => {
    answer(JobApplication, [{ ...applicantFacets, totals: [{ applicants: 3, records: 4 }] }]);
    const res = await call({ section: "applicants", ageBracket: "15-17", period: "year", year: "2026" });
    expect(res.body.cards[0]).toEqual({ key: "applicants", value: null, suppressed: true });
  });

  test("dateField=registered reads users, not applications, and has no status breakdown", async () => {
    answer(User, [{ totals: [{ applicants: 50, records: 50 }], byAgeBracket: [], byMunicipality: [], byMonth: [] }]);
    const res = await call({ section: "applicants", dateField: "registered", period: "year", year: "2026" });
    expect(User.aggregate).toHaveBeenCalled();
    expect(JobApplication.aggregate).not.toHaveBeenCalled();
    expect(res.body.breakdowns.some((b) => b.key === "status")).toBe(false);
  });

  test("the response never carries a date of birth", async () => {
    answer(JobApplication, [applicantFacets]);
    const res = await call({ section: "applicants", period: "year", year: "2026" });
    expect(JSON.stringify(res.body)).not.toMatch(/dateOfBirth|"dob"/);
  });

  test("SPES applicants are always under the small-cell rule", async () => {
    answer(SpesApplication, [{ totals: [{ applications: 4 }], byStatus: [{ _id: "submitted", value: 4 }], byAgeTier: [{ _id: "15-17", value: 4 }], byMonth: [] }]);
    const res = await call({ section: "applicants", dataset: "spes", period: "year", year: "2026" });
    expect(res.body.cards[0]).toEqual({ key: "applications", value: null, suppressed: true });
  });
});

describe("helpers", () => {
  test("monthKeys covers the Manila months of a period", () => {
    const keys = monthKeys(periodBounds({ type: "quarter", year: 2026, quarter: 4 })).map((k) => k.key);
    expect(keys).toEqual(["2026-10", "2026-11", "2026-12"]);
  });

  test("breakdown puts unlisted keys after the fixed order", () => {
    const result = breakdown("status", [{ _id: "weird", value: 1 }, { _id: "active", value: 2 }], { order: ["active", "closed"] });
    expect(result.items.map((i) => i.key)).toEqual(["active", "closed", "weird"]);
  });
});

describe("filter-options", () => {
  test("returns catalogs and a years list that ends at the current Manila year", async () => {
    const res = { headers: {} };
    res.set = (k, v) => ((res.headers[k] = v), res);
    res.json = (body) => ((res.body = body), res);
    await getAnalyticsFilterOptions({}, res);
    expect(res.body.municipalities).toContain("Gasan");
    expect(res.body.industries).toEqual(["Retail"]);
    expect(res.body.ageBrackets).toEqual(["15-17", "18-24", "25-30", "31+"]);
    expect(res.body.years[0]).toBeGreaterThanOrEqual(2026);
  });
});
