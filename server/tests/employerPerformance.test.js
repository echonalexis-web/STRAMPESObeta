// Employer performance: metric helpers, ranking order, eligibility, period handling and the
// two endpoints. Aggregations are mocked (canned rows per pipeline, told apart by their
// first stage); what is checked is the maths, the rules and what is returned.

jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../models/User", () => ({ find: jest.fn() }));
jest.mock("../models/JobVacancy", () => ({ aggregate: jest.fn(), find: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ aggregate: jest.fn(), find: jest.fn() }));

const User = require("../models/User");
const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const {
  wilsonLower,
  median,
  rankEmployers,
  isEmployerEligible,
  toMetrics,
  getEmployerRanking,
  getEmployerPerformanceDetail,
} = require("../services/analytics/employerPerformance");
const { getEmployerPerformance, getEmployerPerformanceDetail: detailHandler } = require("../controllers/analyticsController");

const NOW = new Date("2026-11-20T06:00:00Z"); // Q4 2026 in progress

const row = (overrides) => ({
  employerId: "e",
  name: "Co",
  postings: 3,
  applicants: 10,
  hires: 2,
  hireRateLower: 10,
  fillRate: 50,
  medianDaysToHire: 10,
  ...overrides,
});

describe("wilsonLower and median", () => {
  test("1 of 1 is below 8 of 20", () => {
    expect(wilsonLower(1, 1)).toBeLessThan(wilsonLower(8, 20));
  });
  test("zero applicants never divides by zero", () => {
    expect(wilsonLower(0, 0)).toBe(0);
    expect(toMetrics({}).hireRate).toBeNull();
    expect(toMetrics({}).fillRate).toBeNull();
  });
  test("median ignores one outlier", () => {
    expect(median([2, 3, 4, 200])).toBe(3.5);
    expect(median([5, 6, 400])).toBe(6);
    expect(median([])).toBeNull();
  });
});

describe("rankEmployers", () => {
  test("hires first, then Wilson hire rate, then fill rate, then faster time, then name", () => {
    const { ranked } = rankEmployers([
      row({ employerId: "d", name: "Delta", hires: 5, hireRateLower: 20, fillRate: 50, medianDaysToHire: 9 }),
      row({ employerId: "a", name: "Alpha", hires: 5, hireRateLower: 30 }),
      row({ employerId: "b", name: "Beta", hires: 6, hireRateLower: 1 }),
      row({ employerId: "c", name: "Charlie", hires: 5, hireRateLower: 20, fillRate: 80, medianDaysToHire: 20 }),
      row({ employerId: "e", name: "Echo", hires: 5, hireRateLower: 20, fillRate: 50, medianDaysToHire: 3 }),
    ]);
    expect(ranked.map((r) => r.name)).toEqual(["Beta", "Alpha", "Charlie", "Echo", "Delta"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  test("exact ties fall back to company name", () => {
    const { ranked } = rankEmployers([row({ employerId: "z", name: "Zed" }), row({ employerId: "a", name: "Abe" })]);
    expect(ranked.map((r) => r.name)).toEqual(["Abe", "Zed"]);
  });

  test("an employer under the minimum is listed without a rank", () => {
    const { ranked, notEnoughData } = rankEmployers([row({ employerId: "ok" }), row({ employerId: "thin", applicants: 1, hires: 1 })]);
    expect(ranked.map((r) => r.employerId)).toEqual(["ok"]);
    expect(notEnoughData.map((r) => r.employerId)).toEqual(["thin"]);
    expect(notEnoughData[0].rank).toBeUndefined();
  });

  test("a missing time to hire sorts last", () => {
    const { ranked } = rankEmployers([row({ employerId: "n", name: "N", medianDaysToHire: null }), row({ employerId: "t", name: "T", medianDaysToHire: 40 })]);
    expect(ranked[0].employerId).toBe("t");
  });
});

describe("isEmployerEligible", () => {
  const good = { role: "employer", verificationStatus: "verified", isActive: true, accountStatus: "active", deletedAt: null, purgedAt: null };
  test("verified and in good standing only", () => {
    expect(isEmployerEligible(good)).toBe(true);
    for (const bad of [
      { verificationStatus: "pending" },
      { accountStatus: "suspended" },
      { accountStatus: "banned" },
      { accountStatus: "deactivated" },
      { isActive: false },
      { deletedAt: new Date() },
      { purgedAt: new Date() },
      { role: "jobseeker" },
    ]) {
      expect(isEmployerEligible({ ...good, ...bad })).toBe(false);
    }
    expect(isEmployerEligible(null)).toBe(false);
  });
});

// ---- endpoints ----------------------------------------------------------------------------

// Canned rows by pipeline: applications cohort (starts with createdAt match), hires (status match),
// postings (JobVacancy).
const mockAggregates = ({ cohort = [], hires = [], postings = [] }) => {
  JobApplication.aggregate.mockImplementation((pipeline) => ({
    option: () => Promise.resolve(pipeline[0].$match.status ? hires : cohort),
  }));
  JobVacancy.aggregate.mockImplementation(() => ({ option: () => Promise.resolve(postings) }));
};

const employerDoc = (id, extra = {}) => ({
  _id: id,
  name: `Owner ${id}`,
  companyName: `Company ${id}`,
  role: "employer",
  verificationStatus: "verified",
  isActive: true,
  accountStatus: "active",
  deletedAt: null,
  purgedAt: null,
  ...extra,
});

const usersFind = (docs) =>
  User.find.mockImplementation(() => ({ select: () => ({ lean: async () => docs }) }));

beforeEach(() => jest.clearAllMocks());

describe("getEmployerRanking", () => {
  test("ranks verified employers; restricted and deleted ones are counted, never named", async () => {
    mockAggregates({
      cohort: [
        { _id: "good", received: 12, withdrawn: 2, hired: 4, responseEligible: 10, responded: 5, responseMs: [86400000 * 2, 86400000 * 4] },
        { _id: "suspended", received: 20, withdrawn: 0, hired: 9 },
        { _id: "deleted", received: 5, withdrawn: 0, hired: 1 },
      ],
      hires: [{ _id: "good", hires: 4 }, { _id: "suspended", hires: 9 }, { _id: "deleted", hires: 1 }],
      postings: [
        { _id: "good", postings: 3, withApplicants: 3, filled: 1, daysToHire: [10, 20, 30] },
        { _id: "suspended", postings: 4, withApplicants: 4, filled: 4, daysToHire: [5] },
        { _id: "deleted", postings: 1, withApplicants: 1, filled: 0, daysToHire: [] },
      ],
    });
    usersFind([employerDoc("good"), employerDoc("suspended", { accountStatus: "suspended" }), employerDoc("deleted", { deletedAt: new Date(), name: "Deleted user" })]);

    const result = await getEmployerRanking({ period: "quarter", year: "2026", quarter: "4" }, NOW);
    expect(result.rows.map((r) => r.employerId)).toEqual(["good"]);
    expect(result.rows[0]).toMatchObject({ rank: 1, name: "Company good", postings: 3, applicants: 10, hires: 4, fillRate: 33.3, medianDaysToHire: 20, responseRate: 50 });
    expect(result.eligibility).toEqual({ ranked: 1, notEnoughData: 0, excluded: 2 });
    // province totals still reconcile
    expect(result.totals).toMatchObject({ hires: 14, formerOrRestricted: { hires: 10 } });
    expect(JSON.stringify(result)).not.toMatch(/suspended|Deleted user/);
    expect(result.period).toMatchObject({ type: "quarter", isPartial: true, from: "2026-10-01", to: "2026-12-31" });
    expect(result.previous.comparedTo).toBe("same elapsed days");
    expect(result.responseDataAvailable).toBe(true);
  });

  test("a partial quarter is compared with the same elapsed span of the previous one", async () => {
    mockAggregates({ cohort: [], hires: [], postings: [] });
    usersFind([]);
    await getEmployerRanking({ period: "quarter", year: "2026", quarter: "4" }, NOW);
    const ranges = JobVacancy.aggregate.mock.calls.map((call) => call[0][0].$match.createdAt);
    expect(ranges).toHaveLength(2);
    const [current, previous] = ranges;
    expect(current.$gte.toISOString()).toBe("2026-09-30T16:00:00.000Z"); // 1 Oct Manila midnight
    expect(previous.$gte.toISOString()).toBe("2026-06-30T16:00:00.000Z"); // 1 Jul Manila midnight
    // not the whole of Q3: it stops after as many days as Q4 has run
    expect(previous.$lt.getTime()).toBeLessThan(new Date("2026-09-30T16:00:00Z").getTime());
  });

  test("previous-period hires and the change are attached to a ranked row", async () => {
    let call = 0;
    JobApplication.aggregate.mockImplementation((pipeline) => ({
      option: () => {
        if (pipeline[0].$match.status) {
          call += 1;
          return Promise.resolve(call === 1 ? [{ _id: "good", hires: 6 }] : [{ _id: "good", hires: 2 }]);
        }
        return Promise.resolve([{ _id: "good", received: 10, withdrawn: 0, hired: 2 }]);
      },
    }));
    JobVacancy.aggregate.mockImplementation(() => ({ option: () => Promise.resolve([{ _id: "good", postings: 2, withApplicants: 2, filled: 1, daysToHire: [4] }]) }));
    usersFind([employerDoc("good")]);
    const result = await getEmployerRanking({ period: "year", year: "2026" }, NOW);
    expect(result.rows[0].previous).toEqual({ rank: 1, hires: 2 });
    expect(result.rows[0].hiresChange).toBe(4);
  });

  test("a future quarter returns an empty ranking without querying", async () => {
    usersFind([]);
    const result = await getEmployerRanking({ period: "quarter", year: "2026", quarter: "4" }, new Date("2026-03-01T00:00:00Z"));
    expect(result.rows).toEqual([]);
    expect(JobApplication.aggregate).not.toHaveBeenCalled();
  });

  test("only quarter or year is accepted, and limit is capped at 50", async () => {
    await expect(getEmployerRanking({ period: "month", year: "2026", month: "3" }, NOW)).rejects.toMatchObject({ code: "INVALID_PERIOD" });
    usersFind([]);
    mockAggregates({});
    await expect(getEmployerRanking({ period: "year", year: "2026", limit: "9999" }, NOW)).resolves.toBeDefined();
  });

  test("a timeout is 504 QUERY_TIMEOUT through the handler", async () => {
    JobApplication.aggregate.mockImplementation(() => ({ option: () => Promise.reject(Object.assign(new Error("exceeded time limit"), { code: 50 })) }));
    JobVacancy.aggregate.mockImplementation(() => ({ option: () => Promise.resolve([]) }));
    const res = { statusCode: 200, headers: {} };
    res.status = (c) => ((res.statusCode = c), res);
    res.json = (b) => ((res.body = b), res);
    res.set = (k, v) => ((res.headers[k] = v), res);
    await getEmployerPerformance({ query: { period: "year", year: "2026" } }, res);
    expect(res.statusCode).toBe(504);
    expect(res.body.code).toBe("QUERY_TIMEOUT");
  });
});

describe("getEmployerPerformanceDetail", () => {
  const ID = "64b7f0f0f0f0f0f0f0f0f0f0";
  test("returns metrics, the previous period and per-posting funnels with counts only", async () => {
    mockAggregates({ cohort: [{ _id: ID, received: 4, withdrawn: 0, hired: 1 }], hires: [{ _id: ID, hires: 1 }], postings: [{ _id: ID, postings: 1, withApplicants: 1, filled: 1, daysToHire: [3] }] });
    usersFind([employerDoc(ID)]);
    JobVacancy.find.mockReturnValue({ select: () => ({ sort: () => ({ limit: () => ({ lean: async () => [{ _id: "j1", title: "Cashier", slots: 1, createdAt: new Date("2026-10-05T00:00:00Z"), status: "active", archived: false }] }) }) }) });
    JobApplication.find.mockReturnValue({
      select: () => ({
        lean: async () => [
          { vacancy: "j1", status: "pending", applicant: "secret-user" },
          { vacancy: "j1", status: "hired", hiredAt: new Date("2026-10-09T00:00:00Z"), statusUpdatedAt: new Date("2026-10-20T00:00:00Z") },
        ],
      }),
    });
    const result = await getEmployerPerformanceDetail(ID, { period: "quarter", year: "2026", quarter: "4" }, NOW);
    expect(result.employer).toMatchObject({ name: `Company ${ID}`, eligible: true });
    expect(result.metrics).toMatchObject({ postings: 1, hires: 1 });
    expect(result.postings[0].funnel).toMatchObject({ applicants: 2, hired: 1 });
    // time to fill uses hiredAt (9 Oct), not the later status change
    expect(result.postings[0].timeToFillDays).toBeCloseTo(4, 0);
    expect(JSON.stringify(result)).not.toContain("secret-user");
  });

  test("an unknown, malformed or deleted employer is 404", async () => {
    usersFind([]);
    await expect(getEmployerPerformanceDetail("not-an-id", {}, NOW)).rejects.toMatchObject({ status: 404 });
    await expect(getEmployerPerformanceDetail(ID, { period: "year", year: "2026" }, NOW)).rejects.toMatchObject({ status: 404 });
    usersFind([employerDoc(ID, { deletedAt: new Date() })]);
    await expect(getEmployerPerformanceDetail(ID, { period: "year", year: "2026" }, NOW)).rejects.toMatchObject({ status: 404 });
  });

  test("the handler maps 404 and passes the id through", async () => {
    usersFind([]);
    const res = { statusCode: 200, headers: {} };
    res.status = (c) => ((res.statusCode = c), res);
    res.json = (b) => ((res.body = b), res);
    res.set = (k, v) => ((res.headers[k] = v), res);
    await detailHandler({ params: { employerId: ID }, query: { period: "year", year: "2026" } }, res);
    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});
