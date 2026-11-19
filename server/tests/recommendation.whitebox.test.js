// White-box branch coverage for recommendationController.js (job board search/ranking)
// and employerRecommendationController.js (ranked applicants).
// Tests tagged KNOWN-ISSUE pin CURRENT behaviour that looks like a defect (see
// docs/WHITE_BOX_TEST_REPORT.md).

jest.mock("../utils/jobVisibility", () => ({
  ...jest.requireActual("../utils/jobVisibility"),
  // Employer gate stubbed to "nobody is locked": plain functions so resetAllMocks keeps them.
  getUnlistedEmployerIds: async () => [],
  withListedEmployers: async (filter) => filter,
}));
jest.mock("../models/JobVacancy", () => ({ updateMany: jest.fn(), find: jest.fn(), findById: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ find: jest.fn() }));
jest.mock("../models/JobseekerProfile", () => ({ findOne: jest.fn(), find: jest.fn() }));
jest.mock("../models/Follow", () => ({ find: jest.fn() }));
jest.mock("../models/User", () => ({ findById: jest.fn(), find: jest.fn() }));
jest.mock("../services/semanticService", () => ({ rankJobsBySkills: jest.fn(), computeChecklistMatch: jest.fn(), rankApplicantsByJob: jest.fn() }));
jest.mock("../services/matchProfileService", () => ({ SEEKER_USER_FIELDS: "UF", SEEKER_PROFILE_FIELDS: "PF", buildSeekerForMatching: jest.fn() }));
jest.mock("../services/matchWeightsService", () => ({ buildWeightsByJobId: jest.fn(), resolveJobWeightsForScoring: jest.fn() }));
jest.mock("../utils/jobDisplay", () => ({ getApplicationCountMap: jest.fn(), getHiredCountMap: jest.fn() }));
jest.mock("../utils/personalizationEligibility", () => ({ canPersonalizeRecommendations: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const JobseekerProfile = require("../models/JobseekerProfile");
const Follow = require("../models/Follow");
const User = require("../models/User");
const semantic = require("../services/semanticService");
const { buildSeekerForMatching } = require("../services/matchProfileService");
const { buildWeightsByJobId, resolveJobWeightsForScoring } = require("../services/matchWeightsService");
const { getApplicationCountMap, getHiredCountMap } = require("../utils/jobDisplay");
const { canPersonalizeRecommendations } = require("../utils/personalizationEligibility");
const logger = require("../utils/logger");
const rec = require("../controllers/recommendationController");
const empRec = require("../controllers/employerRecommendationController");
const { makeReq, query, failingQuery, call } = require("../testUtils/httpMocks");

const dbError = () => new Error("secret db internals");
const future = () => new Date(Date.now() + 86400000);
const past = () => new Date(Date.now() - 86400000);

let logSpy;
let errSpy;
beforeEach(() => {
  jest.resetAllMocks();
  logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  JobVacancy.updateMany.mockResolvedValue();
  JobseekerProfile.findOne.mockImplementation(() => query(null));
  User.findById.mockImplementation(() => query(null));
  User.find.mockImplementation(() => query([]));
  Follow.find.mockImplementation(() => query([]));
  JobApplication.find.mockImplementation(() => query([]));
  getApplicationCountMap.mockResolvedValue({});
  getHiredCountMap.mockResolvedValue({});
  canPersonalizeRecommendations.mockReturnValue(false);
  semantic.computeChecklistMatch.mockReturnValue({ percent: 50, totalMustHaves: 1, metMustHaves: 1 });
  buildWeightsByJobId.mockResolvedValue({});
});
afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
});

const jobs = (list) => JobVacancy.find.mockImplementation(() => query(list));
const job = (id, o = {}) => ({ _id: id, slots: 3, employer: { _id: "emp1" }, ...o });
const search = (q = {}, user) => call(rec.hybridSearch, makeReq({ query: q, user }));
const filterUsed = () => JobVacancy.find.mock.calls[0][0];

// ---------------------------------------------------------------------------
describe("hybridSearch: parameters and filter", () => {
  test("WB-REC-01 every search first auto-closes active jobs whose deadline has passed (a write on a GET)", async () => {
    jobs([]);
    await search();
    const [cond, update] = JobVacancy.updateMany.mock.calls[0];
    expect(cond).toMatchObject({ status: "active", archived: { $ne: true }, applicationDeadline: { $ne: null, $lt: expect.any(Date) } });
    expect(update.$set).toMatchObject({ status: "closed", closedAt: expect.any(Date) });
  });

  test("WB-REC-02 base filter: active, not closed, not archived; nothing else without params", async () => {
    jobs([]);
    await search();
    expect(filterUsed()).toEqual({ isActive: true, status: { $ne: "closed" }, archived: { $ne: true } });
  });

  test.each([
    [["IT", "BPO"], ["IT", "BPO"]],
    [" IT , BPO ,, ", ["IT", "BPO"]],
    ["IT", ["IT"]],
  ])("WB-REC-03 industry %j becomes $in %j", async (input, list) => {
    jobs([]);
    await search({ industry: input });
    expect(filterUsed().industry).toEqual({ $in: list });
  });

  test("WB-REC-04 an industry value that is only separators adds no filter", async () => {
    jobs([]);
    await search({ industry: " , ," });
    expect(filterUsed()).not.toHaveProperty("industry");
  });

  test("WB-REC-05 workNature, jobType and an escaped case-insensitive location regex", async () => {
    jobs([]);
    await search({ workNature: "remote", jobType: "full-time", location: "Boac (Capital)" });
    expect(filterUsed()).toMatchObject({ workNature: "remote", jobType: "full-time", location: { $regex: "Boac \\(Capital\\)", $options: "i" } });
  });

  test("WB-REC-06 salary range uses OVERLAP semantics and ignores non-numeric values", async () => {
    jobs([]);
    await search({ salaryMin: "20000", salaryMax: "30000" });
    expect(filterUsed()).toMatchObject({ salaryMax: { $ne: null, $gte: 20000 }, salaryMin: { $ne: null, $lte: 30000 } });
    await search({ salaryMin: "abc", salaryMax: "xyz" });
    expect(JobVacancy.find.mock.calls[1][0]).not.toHaveProperty("salaryMax");
    expect(JobVacancy.find.mock.calls[1][0]).not.toHaveProperty("salaryMin");
    await search({ salaryMin: "0" });
    expect(JobVacancy.find.mock.calls[2][0].salaryMax).toEqual({ $ne: null, $gte: 0 });
  });

  test("WB-REC-07 free-text q searches title, description and qualifications (escaped); a matching company adds its jobs", async () => {
    jobs([]);
    await search({ q: "c++ dev" });
    expect(filterUsed().$or).toEqual([
      { title: { $regex: "c\\+\\+ dev", $options: "i" } },
      { description: { $regex: "c\\+\\+ dev", $options: "i" } },
      { "qualifications.value": { $regex: "c\\+\\+ dev", $options: "i" } },
    ]);
    User.find.mockImplementation(() => query(["co1"]));
    await search({ q: "acme" });
    expect(JobVacancy.find.mock.calls[1][0].$or).toContainEqual({ employer: { $in: ["co1"] } });
  });

  test("WB-REC-08 KNOWN-ISSUE: workNature/jobType/location are put into the Mongo filter as-is, so an operator object would be a NoSQL query operator (only the global express-mongo-sanitize middleware prevents it)", async () => {
    jobs([]);
    await search({ workNature: { $ne: "x" } });
    expect(filterUsed().workNature).toEqual({ $ne: "x" });
  });

  test("WB-REC-09 empty result short-circuits with hasSkills false", async () => {
    jobs([]);
    const { body } = await search();
    expect(body).toEqual({ jobs: [], total: 0, hasSkills: false });
    expect(getApplicationCountMap).not.toHaveBeenCalled();
  });

  test.each([
    [{}, 0, 50],
    [{ page: "3", limit: "10" }, 20, 10],
    [{ skip: "7", limit: "10" }, 7, 10],
    [{ skip: "0", page: "5", limit: "10" }, 0, 10],
    [{ skip: "-1", page: "2", limit: "10" }, 10, 10],
    [{ skip: "abc", page: "2", limit: "10" }, 10, 10],
    [{ limit: "0" }, 0, 50],
    [{ limit: "abc", page: "abc" }, 0, 50],
    [{ page: "-4", limit: "-4" }, 0, 1],
  ])("WB-REC-10 paging %j gives skip %i limit %i", async (q, skip, limit) => {
    jobs([job("a")]);
    const { body } = await search(q);
    expect(body).toMatchObject({ skip, limit });
  });

  test("WB-REC-11 KNOWN-ISSUE: `limit` has no upper bound (limit=1000000 is honoured)", async () => {
    jobs([job("a")]);
    expect((await search({ limit: "1000000" })).body.limit).toBe(1000000);
  });
});

// ---------------------------------------------------------------------------
describe("hybridSearch: seeker signal loading", () => {
  const authed = { id: "u1" };

  test("WB-REC-12 guest: no profile, user, follow or application lookups", async () => {
    jobs([job("a")]);
    await search();
    expect(JobseekerProfile.findOne).not.toHaveBeenCalled();
    expect(Follow.find).not.toHaveBeenCalled();
    expect(JobApplication.find).not.toHaveBeenCalled();
  });

  test("WB-REC-13 user id may come from `_id`", async () => {
    jobs([job("a")]);
    await call(rec.hybridSearch, makeReq({ query: {}, user: { _id: "u9" } }));
    expect(JobseekerProfile.findOne).toHaveBeenCalledWith({ userId: "u9" });
  });

  test("WB-REC-14 skills merge profile + user, trimmed and de-duplicated; hasSkills reflects it", async () => {
    jobs([job("a")]);
    JobseekerProfile.findOne.mockImplementation(() => query({ skills: ["Welding", " Cooking ", "", "Welding"] }));
    User.findById.mockImplementation(() => query({ skills: ["Welding", "Driving"] }));
    canPersonalizeRecommendations.mockReturnValue(true);
    semantic.rankJobsBySkills.mockReturnValue({ items: [], total: 0, unfilteredTotal: 0 });
    const { body } = await search({}, authed);
    expect(semantic.rankJobsBySkills.mock.calls[0][1]).toEqual(["Welding", "Cooking", "Driving"]);
    expect(body.hasSkills).toBe(true);
  });

  test("WB-REC-15 non-array skills are ignored; no skills means hasSkills false", async () => {
    jobs([job("a")]);
    JobseekerProfile.findOne.mockImplementation(() => query({ skills: "welding" }));
    User.findById.mockImplementation(() => query({ skills: null }));
    expect((await search({}, authed)).body.hasSkills).toBe(false);
  });

  test("WB-REC-16 preferred industries: the user record wins, then the profile; level defaults to 'flexible'", async () => {
    jobs([job("a")]);
    JobseekerProfile.findOne.mockImplementation(() => query({ preferredIndustries: ["P"] }));
    User.findById.mockImplementation(() => query({ preferredIndustries: ["U"], industryPreferenceLevel: "strict" }));
    let { body } = await search({}, authed);
    expect(body).toMatchObject({ preferredIndustries: ["U"], industryPreferenceLevel: "strict" });
    User.findById.mockImplementation(() => query({}));
    ({ body } = await search({}, authed));
    expect(body).toMatchObject({ preferredIndustries: ["P"], industryPreferenceLevel: "flexible" });
    User.findById.mockImplementation(() => query({ preferredIndustries: "x" }));
    JobseekerProfile.findOne.mockImplementation(() => query({ preferredIndustries: "y" }));
    ({ body } = await search({}, authed));
    expect(body.preferredIndustries).toEqual([]);
  });

  test("WB-REC-17 every optional profile/user field is passed to the ranker with safe defaults (arrays/nulls) when missing", async () => {
    jobs([job("a")]);
    canPersonalizeRecommendations.mockReturnValue(true);
    semantic.rankJobsBySkills.mockReturnValue({ items: [], total: 0, unfilteredTotal: 0 });
    await search({}, authed);
    const opts = semantic.rankJobsBySkills.mock.calls[0][2];
    expect(opts).toMatchObject({
      expectedSalaryMin: null, expectedSalaryMax: null, preferredOccupations: [], workHistory: [], educationalAttainment: null,
      workExperienceBand: null, desiredJobTitle: null, seekerDateOfBirth: null, languageProficiency: null, professionalLicenses: [],
      eligibilities: [], vocationalTrainings: [], course: null, yearGraduated: null, presentAddress: null, preferredWorkLocationLocal: [],
      preferredJobTypes: [], preferredWorkNature: [],
    });
    const full = {
      expectedSalaryMin: 10, expectedSalaryMax: 20, preferredOccupations: ["o"], workHistory: [1], languageProficiency: { en: 1 },
      professionalLicenses: ["l"], eligibilities: ["e"], vocationalTrainings: ["v"], course: "BSIT", yearGraduated: "2020",
      presentAddress: { a: 1 }, preferredWorkLocationLocal: ["x"], preferredJobTypes: ["j"], preferredWorkNature: ["n"],
    };
    JobseekerProfile.findOne.mockImplementation(() => query(full));
    User.findById.mockImplementation(() => query({ educationalAttainment: "College", workExperience: "1-2", desiredJobTitle: "Welder", dateOfBirth: "2000-01-01" }));
    semantic.rankJobsBySkills.mockClear();
    await search({}, authed);
    expect(semantic.rankJobsBySkills.mock.calls[0][2]).toMatchObject({ ...full, educationalAttainment: "College", workExperienceBand: "1-2", desiredJobTitle: "Welder", seekerDateOfBirth: "2000-01-01" });
  });

  test("WB-REC-17b wrongly-typed stored profile values (strings instead of lists) fall back to empty lists", async () => {
    jobs([job("a")]);
    canPersonalizeRecommendations.mockReturnValue(true);
    semantic.rankJobsBySkills.mockReturnValue({ items: [], total: 0, unfilteredTotal: 0 });
    const bad = { preferredOccupations: "x", workHistory: "x", professionalLicenses: "x", eligibilities: "x", vocationalTrainings: "x", preferredWorkLocationLocal: "x", preferredJobTypes: "x", preferredWorkNature: "x" };
    JobseekerProfile.findOne.mockImplementation(() => query(bad));
    await search({}, { id: "u1" });
    expect(semantic.rankJobsBySkills.mock.calls[0][2]).toMatchObject({ preferredOccupations: [], workHistory: [], professionalLicenses: [], eligibilities: [], vocationalTrainings: [], preferredWorkLocationLocal: [], preferredJobTypes: [], preferredWorkNature: [] });
  });

  test("WB-REC-18 a non-finite expected salary is treated as unset", async () => {
    jobs([job("a")]);
    canPersonalizeRecommendations.mockReturnValue(true);
    semantic.rankJobsBySkills.mockReturnValue({ items: [], total: 0, unfilteredTotal: 0 });
    JobseekerProfile.findOne.mockImplementation(() => query({ expectedSalaryMin: "10000", expectedSalaryMax: NaN }));
    await search({}, authed);
    expect(semantic.rankJobsBySkills.mock.calls[0][2]).toMatchObject({ expectedSalaryMin: null, expectedSalaryMax: null });
  });

  test("WB-REC-19 a failing profile lookup is logged and the search still runs; failing follow/application lookups degrade the same way", async () => {
    jobs([job("a")]);
    JobseekerProfile.findOne.mockImplementation(() => failingQuery(dbError()));
    Follow.find.mockImplementation(() => failingQuery(dbError()));
    JobApplication.find.mockImplementation(() => failingQuery(dbError()));
    const r = await search({}, authed);
    expect(r.status).toBe(200);
    expect(r.body.jobs).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith("[Job Board] Error fetching skills/preferences:", expect.anything());
  });

  test("WB-REC-20 jobs the seeker already applied to are hidden; withdrawn applications are NOT counted as applied", async () => {
    jobs([job("a"), job("b")]);
    JobApplication.find.mockImplementation(() => query([{ vacancy: "a" }]));
    const { body } = await search({}, authed);
    expect(body.jobs.map((j) => j._id)).toEqual(["b"]);
    expect(JobApplication.find).toHaveBeenCalledWith({ applicant: "u1", status: { $ne: "withdrawn" } });
  });
});

// ---------------------------------------------------------------------------
describe("hybridSearch: visibility and strict mode", () => {
  test("WB-REC-21 archived, closed and past-deadline jobs are dropped in memory; no/invalid/future deadlines stay", async () => {
    jobs([
      job("ok-none"), job("ok-future", { applicationDeadline: future() }), job("ok-invalid", { applicationDeadline: "not a date" }),
      job("archived", { archived: true }), job("closed", { status: "closed" }), job("expired", { applicationDeadline: past() }),
    ]);
    const { body } = await search();
    expect(body.jobs.map((j) => j._id).sort()).toEqual(["ok-future", "ok-invalid", "ok-none"]);
  });

  test("WB-REC-22 strict industry preference keeps only jobs in a preferred industry (array or string industry; none stays out)", async () => {
    jobs([job("a", { industry: ["IT"] }), job("b", { industry: "BPO" }), job("c", { industry: ["Agri"] }), job("d", {})]);
    User.findById.mockImplementation(() => query({ preferredIndustries: ["IT", "BPO"], industryPreferenceLevel: "strict" }));
    const { body } = await search({}, { id: "u1" });
    expect(body.jobs.map((j) => j._id).sort()).toEqual(["a", "b"]);
  });

  test("WB-REC-23 strict with no preferred industries (or flexible) filters nothing", async () => {
    jobs([job("a", { industry: ["X"] })]);
    User.findById.mockImplementation(() => query({ industryPreferenceLevel: "strict" }));
    expect((await search({}, { id: "u1" })).body.jobs).toHaveLength(1);
    User.findById.mockImplementation(() => query({ preferredIndustries: ["IT"], industryPreferenceLevel: "flexible" }));
    expect((await search({}, { id: "u1" })).body.jobs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe("hybridSearch: ranking", () => {
  test("WB-REC-24 personalised: weights resolved in one batch and the ranker's page/total are used; counts and remaining slots attached", async () => {
    jobs([job("a", { slots: 5 })]);
    canPersonalizeRecommendations.mockReturnValue(true);
    buildWeightsByJobId.mockResolvedValue({ a: { w: 1 } });
    semantic.rankJobsBySkills.mockReturnValue({ items: [{ _id: "a", slots: 5 }, { _id: "b", slots: undefined }], total: 42, unfilteredTotal: 50 });
    getApplicationCountMap.mockResolvedValue({ a: 4 });
    getHiredCountMap.mockResolvedValue({ a: 2, b: 9 });
    Follow.find.mockImplementation(() => query([{ following: "emp1" }]));
    const { body } = await search({ limit: "10", page: "2", sortBy: "salary", onlyMeetsRequired: "true" }, { id: "u1" });
    expect(buildWeightsByJobId).toHaveBeenCalledTimes(1);
    const opts = semantic.rankJobsBySkills.mock.calls[0][2];
    expect(opts).toMatchObject({ limit: 10, skip: 10, sortBy: "salary", onlyMeetsRequired: true, weightsByJobId: { a: { w: 1 } } });
    expect([...opts.followedEmployerIds]).toEqual(["emp1"]);
    expect(body.jobs).toEqual([{ _id: "a", slots: 5, applicationCount: 4, remainingSlots: 3 }, { _id: "b", slots: undefined, applicationCount: 0, remainingSlots: 0 }]);
    expect(body).toMatchObject({ total: 42, unfilteredTotal: 50, pagination: { total: 42, page: 2, pages: 5, limit: 10 } });
  });

  test.each([["newest", "newest"], ["salary", "salary"], ["match", "match"], ["bogus", "match"], [undefined, "match"]])("WB-REC-25 sortBy %p is normalised to %s", async (input, normalized) => {
    jobs([job("a")]);
    canPersonalizeRecommendations.mockReturnValue(true);
    semantic.rankJobsBySkills.mockReturnValue({ items: [], total: 0, unfilteredTotal: 0 });
    await search({ sortBy: input }, { id: "u1" });
    expect(semantic.rankJobsBySkills.mock.calls[0][2].sortBy).toBe(normalized);
  });

  describe("not personalised (bare profile)", () => {
    const m = (percent, extra = {}) => ({ percent, totalMustHaves: 1, metMustHaves: 1, ...extra });
    const scored = (map) => semantic.computeChecklistMatch.mockImplementation((j) => map[j._id]);

    test("WB-REC-26 every job gets a checklist match; ordering is followed employers first, then checklist % (highest first), ties keep newest-first order", async () => {
      jobs([job("a"), job("b", { employer: { _id: "fav" } }), job("c"), job("d")]);
      scored({ a: m(50), b: m(10), c: m(90), d: m(50) });
      Follow.find.mockImplementation(() => query([{ following: "fav" }]));
      const { body } = await search({}, { id: "u1" });
      expect(body.jobs.map((j) => j._id)).toEqual(["b", "c", "a", "d"]);
      expect(body.jobs[0]).toMatchObject({ isFollowedEmployer: true, relevanceScore: 0 });
      expect(buildSeekerForMatching).toHaveBeenCalledTimes(1);
    });

    test("WB-REC-27 employer id may be a bare id; a job with no employer is never 'followed'; a missing checklist sorts last", async () => {
      jobs([job("a", { employer: "fav" }), job("b", { employer: null }), job("c")]);
      scored({ a: m(10), b: undefined, c: m(20) });
      Follow.find.mockImplementation(() => query([{ following: "fav" }]));
      const { body } = await search({}, { id: "u1" });
      expect(body.jobs.map((j) => j._id)).toEqual(["a", "c", "b"]);
    });

    test("WB-REC-28 sortBy=salary: highest max pay first, falling back to min, then 'unknown' last", async () => {
      jobs([job("a", { salaryMax: 20000 }), job("b", { salaryMin: 30000 }), job("c", {}), job("d", { salaryMax: 25000, salaryMin: 1 })]);
      scored({ a: m(1), b: m(1), c: m(1), d: m(1) });
      const { body } = await search({ sortBy: "salary" });
      expect(body.jobs.map((j) => j._id)).toEqual(["b", "d", "a", "c"]);
    });

    test("WB-REC-29 onlyMeetsRequired keeps jobs with no must-haves or all must-haves met; drops partial, disqualified and unscored; total narrows, unfilteredTotal does not", async () => {
      jobs([job("none"), job("all"), job("partial"), job("dq"), job("unscored")]);
      scored({
        none: m(1, { totalMustHaves: 0, metMustHaves: 0 }), all: m(1, { totalMustHaves: 2, metMustHaves: 2 }),
        partial: m(1, { totalMustHaves: 2, metMustHaves: 1 }), dq: m(1, { disqualified: true }), unscored: null,
      });
      const { body } = await search({ onlyMeetsRequired: "true" });
      expect(body.jobs.map((j) => j._id).sort()).toEqual(["all", "none"]);
      expect(body).toMatchObject({ total: 2, unfilteredTotal: 5 });
      const off = await search({ onlyMeetsRequired: "false" });
      expect(off.body.total).toBe(off.body.unfilteredTotal);
    });

    test("WB-REC-30 paging slices the sorted list; counts/remaining slots attach to each job", async () => {
      jobs([job("a", { slots: 2 }), job("b"), job("c")]);
      scored({ a: m(30), b: m(20), c: m(10) });
      getApplicationCountMap.mockResolvedValue({ b: 7 });
      getHiredCountMap.mockResolvedValue({ b: 1 });
      const { body } = await search({ limit: "1", skip: "1" });
      expect(body.jobs).toHaveLength(1);
      expect(body.jobs[0]).toMatchObject({ _id: "b", applicationCount: 7, remainingSlots: 2 });
      expect(body.pagination).toMatchObject({ total: 3, pages: 3, limit: 1 });
    });
  });

  test("WB-REC-31 any failure is a generic 500", async () => {
    JobVacancy.updateMany.mockRejectedValue(dbError());
    const r = await search();
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ message: "Server error during job search" });
  });
});

// ---------------------------------------------------------------------------
describe("getRankedApplicants (employer)", () => {
  const OWNER = { id: "emp1", role: "employer" };
  const run = (q = {}, user = OWNER) => call(empRec.getRankedApplicants, makeReq({ params: { jobId: "j1" }, query: q, user }));
  const wireJob = (employer = { _id: "emp1" }) => JobVacancy.findById.mockImplementation(() => query({ _id: "j1", employer }));
  const app = (id, applicant, o = {}) => ({ _id: id, applicant, vacancy: "j1", status: "pending", createdAt: "c", ...o });
  const ranked = (items, extra = {}) => semantic.rankApplicantsByJob.mockReturnValue({ items, total: items.length, filteredTotal: items.length, disqualifiedCount: 0, ...extra });
  const wireApps = (apps, profiles = []) => {
    JobApplication.find.mockImplementation(() => query(apps));
    JobseekerProfile.find.mockImplementation(() => query(profiles));
    resolveJobWeightsForScoring.mockResolvedValue({ w: 1 });
  };

  test("WB-REC-32 unknown job 404; not the owner 403 (employer object or bare id; admins are not special-cased)", async () => {
    JobVacancy.findById.mockImplementation(() => query(null));
    expect((await run()).status).toBe(404);
    wireJob({ _id: "someone-else" });
    expect((await run()).status).toBe(403);
    wireJob("someone-else");
    expect((await run()).status).toBe(403);
    wireJob("emp1");
    wireApps([]);
    expect((await run()).status).toBe(200);
    wireJob({ _id: "emp1" });
    expect((await run({}, { id: "admin1", role: "admin" })).status).toBe(403);
  });

  test("WB-REC-33 withdrawn applications are excluded by the query; suspended/deleted applicants are dropped; nothing left gives the empty answer", async () => {
    wireJob();
    wireApps([app("a1", { _id: "x", isActive: false }), app("a2", null)]);
    const { body } = await run();
    expect(JobApplication.find).toHaveBeenCalledWith({ vacancy: "j1", status: { $ne: "withdrawn" } });
    expect(body).toEqual({ applicants: [], total: 0, filteredTotal: 0, disqualifiedCount: 0 });
    expect(JobseekerProfile.find).not.toHaveBeenCalled();
  });

  test.each([
    ["mustHaves", "mustHaves"], ["date", "date"], ["name", "name"], ["match", "match"], ["junk", "match"], [undefined, "match"],
  ])("WB-REC-34 sortBy %p is normalised to %s", async (input, normalized) => {
    wireJob();
    wireApps([app("a1", { _id: "x" })]);
    ranked([]);
    await run({ sortBy: input });
    expect(semantic.rankApplicantsByJob.mock.calls[0][2].sortBy).toBe(normalized);
  });

  test.each([["true", true], [true, true], ["false", false], ["1", false], [undefined, false]])("WB-REC-35 onlyMeetsRequired %p gives %p; limit/skip are numbers (default 50/0)", async (input, flag) => {
    wireJob();
    wireApps([app("a1", { _id: "x" })]);
    ranked([]);
    await run({ onlyMeetsRequired: input });
    expect(semantic.rankApplicantsByJob.mock.calls[0][2]).toMatchObject({ onlyMeetsRequired: flag, limit: 50, skip: 0, weights: { w: 1 } });
  });

  test("WB-REC-36 KNOWN-ISSUE: limit/skip are passed as Number(...) with no bounds or NaN guard (limit=abc becomes NaN, a huge limit is honoured)", async () => {
    wireJob();
    wireApps([app("a1", { _id: "x" })]);
    ranked([]);
    await run({ limit: "abc", skip: "-5" });
    const opts = semantic.rankApplicantsByJob.mock.calls[0][2];
    expect(Number.isNaN(opts.limit)).toBe(true);
    expect(opts.skip).toBe(-5);
    await run({ limit: "100000000" });
    expect(semantic.rankApplicantsByJob.mock.calls[1][2].limit).toBe(100000000);
  });

  test("WB-REC-37 applicant skills are merged from profile and user, case-insensitively de-duplicated; every profile field defaults safely when no profile exists", async () => {
    wireJob();
    wireApps([app("a1", { _id: "x", skills: ["welding", "Driving"], workExperience: "", educationalAttainment: undefined })], [{ userId: "x", skills: ["Welding", "Cooking"] }]);
    ranked([]);
    await run();
    const forRanking = semantic.rankApplicantsByJob.mock.calls[0][1][0];
    expect(forRanking.profile.skills).toEqual(["Welding", "Cooking", "welding", "Driving"].filter((s, i, a) => a.findIndex((t) => t.toLowerCase() === s.toLowerCase()) === i));
    expect(forRanking.profile).toMatchObject({ workExperience: "", educationalAttainment: "", expectedSalaryMin: null, expectedSalaryMax: null, preferredIndustries: [], languageProficiency: null, presentAddress: null, course: null });
    expect(JobseekerProfile.find).toHaveBeenCalledWith({ userId: { $in: ["x"] } });
  });

  test("WB-REC-38 a stored profile's typed fields are passed through (numbers only if finite, objects only if objects)", async () => {
    wireJob();
    wireApps([app("a1", { _id: "x" })], [{ userId: "x", expectedSalaryMin: 10, expectedSalaryMax: "20", preferredIndustries: ["i"], course: "BSIT", yearGraduated: "2020", presentAddress: { a: 1 }, languageProficiency: { en: 1 }, workHistory: [1] }]);
    ranked([]);
    await run();
    expect(semantic.rankApplicantsByJob.mock.calls[0][1][0].profile).toMatchObject({ expectedSalaryMin: 10, expectedSalaryMax: null, preferredIndustries: ["i"], course: "BSIT", yearGraduated: "2020", presentAddress: { a: 1 }, languageProficiency: { en: 1 }, workHistory: [1] });
    wireApps([app("a1", { _id: "x" })], [{ userId: "x", presentAddress: "a string" }]);
    await run();
    expect(semantic.rankApplicantsByJob.mock.calls[1][1][0].profile.presentAddress).toBeNull();
  });

  test("WB-REC-38b wrongly-typed stored profile values (strings instead of lists) fall back to empty lists for the employer view too", async () => {
    wireJob();
    const bad = { userId: "x", skills: "x", preferredIndustries: "x", preferredOccupations: "x", workHistory: "x", vocationalTrainings: "x", eligibilities: "x", professionalLicenses: "x", preferredWorkLocationLocal: "x", preferredJobTypes: "x", preferredWorkNature: "x" };
    wireApps([app("a1", { _id: "x", skills: "also-bad" })], [bad]);
    ranked([]);
    await run();
    expect(semantic.rankApplicantsByJob.mock.calls[0][1][0].profile).toMatchObject({
      skills: [], preferredIndustries: [], preferredOccupations: [], workHistory: [], vocationalTrainings: [], eligibilities: [],
      professionalLicenses: [], preferredWorkLocationLocal: [], preferredJobTypes: [], preferredWorkNature: [],
    });
  });

  test("WB-REC-39 visible profile: contact info plus skills/experience/education; response carries ranking metadata with defaults", async () => {
    wireJob();
    const user = { _id: "x", name: "Ann", email: "a@x", phone: "09", workExperience: "1-2", educationalAttainment: "College" };
    wireApps([app("a1", user)]);
    ranked([{ _id: "a1", user, profile: { skills: ["s"] }, vacancy: "j1", status: "pending", createdAt: "c", relevanceScore: 80 }], { total: 9, filteredTotal: 4, disqualifiedCount: 2 });
    const { body } = await run({ limit: "5", skip: "10" });
    expect(body.applicants[0]).toEqual({
      _id: "a1", applicant: { _id: "x", name: "Ann", email: "a@x", phone: "09", skills: ["s"], workExperience: "1-2", educationalAttainment: "College" },
      vacancy: "j1", status: "pending", appliedAt: "c", employerNote: undefined, resume: undefined, interview: null, relevanceScore: 80,
      matchBreakdown: null, checklistMatch: null, disqualified: null,
    });
    expect(body).toMatchObject({ total: 9, filteredTotal: 4, disqualifiedCount: 2, limit: 5, skip: 10 });
  });

  test("WB-REC-40 hidden profile: only name and contact details; the photo only when the applicant opted to include it", async () => {
    wireJob();
    const hidden = { _id: "x", name: "Ann", email: "a@x", phone: "09", profileImage: "p.png", workExperience: "secret", privacy: { profileVisibility: "hidden" } };
    wireApps([app("a1", hidden)]);
    const item = (o = {}) => ({ _id: "a1", user: hidden, profile: { skills: ["s"] }, ...o });
    ranked([item(), item({ includePhoto: true }), item({ includePhoto: true, user: { ...hidden, profileImage: undefined } })]);
    const { body } = await run();
    expect(body.applicants[0].applicant).toEqual({ _id: "x", name: "Ann", email: "a@x", phone: "09" });
    expect(body.applicants[1].applicant).toEqual({ _id: "x", name: "Ann", email: "a@x", phone: "09", profileImage: "p.png" });
    expect(body.applicants[2].applicant.profileImage).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  test("WB-REC-41 appliedAt falls back to appliedAt when createdAt is missing; interview/matchBreakdown/checklist/disqualified pass through when present", async () => {
    wireJob();
    const user = { _id: "x", name: "A" };
    wireApps([app("a1", user)]);
    ranked([{ _id: "a1", user, profile: {}, appliedAt: "applied", interview: { mode: "online" }, matchBreakdown: { s: 1 }, checklistMatch: { p: 1 }, disqualified: { why: "age" }, employerNote: "n", resume: "r.pdf" }]);
    const a = (await run()).body.applicants[0];
    expect(a).toMatchObject({ appliedAt: "applied", interview: { mode: "online" }, matchBreakdown: { s: 1 }, checklistMatch: { p: 1 }, disqualified: { why: "age" }, employerNote: "n", resume: "r.pdf" });
  });

  test("WB-REC-42 failure is a generic 500", async () => {
    JobVacancy.findById.mockImplementation(() => failingQuery(dbError()));
    const r = await run();
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ message: "Failed to fetch ranked applicants" });
  });
});
