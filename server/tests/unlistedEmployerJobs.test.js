// Employer account gate (suspended / banned / deactivated employers' postings are
// unlisted) and the live-search suggestions endpoint.

jest.mock("../models/User", () => ({ find: jest.fn(), findById: jest.fn() }));
jest.mock("../models/JobVacancy", () => ({ find: jest.fn(), updateMany: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const User = require("../models/User");
const JobVacancy = require("../models/JobVacancy");
const {
  UNLISTED_ACCOUNT_STATUSES,
  getUnlistedEmployerIds,
  withListedEmployers,
  isEmployerUnlisted,
} = require("../utils/jobVisibility");
const { suggestJobs, SUGGEST_MAX, SUGGEST_MIN_CHARS } = require("../controllers/recommendationController");
const { query, call, makeReq } = require("../testUtils/httpMocks");

beforeEach(() => {
  jest.resetAllMocks();
  User.find.mockImplementation(() => query([]));
  JobVacancy.find.mockImplementation(() => query([]));
});

describe("isEmployerUnlisted", () => {
  test("suspended, banned and deactivated accounts are unlisted", () => {
    UNLISTED_ACCOUNT_STATUSES.forEach((accountStatus) => {
      expect(isEmployerUnlisted({ accountStatus })).toBe(true);
    });
    expect(isEmployerUnlisted({ isActive: false })).toBe(true);
  });

  test("an active account is listed, and reactivation flips it back with no other state", () => {
    const account = { isActive: false, accountStatus: "suspended" };
    expect(isEmployerUnlisted(account)).toBe(true);
    account.isActive = true;
    account.accountStatus = "active";
    expect(isEmployerUnlisted(account)).toBe(false);
  });

  test("the temporary failed-login lockout does not unlist anything", () => {
    const locked = {
      isActive: true,
      accountStatus: "active",
      loginLock: { failures: 5, lockedUntil: new Date(Date.now() + 15 * 60 * 1000), level: 1 },
    };
    expect(isEmployerUnlisted(locked)).toBe(false);
  });

  test("missing or unpopulated employers are not treated as unlisted here", () => {
    expect(isEmployerUnlisted(null)).toBe(false);
    expect(isEmployerUnlisted("64b0c0ffee0000000000abcd")).toBe(false);
  });
});

describe("getUnlistedEmployerIds / withListedEmployers", () => {
  test("queries employers by isActive or accountStatus only, never by loginLock", async () => {
    User.find.mockImplementation(() => query(["e1", "e2"]));
    await expect(getUnlistedEmployerIds()).resolves.toEqual(["e1", "e2"]);
    const q = User.find.mock.calls[0][0];
    expect(q.role).toBe("employer");
    expect(q.$or).toEqual([{ isActive: false }, { accountStatus: { $in: ["suspended", "banned", "deactivated"] } }]);
    expect(JSON.stringify(q)).not.toMatch(/loginLock|lockedUntil/);
  });

  test("adds an employer $nin clause; leaves the filter alone when nobody is locked", async () => {
    expect(await withListedEmployers({ status: "active" }, [])).toEqual({ status: "active" });
    expect(await withListedEmployers({ status: "active" }, ["e1"])).toEqual({ status: "active", employer: { $nin: ["e1"] } });
  });

  test("keeps an existing employer clause and ANDs the gate onto it", async () => {
    const out = await withListedEmployers({ employer: "e9" }, ["e1"]);
    expect(out).toEqual({ $and: [{ employer: "e9" }, { employer: { $nin: ["e1"] } }] });
  });

  test("a job closed before the suspension is not touched by the gate (jobs are never written)", async () => {
    const closedJob = { _id: "j1", employer: "e1", status: "closed" };
    await withListedEmployers({ _id: "j1" }, ["e1"]);
    expect(closedJob.status).toBe("closed");
    expect(JobVacancy.updateMany).not.toHaveBeenCalled();
  });
});

describe("suggestJobs", () => {
  const run = (q) => call(suggestJobs, makeReq({ query: q === undefined ? {} : { q } }));
  const job = (title, companyName, skills = []) => ({
    title,
    employer: { companyName },
    qualifications: skills.map((value) => ({ value })),
  });

  test("needs at least 2 characters after trimming, with no database work", async () => {
    expect(SUGGEST_MIN_CHARS).toBe(2);
    for (const q of [undefined, "", " ", "a", "  a  "]) {
      const { status, body } = await run(q);
      expect(status).toBe(200);
      expect(body).toEqual({ suggestions: [] });
    }
    expect(JobVacancy.find).not.toHaveBeenCalled();
    expect(User.find).not.toHaveBeenCalled();
  });

  test("escapes regex characters instead of passing them to Mongo", async () => {
    await run("c++ (dev)[.*]");
    const rx = User.find.mock.calls.map((c) => c[0]).find((q) => q.companyName).companyName.$regex;
    expect(rx.source).toBe("c\\+\\+ \\(dev\\)\\[\\.\\*\\]");
    expect(() => "x".repeat(50).match(rx)).not.toThrow();
  });

  test("caps the query length so a huge input cannot reach the regex", async () => {
    await run("a".repeat(5000));
    const rx = User.find.mock.calls.map((c) => c[0]).find((q) => q.companyName).companyName.$regex;
    expect(rx.source.length).toBeLessThanOrEqual(60);
  });

  test("returns at most 8 deduplicated suggestions with a type each", async () => {
    expect(SUGGEST_MAX).toBe(8);
    const many = Array.from({ length: 20 }, (_, i) => job(`Cook ${i}`, "Cook House", ["Cooking", "cooking"]));
    JobVacancy.find.mockImplementation(() => query(many));
    const { body } = await run("cook");
    expect(body.suggestions).toHaveLength(8);
    const keys = body.suggestions.map((s) => `${s.type}:${s.text.toLowerCase()}`);
    expect(new Set(keys).size).toBe(keys.length);
    body.suggestions.forEach((s) => expect(["title", "company", "skill"]).toContain(s.type));
    expect(body.suggestions[0]).toEqual({ type: "title", text: "Cook 0" });
  });

  test("only suggests text that actually matches (a job matched by company does not leak its title)", async () => {
    JobVacancy.find.mockImplementation(() => query([job("Welder", "Acme Foods", ["Welding"])]));
    const { body } = await run("acme");
    expect(body.suggestions).toEqual([{ type: "company", text: "Acme Foods" }]);
  });

  test("looks up only listed jobs: employer gate, not closed, not archived, not past deadline", async () => {
    User.find.mockImplementation((q) => query(q.role === "employer" && q.$or ? ["locked1"] : []));
    await run("cook");
    const filter = JobVacancy.find.mock.calls[0][0];
    const listed = filter.$and[0];
    expect(listed.employer).toEqual({ $nin: ["locked1"] });
    expect(listed.isActive).toBe(true);
    expect(listed.status).toEqual({ $ne: "closed" });
    expect(listed.archived).toEqual({ $ne: true });
  });

  test("a failure is a generic 500 with no internals", async () => {
    JobVacancy.find.mockImplementation(() => {
      throw new Error("mongo secret");
    });
    const { status, body } = await run("cook");
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toMatch(/mongo secret/);
  });
});
