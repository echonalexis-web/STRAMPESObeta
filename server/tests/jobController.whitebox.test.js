// White-box branch coverage for server/controllers/jobController.js.
// Tests tagged KNOWN-ISSUE pin CURRENT behaviour that looks like a defect (see
// docs/WHITE_BOX_TEST_REPORT.md).

jest.mock("../models/JobVacancy", () => ({ find: jest.fn(), findById: jest.fn(), updateOne: jest.fn() }));
jest.mock("../models/JobApplication", () => ({
  find: jest.fn(), findById: jest.fn(), findOne: jest.fn(), create: jest.fn(), countDocuments: jest.fn(),
  aggregate: jest.fn(), startSession: jest.fn(),
}));
jest.mock("../models/JobseekerDocument", () => ({ findOne: jest.fn() }));
jest.mock("../models/JobseekerProfile", () => ({ findOne: jest.fn() }));
jest.mock("../models/User", () => ({ findById: jest.fn(), find: jest.fn() }));
jest.mock("../models/Message", () => ({ exists: jest.fn(), create: jest.fn() }));
jest.mock("../models/EmployerProfile", () => ({ find: jest.fn(), findOne: jest.fn() }));
jest.mock("../services/semanticService", () => ({
  computeChecklistMatch: jest.fn(), computeUnifiedScore: jest.fn(), applicantIndustryPreferenceScore: jest.fn(),
}));
jest.mock("../services/matchProfileService", () => ({
  SEEKER_USER_FIELDS: "uf", SEEKER_PROFILE_FIELDS: "pf", buildSeekerForMatching: jest.fn(),
}));
jest.mock("../services/matchWeightsService", () => ({ resolveJobWeightsForScoring: jest.fn() }));
jest.mock("../controllers/messageController", () => ({ ensureConversationBetweenUsers: jest.fn() }));
jest.mock("../utils/ageAccess", () => ({ getAgeDenial: jest.fn(), sendAgeDenial: jest.fn() }));
jest.mock("../utils/jobDisplay", () => ({ getHomepageJobsPayload: jest.fn(), getApplicationCountMap: jest.fn(), getHiredCountMap: jest.fn() }));
jest.mock("../services/profileProjection", () => ({ scrubEmployerForJobPayload: jest.fn() }));
jest.mock("../services/bannerTemplateService", () => ({ resolveCover: jest.fn() }));
jest.mock("../services/notificationService", () => ({ createNotificationForUser: jest.fn() }));
jest.mock("../services/storageService", () => ({ remove: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn() }));
jest.mock("../utils/jobVisibility", () => ({
  isJobVisibleToJobseekers: jest.fn(),
  isEmployerUnlisted: jest.requireActual("../utils/jobVisibility").isEmployerUnlisted,
}));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const JobseekerDocument = require("../models/JobseekerDocument");
const JobseekerProfile = require("../models/JobseekerProfile");
const User = require("../models/User");
const Message = require("../models/Message");
const EmployerProfile = require("../models/EmployerProfile");
const semantic = require("../services/semanticService");
const { buildSeekerForMatching } = require("../services/matchProfileService");
const { resolveJobWeightsForScoring } = require("../services/matchWeightsService");
const { ensureConversationBetweenUsers } = require("../controllers/messageController");
const { getAgeDenial, sendAgeDenial } = require("../utils/ageAccess");
const { getHomepageJobsPayload, getApplicationCountMap, getHiredCountMap } = require("../utils/jobDisplay");
const { scrubEmployerForJobPayload } = require("../services/profileProjection");
const { resolveCover } = require("../services/bannerTemplateService");
const { createNotificationForUser } = require("../services/notificationService");
const storage = require("../services/storageService");
const { logAuditEvent } = require("../services/auditService");
const { isJobVisibleToJobseekers } = require("../utils/jobVisibility");
const logger = require("../utils/logger");
const c = require("../controllers/jobController");
const { makeReq, makeRes, query, failingQuery, call } = require("../testUtils/httpMocks");

const U = "a".repeat(24); // the acting user
const E = "e".repeat(24); // an employer
const J = "1".repeat(24); // a job
const DOC = "d".repeat(24);

const flush = () => new Promise((r) => setImmediate(r));
const userReq = (o = {}) => makeReq({ user: { id: U, _id: U, role: "jobseeker" }, ...o });
const dbError = () => new Error("secret db internals");

beforeEach(() => {
  jest.resetAllMocks();
  isJobVisibleToJobseekers.mockReturnValue(true);
  getApplicationCountMap.mockResolvedValue({});
  getHiredCountMap.mockResolvedValue({});
  scrubEmployerForJobPayload.mockImplementation((e) => e);
  resolveCover.mockResolvedValue("cover");
  createNotificationForUser.mockResolvedValue();
  logAuditEvent.mockResolvedValue();
  storage.remove.mockResolvedValue();
  getAgeDenial.mockReturnValue(null);
  JobVacancy.updateOne.mockResolvedValue();
  delete process.env.NODE_ENV_BACKUP;
});

// A mongoose-document-like object.
const doc = (o = {}) => {
  const d = { save: jest.fn().mockResolvedValue(), ...o };
  d.toObject = jest.fn(() => ({ ...o }));
  d.set = jest.fn((patch) => Object.assign(d, patch));
  return d;
};

// ---------------------------------------------------------------------------
describe("buildArchivedJobSnapshot", () => {
  test("WB-JOB-01 empty input: zero counts, names fall back to sequential ids, archivedAt falls back to now", () => {
    const s = c.buildArchivedJobSnapshot({});
    expect(s).toMatchObject({ totalApplicants: 0, qualifiedCount: 0, shortlistedCount: 0, hiredCount: 0, hiredCandidateIds: [], hiredCandidateNames: [], qualifiedRate: 0, shortlistedRate: 0, hireRate: 0, archiveReason: null });
    expect(s.archivedAt).toBeInstanceOf(Date);
    expect(s.daysActive).toBe(0);
  });

  test("WB-JOB-02 rates are percentages rounded to 2 decimals; zero applicants gives 0 (no divide by zero)", () => {
    const s = c.buildArchivedJobSnapshot({}, { totalApplicants: 3, qualifiedCount: 1, shortlistedCount: 2, hiredIds: ["a"] });
    expect(s).toMatchObject({ qualifiedRate: 33.33, shortlistedRate: 66.67, hireRate: 33.33 });
    expect(c.buildArchivedJobSnapshot({}, { totalApplicants: 0, hiredIds: ["a"] }).hireRate).toBe(0);
  });

  test("WB-JOB-03 hired ids are stringified, falsy removed; names default to sequential ids when none are given", () => {
    const s = c.buildArchivedJobSnapshot({}, { hiredIds: [11, null, "x"], hiredCandidateNames: [] });
    expect(s.hiredCount).toBe(2);
    expect(s.hiredCandidateIds).toEqual(["1", "2"]);
    expect(s.hiredCandidateNames).toEqual(["1", "2"]);
    expect(c.buildArchivedJobSnapshot({}, { hiredIds: ["a"], hiredCandidateNames: ["Ana", "", null] }).hiredCandidateNames).toEqual(["Ana"]);
  });

  test("WB-JOB-04 non-array hiredIds/hiredCandidateNames are ignored", () => {
    const s = c.buildArchivedJobSnapshot({}, { hiredIds: "abc", hiredCandidateNames: "Ana" });
    expect(s.hiredCount).toBe(0);
    expect(s.hiredCandidateNames).toEqual([]);
  });

  test("WB-JOB-05 KNOWN-ISSUE: duplicate hired ids are counted in hiredCount but de-duplicated in hiredCandidateIds", () => {
    const s = c.buildArchivedJobSnapshot({}, { hiredIds: ["a", "a"], totalApplicants: 2 });
    expect(s.hiredCount).toBe(2);
    expect(s.hiredCandidateIds).toEqual(["1"]);
  });

  test("WB-JOB-06 archivedAt precedence: metrics, then job.archivedAt, then job.closedAt", () => {
    const m = c.buildArchivedJobSnapshot({ archivedAt: "2026-02-01" }, { archivedAt: "2026-03-01" });
    expect(m.archivedAt.toISOString()).toBe(new Date("2026-03-01").toISOString());
    expect(c.buildArchivedJobSnapshot({ archivedAt: "2026-02-01", closedAt: "2026-01-01" }).archivedAt.toISOString()).toBe(new Date("2026-02-01").toISOString());
    expect(c.buildArchivedJobSnapshot({ closedAt: "2026-01-01" }).archivedAt.toISOString()).toBe(new Date("2026-01-01").toISOString());
  });

  test("WB-JOB-07 closedAt defaults to archivedAt; daysActive rounds up and is never negative", () => {
    const s = c.buildArchivedJobSnapshot({ createdAt: "2026-01-01T00:00:00Z" }, { archivedAt: "2026-01-11T01:00:00Z" });
    expect(s.daysActive).toBe(11);
    expect(s.closedAt.toISOString()).toBe(s.archivedAt.toISOString());
    expect(c.buildArchivedJobSnapshot({ createdAt: "2026-02-01" }, { archivedAt: "2026-01-01" }).daysActive).toBe(0);
    expect(c.buildArchivedJobSnapshot({ createdAt: "2026-01-01", closedAt: "2026-01-05" }, { archivedAt: "2026-01-11" }).closedAt.toISOString()).toBe(new Date("2026-01-05").toISOString());
  });

  test("WB-JOB-08 archiveReason precedence: metrics, then job, then null", () => {
    expect(c.buildArchivedJobSnapshot({ archiveReason: "j" }, { archiveReason: "m" }).archiveReason).toBe("m");
    expect(c.buildArchivedJobSnapshot({ archiveReason: "j" }).archiveReason).toBe("j");
  });
});

// ---------------------------------------------------------------------------
describe("getJobs and getHomepageJobs", () => {
  const mkJob = (id, employer = { _id: E, isActive: true, name: "Emp" }, extra = {}) => {
    const obj = { _id: id, employer: employer && { ...employer }, slots: 5, qualifications: [{ value: "b", order: 2 }, { value: "a", order: 1 }, { value: "" }, null], ...extra };
    return { _id: id, employer, toObject: () => obj };
  };

  describe("getJobs", () => {
    const wire = (jobs, profiles = []) => {
      JobVacancy.find.mockReturnValue(query(jobs));
      EmployerProfile.find.mockReturnValue(Promise.resolve(profiles));
    };

    test("WB-JOB-09 filters invisible jobs and jobs whose employer is missing or inactive", async () => {
      isJobVisibleToJobseekers.mockImplementation((j) => j._id !== "hidden");
      wire([mkJob("ok"), mkJob("hidden"), mkJob("noemp", null), mkJob("susp", { _id: E, isActive: false }), mkJob("unset", { _id: E })]);
      const { body } = await call(c.getJobs, makeReq({ user: null }));
      expect(body.map((j) => j._id)).toEqual(["ok", "unset"]);
    });

    test("WB-JOB-10 a jobseeker does not see jobs they were hired into; other roles and guests skip that lookup", async () => {
      wire([mkJob("a"), mkJob("b")]);
      JobApplication.find.mockReturnValue(query([{ vacancy: "a" }]));
      const { body } = await call(c.getJobs, userReq());
      expect(body.map((j) => j._id)).toEqual(["b"]);
      expect(JobApplication.find).toHaveBeenCalledWith({ applicant: U, status: { $in: ["hired", "Accepted"] } });
      JobApplication.find.mockClear();
      wire([mkJob("a")]);
      await call(c.getJobs, makeReq({ user: { id: U, role: "employer" } }));
      await call(c.getJobs, makeReq({ user: null }));
      expect(JobApplication.find).not.toHaveBeenCalled();
    });

    test("WB-JOB-11 attaches employer profile, counts, remaining slots, sorted qualifications and resolved cover", async () => {
      wire([mkJob("a")], [{ userId: E, bio: "p" }]);
      getApplicationCountMap.mockResolvedValue({ a: 3 });
      getHiredCountMap.mockResolvedValue({ a: 2 });
      const { body } = await call(c.getJobs, makeReq({ user: null }));
      expect(body[0].employer.profile).toEqual({ userId: E, bio: "p" });
      expect(body[0].employer.cover).toBe("cover");
      expect(body[0]).toMatchObject({ applicationCount: 3, remainingSlots: 3 });
      expect(body[0].qualifications.map((q) => q.value)).toEqual(["a", "b"]);
      expect(scrubEmployerForJobPayload).toHaveBeenCalledWith(expect.anything(), null);
    });

    test("WB-JOB-12 remaining slots never go negative; missing counts default to 0; missing qualifications become []", async () => {
      wire([mkJob("a", undefined, { slots: 1, qualifications: undefined })]);
      getHiredCountMap.mockResolvedValue({ a: 4 });
      const { body } = await call(c.getJobs, makeReq({ user: null }));
      expect(body[0]).toMatchObject({ remainingSlots: 0, applicationCount: 0, qualifications: [] });
    });

    test("WB-JOB-13 the signed-in user is passed to the employer scrub", async () => {
      wire([mkJob("a")]);
      const req = userReq();
      JobApplication.find.mockReturnValue(query([]));
      await call(c.getJobs, req);
      expect(scrubEmployerForJobPayload).toHaveBeenCalledWith(expect.anything(), req.user);
    });

    test("WB-JOB-14 empty list and DB failure", async () => {
      wire([]);
      expect((await call(c.getJobs, makeReq({ user: null }))).body).toEqual([]);
      JobVacancy.find.mockReturnValue(failingQuery(dbError()));
      const r = await call(c.getJobs, makeReq({ user: null }));
      expect(r.status).toBe(500);
      expect(r.body).toEqual({ message: "Failed to fetch jobs" });
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("getHomepageJobs", () => {
    const wire = (jobs, profiles = []) => {
      JobVacancy.find.mockReturnValue(query(jobs));
      EmployerProfile.find.mockReturnValue(Promise.resolve(profiles));
      getHomepageJobsPayload.mockImplementation(async (list) => list);
    };

    test("WB-JOB-15 same filtering as getJobs; always scrubs as an unauthenticated viewer", async () => {
      wire([mkJob("ok"), mkJob("noemp", null), mkJob("susp", { _id: E, isActive: false })]);
      JobApplication.find.mockReturnValue(query([]));
      const { body } = await call(c.getHomepageJobs, userReq());
      expect(body.map((j) => j._id)).toEqual(["ok"]);
      expect(scrubEmployerForJobPayload).toHaveBeenCalledWith(expect.anything(), null);
      expect(getHomepageJobsPayload).toHaveBeenCalledWith(expect.any(Array), 4);
    });

    test("WB-JOB-16 jobseeker hired-job filter, profile attach and qualification sort", async () => {
      wire([mkJob("a"), mkJob("b")], [{ userId: E }]);
      JobApplication.find.mockReturnValue(query([{ vacancy: "a" }]));
      const { body } = await call(c.getHomepageJobs, userReq());
      expect(body.map((j) => j._id)).toEqual(["b"]);
      expect(body[0].employer.profile).toEqual({ userId: E });
      expect(body[0].qualifications.map((q) => q.value)).toEqual(["a", "b"]);
    });

    test("WB-JOB-17 guest or non-jobseeker skips the hired lookup", async () => {
      wire([mkJob("a")]);
      await call(c.getHomepageJobs, makeReq({ user: null }));
      expect(JobApplication.find).not.toHaveBeenCalled();
    });

    test("WB-JOB-18 DB failure is a generic 500", async () => {
      JobVacancy.find.mockReturnValue(failingQuery(dbError()));
      const r = await call(c.getHomepageJobs, makeReq({ user: null }));
      expect(r.status).toBe(500);
      expect(r.body).toEqual({ message: "Failed to fetch featured jobs" });
    });
  });
});

// ---------------------------------------------------------------------------
describe("getJobById", () => {
  const mkJob = (o = {}) => {
    const obj = { _id: J, slots: 3, qualifications: [{ value: "x" }], employer: { _id: E, isActive: true, cover: "raw" }, ...o.obj };
    return { _id: J, title: "Welder", employer: obj.employer, toObject: () => obj, ...o.doc };
  };
  const run = (user, id = J) => call(c.getJobById, makeReq({ params: { id }, user }));
  const wire = (job) => JobVacancy.findById.mockReturnValue(query(job));

  beforeEach(() => {
    EmployerProfile.findOne.mockResolvedValue(null);
  });

  test("WB-JOB-19 unknown job is 404", async () => {
    wire(null);
    expect((await run(null)).status).toBe(404);
  });

  test("WB-JOB-20 suspended employer: 404 identical to a missing job for guests and jobseekers (no title), visible to admin and to the owner", async () => {
    const suspended = () => mkJob({ obj: { employer: { _id: E, isActive: false } }, doc: { employer: { _id: E, isActive: false } } });
    wire(suspended());
    const pub = await run(null);
    expect(pub.status).toBe(404);
    expect(pub.body).toEqual({ message: "Job not found" });
    wire(suspended());
    expect((await run({ id: U, role: "jobseeker" })).status).toBe(404);
    wire(suspended());
    expect((await run({ id: U, role: "admin" })).status).toBe(200);
    wire(suspended());
    expect((await run({ id: E, role: "employer" })).status).toBe(200);
  });

  test("WB-JOB-21 guest view: employer profile attached, scrubbed, cover resolved, counts and slots computed", async () => {
    wire(mkJob());
    EmployerProfile.findOne.mockResolvedValue({ p: 1 });
    getApplicationCountMap.mockResolvedValue({ [J]: 4 });
    getHiredCountMap.mockResolvedValue({ [J]: 1 });
    const { body } = await run(null);
    expect(body.employer.profile).toEqual({ p: 1 });
    expect(body.employer.cover).toBe("cover");
    expect(resolveCover).toHaveBeenCalledWith("raw");
    expect(body).toMatchObject({ applicationCount: 4, remainingSlots: 2 });
    expect(semantic.computeChecklistMatch).not.toHaveBeenCalled();
  });

  test("WB-JOB-22 a job with no employer object skips the profile and scrub steps", async () => {
    wire(mkJob({ obj: { employer: null }, doc: { employer: null } }));
    const { body, status } = await run(null);
    expect(status).toBe(200);
    expect(EmployerProfile.findOne).not.toHaveBeenCalled();
    expect(body.employer).toBeNull();
  });

  describe.each(["jobseeker", "employee", "resident"])("match panel for role %s", (role) => {
    const wireMatch = (unified) => {
      User.findById.mockReturnValue(query({ u: 1 }));
      JobseekerProfile.findOne.mockReturnValue(query({ p: 1 }));
      buildSeekerForMatching.mockReturnValue({ user: { industryPreferenceLevel: "high" }, profile: { preferredIndustries: ["IT"] } });
      semantic.computeChecklistMatch.mockReturnValue({ met: 1 });
      resolveJobWeightsForScoring.mockResolvedValue({ w: 1 });
      semantic.applicantIndustryPreferenceScore.mockReturnValue(0.5);
      semantic.computeUnifiedScore.mockReturnValue(unified);
    };

    test("WB-JOB-23 attaches checklist, relevance score and breakdown", async () => {
      wire(mkJob());
      wireMatch({ score: 77, coverage: 0.8, breakdown: { skills: 1 } });
      const { body } = await run({ id: U, role });
      expect(body).toMatchObject({ checklistMatch: { met: 1 }, relevanceScore: 77, matchBreakdown: { coverage: 0.8, skills: 1 } });
      expect(body.disqualified).toBeUndefined();
      expect(semantic.computeUnifiedScore).toHaveBeenCalledWith(expect.anything(), expect.anything(), 0.5, { w: 1 });
    });

    test("WB-JOB-24 disqualified flag is copied when present; a null unified score adds nothing", async () => {
      wire(mkJob());
      wireMatch({ score: 0, coverage: 0, breakdown: {}, disqualified: { reason: "age" } });
      expect((await run({ id: U, role })).body.disqualified).toEqual({ reason: "age" });
      wire(mkJob());
      wireMatch(null);
      const { body } = await run({ id: U, role });
      expect(body.relevanceScore).toBeUndefined();
      expect(body.checklistMatch).toEqual({ met: 1 });
    });

    test("WB-JOB-25 a failure while scoring is swallowed and the job is still returned", async () => {
      wire(mkJob());
      wireMatch({});
      User.findById.mockReturnValue(failingQuery(dbError()));
      const { status, body } = await run({ id: U, role });
      expect(status).toBe(200);
      expect(body.relevanceScore).toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith("Checklist match error:", expect.objectContaining({ jobId: J }));
    });
  });

  test("WB-JOB-26 employer and admin viewers get no match panel", async () => {
    wire(mkJob());
    await run({ id: E, role: "employer" });
    wire(mkJob());
    await run({ id: U, role: "admin" });
    expect(User.findById).not.toHaveBeenCalled();
  });

  test("WB-JOB-27 DB failure is a generic 500", async () => {
    JobVacancy.findById.mockReturnValue(failingQuery(dbError()));
    const r = await run(null);
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ message: "Failed to fetch job details" });
  });
});

// ---------------------------------------------------------------------------
describe("applyToJob", () => {
  const mkSession = (inTransaction = true) => ({
    startTransaction: jest.fn(),
    abortTransaction: jest.fn().mockResolvedValue(),
    commitTransaction: jest.fn().mockResolvedValue(),
    endSession: jest.fn().mockResolvedValue(),
    inTransaction: jest.fn().mockReturnValue(inTransaction),
  });
  const openJob = (o = {}) => ({ _id: J, status: "active", employer: E, title: "Welder", ...o });
  const upload = (v) => ({ storedValue: v });
  const NEW_APP = { _id: "app1" };
  let sess;

  const run = (reqOver = {}) => {
    const req = userReq({ params: { id: J }, body: {}, ...reqOver });
    return call(c.applyToJob, req).then((r) => ({ ...r, req }));
  };
  const happy = (job = openJob(), existing = null) => {
    JobVacancy.findById.mockResolvedValue(job);
    User.findById.mockReturnValue(query({ isActive: true }));
    sess = mkSession();
    JobApplication.startSession.mockResolvedValue(sess);
    JobApplication.findOne.mockReturnValue(query(existing));
    JobApplication.create.mockResolvedValue([NEW_APP]);
  };
  const files = { resume: [upload("r.pdf")], coverLetterFile: [upload("c.pdf")] };

  test("WB-JOB-28 age denial short-circuits before any DB access", async () => {
    getAgeDenial.mockReturnValue({ code: "AGE" });
    await run();
    expect(sendAgeDenial).toHaveBeenCalledWith(expect.anything(), { code: "AGE" });
    expect(JobVacancy.findById).not.toHaveBeenCalled();
    expect(JobApplication.startSession).not.toHaveBeenCalled();
  });

  test("WB-JOB-29 unknown job 404", async () => {
    JobVacancy.findById.mockResolvedValue(null);
    expect((await run()).status).toBe(404);
  });

  test.each([
    ["not active", openJob({ status: "closed" }), true],
    ["not visible", openJob(), false],
  ])("WB-JOB-30 job %s is 400", async (_n, job, visible) => {
    JobVacancy.findById.mockResolvedValue(job);
    isJobVisibleToJobseekers.mockReturnValue(visible);
    const r = await run();
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/no longer accepting/);
  });

  test.each([
    ["job has no employer", openJob({ employer: null }), undefined],
    ["employer row deleted", openJob(), null],
    ["employer suspended", openJob(), { isActive: false }],
  ])("WB-JOB-31 %s is 400", async (_n, job, employer) => {
    JobVacancy.findById.mockResolvedValue(job);
    User.findById.mockReturnValue(query(employer));
    expect((await run()).status).toBe(400);
    expect(JobApplication.startSession).not.toHaveBeenCalled();
  });

  test("WB-JOB-32 already applied (not withdrawn) aborts the transaction with 400", async () => {
    happy(openJob(), { status: "pending" });
    const r = await run({ files });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("You have already applied to this job");
    expect(sess.abortTransaction).toHaveBeenCalled();
    expect(sess.endSession).toHaveBeenCalled();
    expect(JobApplication.create).not.toHaveBeenCalled();
  });

  test("WB-JOB-33 no resume (no upload, no valid library doc) is 400; invalid or unowned document ids count as none", async () => {
    happy();
    let r = await run({ files: { coverLetterFile: [upload("c.pdf")] } });
    expect(r.body.message).toBe("Please attach your resume before applying.");
    expect(JobseekerDocument.findOne).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "resume" }));
    happy();
    JobseekerDocument.findOne.mockResolvedValue(null);
    r = await run({ body: { resumeDocumentId: DOC }, files: { coverLetterFile: [upload("c.pdf")] } });
    expect(r.status).toBe(400);
    expect(JobseekerDocument.findOne).toHaveBeenCalledWith({ _id: DOC, owner: U, kind: "resume" });
    happy();
    r = await run({ body: { resumeDocumentId: "not-an-id" }, files: { coverLetterFile: [upload("c.pdf")] } });
    expect(r.status).toBe(400);
  });

  test("WB-JOB-34 no cover letter is 400", async () => {
    happy();
    const r = await run({ files: { resume: [upload("r.pdf")] } });
    expect(r.body.message).toBe("Please attach a cover letter before applying.");
    expect(sess.abortTransaction).toHaveBeenCalled();
  });

  test("WB-JOB-35 a library cover letter must have been tailored for THIS job", async () => {
    happy();
    JobseekerDocument.findOne.mockResolvedValue({ _id: DOC, storedValue: "lib.pdf", sourceJobId: "9".repeat(24) });
    let r = await run({ body: { coverLetterDocumentId: DOC }, files: { resume: [upload("r.pdf")] } });
    expect(r.body.message).toMatch(/tailor your cover letter/);
    happy();
    JobseekerDocument.findOne.mockResolvedValue({ _id: DOC, storedValue: "lib.pdf" });
    r = await run({ body: { coverLetterDocumentId: DOC }, files: { resume: [upload("r.pdf")] } });
    expect(r.status).toBe(400);
  });

  test("WB-JOB-36 new application from fresh uploads: created in the transaction, committed, then notifies, audits and clears the expiry warning", async () => {
    happy();
    const { status, body, req } = await run({ files, body: { coverLetter: "hello", includePhoto: "true" } });
    expect(status).toBe(200);
    expect(JobApplication.create).toHaveBeenCalledWith(
      [{ applicant: U, vacancy: J, resume: "r.pdf", resumeDocumentId: null, coverLetter: "hello", coverLetterFile: "c.pdf", coverLetterDocumentId: null, includePhoto: true }],
      { session: sess }
    );
    expect(sess.commitTransaction).toHaveBeenCalled();
    expect(sess.abortTransaction).not.toHaveBeenCalled();
    expect(sess.endSession).toHaveBeenCalled();
    expect(req.uploadsCommitted).toBe(true);
    expect(createNotificationForUser).toHaveBeenCalledWith(expect.objectContaining({ recipientId: E, type: "job_application", preferenceKey: "notifyNewApplicant" }));
    expect(JobVacancy.updateOne).toHaveBeenCalledWith({ _id: J }, { $set: { expiryWarnedAt: null } });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "job.application.created" }));
    expect(body).toEqual({ message: "Application submitted successfully", application: NEW_APP });
  });

  test.each([[true, true], ["true", true], ["false", false], [false, false], ["1", false], [undefined, false]])(
    "WB-JOB-37 includePhoto %p is stored as %p", async (input, stored) => {
      happy();
      await run({ files, body: { includePhoto: input } });
      expect(JobApplication.create.mock.calls[0][0][0].includePhoto).toBe(stored);
    }
  );

  test("WB-JOB-38 resume may come from req.file; cover letter text defaults to empty", async () => {
    happy();
    await run({ file: upload("single.pdf"), files: { coverLetterFile: [upload("c.pdf")] } });
    const created = JobApplication.create.mock.calls[0][0][0];
    expect(created.resume).toBe("single.pdf");
    expect(created.coverLetter).toBe("");
  });

  test("WB-JOB-39 resume and cover letter taken from the document library when tailored for this job", async () => {
    happy();
    JobseekerDocument.findOne
      .mockResolvedValueOnce({ _id: "res1", storedValue: "lib-r.pdf" })
      .mockResolvedValueOnce({ _id: "cov1", storedValue: "lib-c.pdf", sourceJobId: J });
    const { status } = await run({ body: { resumeDocumentId: DOC, coverLetterDocumentId: DOC } });
    expect(status).toBe(200);
    expect(JobApplication.create.mock.calls[0][0][0]).toMatchObject({ resume: "lib-r.pdf", resumeDocumentId: "res1", coverLetterFile: "lib-c.pdf", coverLetterDocumentId: "cov1" });
  });

  test("WB-JOB-40 a fresh upload wins over a library id for the same slot (no library lookup)", async () => {
    happy();
    await run({ files, body: { resumeDocumentId: DOC, coverLetterDocumentId: DOC } });
    expect(JobseekerDocument.findOne).not.toHaveBeenCalled();
  });

  describe("re-applying after withdrawal", () => {
    const withdrawn = (o = {}) => {
      const a = { _id: "old", status: "withdrawn", resume: "old-r.pdf", coverLetterFile: "old-c.pdf", save: jest.fn().mockResolvedValue(), ...o };
      a.set = jest.fn((patch) => Object.assign(a, patch));
      return a;
    };

    test("WB-JOB-41 reactivates the same row and removes the previous stored files", async () => {
      const a = withdrawn();
      happy(openJob(), a);
      const { status, body } = await run({ files });
      expect(status).toBe(200);
      expect(JobApplication.create).not.toHaveBeenCalled();
      expect(a.set).toHaveBeenCalledWith(expect.objectContaining({ status: "pending", statusUpdatedAt: null, employerNote: "", resume: "r.pdf", coverLetterFile: "c.pdf" }));
      expect(a.save).toHaveBeenCalledWith({ session: sess });
      expect(storage.remove).toHaveBeenCalledWith("old-r.pdf");
      expect(storage.remove).toHaveBeenCalledWith("old-c.pdf");
      expect(body.application).toBe(a);
    });

    test("WB-JOB-42 library-backed or unchanged previous files are NOT removed", async () => {
      const a = withdrawn({ resumeDocumentId: "x", coverLetterDocumentId: "y" });
      happy(openJob(), a);
      await run({ files });
      expect(storage.remove).not.toHaveBeenCalled();
      const same = withdrawn({ resume: "r.pdf", coverLetterFile: "c.pdf" });
      happy(openJob(), same);
      await run({ files });
      expect(storage.remove).not.toHaveBeenCalled();
      const none = withdrawn({ resume: "", coverLetterFile: "" });
      happy(openJob(), none);
      await run({ files });
      expect(storage.remove).not.toHaveBeenCalled();
    });

    test("WB-JOB-43 a failing storage removal is logged, never thrown", async () => {
      storage.remove.mockRejectedValue(new Error("disk"));
      happy(openJob(), withdrawn());
      const { status } = await run({ files });
      await flush();
      expect(status).toBe(200);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("previous resume"), expect.anything());
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("previous cover letter"), expect.anything());
    });

    test("WB-JOB-44 reapply with library documents records their ids", async () => {
      const a = withdrawn();
      happy(openJob(), a);
      JobseekerDocument.findOne
        .mockResolvedValueOnce({ _id: "res1", storedValue: "lib-r.pdf" })
        .mockResolvedValueOnce({ _id: "cov1", storedValue: "lib-c.pdf", sourceJobId: J });
      await run({ body: { resumeDocumentId: DOC, coverLetterDocumentId: DOC } });
      expect(a.set).toHaveBeenCalledWith(expect.objectContaining({ resumeDocumentId: "res1", coverLetterDocumentId: "cov1" }));
    });
  });

  test("WB-JOB-45 post-commit failures are non-fatal (notification, audit and the expiry-warning update)", async () => {
    happy();
    createNotificationForUser.mockRejectedValue(new Error("x"));
    logAuditEvent.mockRejectedValue(new Error("y"));
    JobVacancy.updateOne.mockRejectedValue(new Error("z"));
    const { status } = await run({ files });
    await flush();
    expect(status).toBe(200);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("expiryWarnedAt"), expect.anything());
  });

  test("WB-JOB-46 duplicate-key race (E11000) maps to the 'already applied' 400 and aborts", async () => {
    happy();
    JobApplication.create.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
    const r = await run({ files });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("You have already applied to this job");
    expect(sess.abortTransaction).toHaveBeenCalled();
  });

  test("WB-JOB-47 other errors: 500 with the raw message outside production, generic in production", async () => {
    happy();
    JobApplication.create.mockRejectedValue(new Error("boom"));
    expect((await run({ files })).body.message).toBe("boom");
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      happy();
      JobApplication.create.mockRejectedValue(new Error("boom"));
      expect((await run({ files })).body.message).toBe("Failed to submit application. Please try again later.");
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  test("WB-JOB-48 a failing abort does not mask the original error", async () => {
    happy();
    sess.abortTransaction.mockRejectedValue(new Error("abort failed"));
    JobApplication.create.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
    const r = await run({ files });
    expect(r.status).toBe(400);
    expect(logger.error).toHaveBeenCalledWith("Failed to abort application transaction", expect.anything());
  });

  test("WB-JOB-49 no abort when the session is no longer in a transaction", async () => {
    happy();
    sess.inTransaction.mockReturnValue(false);
    JobApplication.create.mockRejectedValue(new Error("boom"));
    await run({ files });
    expect(sess.abortTransaction).not.toHaveBeenCalled();
    expect(sess.endSession).toHaveBeenCalled();
  });

  test("WB-JOB-50 an error AFTER commit must not abort (the application is saved)", async () => {
    happy();
    const req = userReq({ params: { id: J }, files, app: { get: jest.fn(() => { throw new Error("io gone"); }) } });
    const { status } = await call(c.applyToJob, req);
    expect(status).toBe(500);
    expect(sess.commitTransaction).toHaveBeenCalled();
    expect(sess.abortTransaction).not.toHaveBeenCalled();
  });

  test("WB-JOB-51 failure before a session exists does not try to end one", async () => {
    JobVacancy.findById.mockRejectedValue(dbError());
    const r = await run();
    expect(r.status).toBe(500);
    expect(JobApplication.startSession).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("getApplicationsForJob", () => {
  const run = (user = { id: E, role: "employer" }) => call(c.getApplicationsForJob, makeReq({ params: { id: J }, user }));
  const applicant = (id, o = {}) => ({ _id: id, name: `N${id}`, isActive: true, ...o });
  const wire = (apps, job = { _id: J, title: "Welder", employer: E }) => {
    JobVacancy.findById.mockResolvedValue(job);
    JobApplication.find.mockReturnValue(query(apps));
  };
  const conv = () => ({ _id: "c1", save: jest.fn().mockResolvedValue() });

  test("WB-JOB-52 unknown job 404", async () => {
    JobVacancy.findById.mockResolvedValue(null);
    expect((await run()).status).toBe(404);
  });

  test("WB-JOB-53 neither owner nor admin is 403 (superadmin is not admin here)", async () => {
    wire([]);
    expect((await run({ id: U, role: "employer" })).status).toBe(403);
    expect((await run({ id: U, role: "superadmin" })).status).toBe(403);
  });

  test("WB-JOB-54 admin sees the list without any messaging side effects; withdrawn are excluded by the query", async () => {
    wire([{ applicant: applicant("a1") }]);
    const { body } = await run({ id: U, role: "admin" });
    expect(body).toHaveLength(1);
    expect(ensureConversationBetweenUsers).not.toHaveBeenCalled();
    expect(JobApplication.find).toHaveBeenCalledWith({ vacancy: J, status: { $ne: "withdrawn" } });
  });

  test("WB-JOB-55 suspended or deleted applicants are hidden", async () => {
    wire([{ applicant: applicant("a1") }, { applicant: applicant("a2", { isActive: false }) }, { applicant: null }, { applicant: applicant("a4", { isActive: undefined }) }]);
    const { body } = await run({ id: U, role: "admin" });
    expect(body.map((a) => a.applicant._id)).toEqual(["a1", "a4"]);
  });

  test("WB-JOB-56 owner: an intro message is created for applicants with no conversation history", async () => {
    wire([{ applicant: applicant("a1") }]);
    const cv = conv();
    ensureConversationBetweenUsers.mockResolvedValue(cv);
    Message.exists.mockResolvedValue(null);
    Message.create.mockResolvedValue({ content: "hi", createdAt: "t" });
    await run();
    expect(ensureConversationBetweenUsers).toHaveBeenCalledWith(E, "a1");
    expect(Message.create).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "c1", sender: E, isRead: false, content: expect.stringContaining("Hi Na1, we've reviewed your application for Welder") }));
    expect(cv).toMatchObject({ lastMessage: "hi", lastMessageAt: "t" });
    expect(cv.save).toHaveBeenCalled();
  });

  test("WB-JOB-57 owner: existing message history means no new message; nameless applicant would be greeted 'there'", async () => {
    wire([{ applicant: applicant("a1") }]);
    ensureConversationBetweenUsers.mockResolvedValue(conv());
    Message.exists.mockResolvedValue({ _id: "m" });
    await run();
    expect(Message.create).not.toHaveBeenCalled();
    wire([{ applicant: applicant("a2", { name: "" }) }]);
    Message.exists.mockResolvedValue(null);
    Message.create.mockResolvedValue({ content: "x" });
    await run();
    expect(Message.create.mock.calls[0][0].content).toContain("Hi there,");
  });

  test("WB-JOB-58 KNOWN-ISSUE: merely viewing the applicant list (a GET) sends an automatic message to every applicant", async () => {
    wire([{ applicant: applicant("a1") }, { applicant: applicant("a2") }]);
    ensureConversationBetweenUsers.mockResolvedValue(conv());
    Message.exists.mockResolvedValue(null);
    Message.create.mockResolvedValue({ content: "x" });
    await run();
    expect(Message.create).toHaveBeenCalledTimes(2);
  });

  test("WB-JOB-59 DB failure is a generic 500", async () => {
    JobVacancy.findById.mockRejectedValue(dbError());
    const r = await run();
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ message: "Failed to fetch applications" });
  });
});

// ---------------------------------------------------------------------------
describe("getMyApplications", () => {
  const appDoc = (vacancy) => ({ toObject: () => ({ vacancy }) });
  const run = (q) => call(c.getMyApplications, userReq({ query: q }));

  describe("non-paginated", () => {
    test("WB-JOB-60 no paging params returns a plain array", async () => {
      JobApplication.find.mockReturnValue(query([appDoc(null)]));
      const { body } = await run({});
      expect(body).toEqual([{ vacancy: null }]);
      expect(JobApplication.find).toHaveBeenCalledWith({ applicant: U });
    });
  });

  describe("vacancy normalisation", () => {
    const one = async (vacancy) => (await run({})).body[0].vacancy;
    const wire = (vacancy) => JobApplication.find.mockReturnValue(query([appDoc(vacancy)]));

    test("WB-JOB-61 populated employer is kept; qualifications are sorted and cleaned", async () => {
      wire({ employer: { name: "Emp", isActive: true }, qualifications: [{ value: "b", order: 2 }, { value: "a", order: 1 }, { value: "" }] });
      const v = await one();
      expect(v.employer.name).toBe("Emp");
      expect(v.qualifications.map((q) => q.value)).toEqual(["a", "b"]);
      expect(v.employerUnavailable).toBeUndefined();
      expect(User.findById).not.toHaveBeenCalled();
    });

    test("WB-JOB-62 suspended populated employer is flagged as unavailable", async () => {
      wire({ employer: { name: "Emp", isActive: false } });
      expect((await one()).employerUnavailable).toBe(true);
    });

    test.each([
      ["employer id as a string", "e1"],
      ["employer object without a name", { _id: "e2" }],
    ])("WB-JOB-63 %s is looked up in the User collection", async (_n, employer) => {
      wire({ employer });
      User.findById.mockReturnValue(query({ name: "Looked up", isActive: true }));
      expect((await one()).employer.name).toBe("Looked up");
      expect(User.findById).toHaveBeenCalledWith(typeof employer === "string" ? employer : "e2");
    });

    test("WB-JOB-64 looked-up employer that is inactive is flagged; a missing one becomes 'Unknown'", async () => {
      wire({ employer: "e1" });
      User.findById.mockReturnValue(query({ name: "X", isActive: false }));
      expect((await one()).employerUnavailable).toBe(true);
      wire({ employer: "e1" });
      User.findById.mockReturnValue(query(null));
      expect((await one()).employer).toEqual({ name: "Unknown", companyName: "No company name" });
    });

    test("WB-JOB-65 no employer id at all becomes 'Unknown' without a lookup", async () => {
      wire({ employer: null });
      expect((await one()).employer).toEqual({ name: "Unknown", companyName: "No company name" });
      wire({ employer: {} });
      expect((await one()).employer).toEqual({ name: "Unknown", companyName: "No company name" });
      expect(User.findById).not.toHaveBeenCalled();
    });
  });

  describe("paginated", () => {
    const wire = (rows = [], total = rows.length, buckets = []) => {
      JobApplication.countDocuments.mockResolvedValue(total);
      const q1 = query(rows);
      JobApplication.find.mockReturnValue(q1);
      JobApplication.aggregate.mockResolvedValue(buckets);
      return q1;
    };

    test.each([{ page: "1" }, { limit: "5" }, { status: "all" }])("WB-JOB-66 any of page/limit/status triggers pagination (%j)", async (q) => {
      wire();
      expect((await run(q)).body).toHaveProperty("items");
    });

    test("WB-JOB-67 defaults page 1, limit 5; clamps limit to 100 and page to >=1", async () => {
      let q1 = wire();
      await run({ page: "-2", limit: "0" });
      expect(q1.skip).toHaveBeenCalledWith(0);
      expect(q1.limit).toHaveBeenCalledWith(5);
      q1 = wire();
      await run({ page: "3", limit: "9999" });
      expect(q1.limit).toHaveBeenCalledWith(100);
      expect(q1.skip).toHaveBeenCalledWith(200);
    });

    test.each([
      ["pending", ["pending", "applied"]],
      ["under_review", ["under_review", "reviewed"]],
      ["shortlisted", ["shortlisted"]],
      ["approved", ["approved"]],
      ["accepted", ["accepted", "hired"]],
      ["rejected", ["rejected"]],
      ["withdrawn", ["withdrawn"]],
    ])("WB-JOB-68 tab %s filters case-insensitively on %j", async (tab, values) => {
      wire();
      await run({ status: tab.toUpperCase() });
      const filter = JobApplication.countDocuments.mock.calls[0][0];
      expect(filter.applicant).toBe(U);
      expect(filter.status.$in.map(String)).toEqual(values.map((v) => `/^${v}$/i`));
    });

    test("WB-JOB-69 'all' and unknown tabs add no status filter", async () => {
      wire();
      await run({ status: "all" });
      expect(JobApplication.countDocuments).toHaveBeenLastCalledWith({ applicant: U });
      await run({ status: "constructor" });
      expect(JobApplication.countDocuments).toHaveBeenLastCalledWith({ applicant: U });
    });

    test("WB-JOB-70 status counts merge legacy names (applied, reviewed, hired); a null bucket id counts as pending", async () => {
      wire([], 0, [
        { _id: "applied", count: 2 }, { _id: null, count: 4 },
        { _id: "reviewed", count: 1 }, { _id: "under_review", count: 1 },
        { _id: "shortlisted", count: 3 }, { _id: "approved", count: 1 },
        { _id: "hired", count: 2 }, { _id: "accepted", count: 1 }, { _id: "rejected", count: 5 }, { _id: "withdrawn", count: 6 },
      ]);
      const { body } = await run({ page: "1" });
      expect(body.counts).toEqual({ all: 26, pending: 6, under_review: 2, shortlisted: 3, approved: 1, accepted: 3, rejected: 5, withdrawn: 6 });
    });

    test("WB-JOB-70b KNOWN-ISSUE: a null-status bucket OVERWRITES the 'pending' bucket instead of adding to it, so pending is under-counted while 'all' is not", async () => {
      wire([], 0, [{ _id: "pending", count: 1 }, { _id: null, count: 4 }]);
      const { body } = await run({ page: "1" });
      expect(body.counts.all).toBe(5);
      expect(body.counts.pending).toBe(4);
    });

    test("WB-JOB-71 empty buckets give all-zero counts; totalPages is at least 1", async () => {
      wire([], 0, []);
      const { body } = await run({ page: "1" });
      expect(body.counts.all).toBe(0);
      expect(body).toMatchObject({ total: 0, totalPages: 1, currentPage: 1 });
      wire([], 11, []);
      expect((await run({ limit: "5" })).body.totalPages).toBe(3);
    });
  });

  test("WB-JOB-72 DB failure is a generic 500", async () => {
    JobApplication.find.mockReturnValue(failingQuery(dbError()));
    const r = await run({});
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ message: "Failed to fetch your applications" });
  });
});

// ---------------------------------------------------------------------------
describe("updateMyApplication", () => {
  const mkApp = (o = {}) => ({ _id: "app1", applicant: { toString: () => U }, resume: "old-r.pdf", coverLetterFile: "old-c.pdf", save: jest.fn().mockResolvedValue(), ...o });
  const run = (reqOver = {}) => call(c.updateMyApplication, userReq({ params: { id: "app1" }, body: {}, ...reqOver }));
  const wire = (app, populated) => {
    JobApplication.findById.mockReturnValueOnce(query(app)).mockReturnValueOnce(query(populated));
  };

  test("WB-JOB-73 unknown application 404; someone else's application 403", async () => {
    JobApplication.findById.mockReturnValue(query(null));
    expect((await run()).status).toBe(404);
    JobApplication.findById.mockReturnValue(query(mkApp({ applicant: { toString: () => "other" } })));
    const r = await run();
    expect(r.status).toBe(403);
  });

  test("WB-JOB-74 replacing the resume with an upload removes the old stored file (not when library-backed or unchanged)", async () => {
    const a = mkApp();
    wire(a, null);
    await run({ files: { resume: [{ storedValue: "new.pdf" }] } });
    expect(a).toMatchObject({ resume: "new.pdf", resumeDocumentId: null });
    expect(storage.remove).toHaveBeenCalledWith("old-r.pdf");
    storage.remove.mockClear();
    const lib = mkApp({ resumeDocumentId: "x" });
    wire(lib, null);
    await run({ files: { resume: [{ storedValue: "new.pdf" }] } });
    expect(storage.remove).not.toHaveBeenCalled();
    const same = mkApp({ resume: "new.pdf" });
    wire(same, null);
    await run({ file: { storedValue: "new.pdf" } });
    expect(storage.remove).not.toHaveBeenCalled();
    const none = mkApp({ resume: "" });
    wire(none, null);
    await run({ file: { storedValue: "new.pdf" } });
    expect(storage.remove).not.toHaveBeenCalled();
  });

  test("WB-JOB-75 resume from the library records the document id", async () => {
    const a = mkApp();
    wire(a, null);
    JobseekerDocument.findOne.mockResolvedValue({ _id: "res1", storedValue: "lib.pdf" });
    await run({ body: { resumeDocumentId: DOC } });
    expect(a).toMatchObject({ resume: "lib.pdf", resumeDocumentId: "res1" });
  });

  test("WB-JOB-76 replacing the cover letter file clears the text and removes the old file", async () => {
    const a = mkApp({ coverLetter: "text" });
    wire(a, null);
    await run({ files: { coverLetterFile: [{ storedValue: "newc.pdf" }] } });
    expect(a).toMatchObject({ coverLetterFile: "newc.pdf", coverLetterDocumentId: null, coverLetter: "" });
    expect(storage.remove).toHaveBeenCalledWith("old-c.pdf");
    storage.remove.mockClear();
    const lib = mkApp({ coverLetterDocumentId: "y" });
    wire(lib, null);
    JobseekerDocument.findOne.mockResolvedValue({ _id: "cov1", storedValue: "libc.pdf" });
    await run({ body: { coverLetterDocumentId: DOC } });
    expect(lib).toMatchObject({ coverLetterFile: "libc.pdf", coverLetterDocumentId: "cov1" });
    expect(storage.remove).not.toHaveBeenCalled();
    const same = mkApp({ coverLetterFile: "newc.pdf" });
    wire(same, null);
    await run({ files: { coverLetterFile: [{ storedValue: "newc.pdf" }] } });
    expect(storage.remove).not.toHaveBeenCalled();
  });

  test("WB-JOB-77 storage removal failures are logged, not thrown", async () => {
    storage.remove.mockRejectedValue(new Error("disk"));
    wire(mkApp(), null);
    const r = await run({ files: { resume: [{ storedValue: "n.pdf" }], coverLetterFile: [{ storedValue: "m.pdf" }] } });
    await flush();
    expect(r.status).toBe(200);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("replaced resume"), expect.anything());
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("replaced cover letter"), expect.anything());
  });

  test.each([[true, true], ["true", true], [false, false], ["false", false]])("WB-JOB-78 includePhoto %p updates to %p", async (input, stored) => {
    const a = mkApp({ includePhoto: !stored });
    wire(a, null);
    await run({ body: { includePhoto: input } });
    expect(a.includePhoto).toBe(stored);
  });

  test.each([["maybe"], [undefined], [1]])("WB-JOB-79 includePhoto %p leaves the value unchanged", async (input) => {
    const a = mkApp({ includePhoto: true });
    wire(a, null);
    await run({ body: input === undefined ? {} : { includePhoto: input } });
    expect(a.includePhoto).toBe(true);
  });

  describe("response normalisation", () => {
    const populated = (vacancy, asDoc = true) => (asDoc ? { toObject: () => ({ vacancy }) } : { vacancy });

    test("WB-JOB-80 populated employer kept, qualifications formatted", async () => {
      wire(mkApp(), populated({ employer: { name: "E" }, qualifications: [{ value: "b", order: 2 }, { value: "a", order: 1 }] }));
      const { body } = await run();
      expect(body.application.vacancy.qualifications.map((q) => q.value)).toEqual(["a", "b"]);
      expect(User.findById).not.toHaveBeenCalled();
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "job.application.updated" }));
    });

    test.each([["string id", "e1"], ["object with _id", { _id: "e2" }]])("WB-JOB-81 employer as %s is looked up", async (_n, employer) => {
      wire(mkApp(), populated({ employer }));
      User.findById.mockReturnValue(query({ name: "Found" }));
      expect((await run()).body.application.vacancy.employer).toEqual({ name: "Found" });
    });

    test("WB-JOB-82 employer not found becomes 'Unknown'; no employer id leaves it untouched", async () => {
      wire(mkApp(), populated({ employer: "e1" }));
      User.findById.mockReturnValue(query(null));
      expect((await run()).body.application.vacancy.employer).toEqual({ name: "Unknown", companyName: "No company name" });
      wire(mkApp(), populated({ employer: null }));
      expect((await run()).body.application.vacancy.employer).toBeNull();
    });

    test("WB-JOB-83 populated result that is not a document, or has no vacancy, is passed through", async () => {
      wire(mkApp(), populated({ employer: { name: "E" } }, false));
      expect((await run()).body.application).toEqual({ vacancy: { employer: { name: "E" } } });
      wire(mkApp(), null);
      expect((await run()).body.application).toBeNull();
    });
  });

  test("WB-JOB-84 failure: raw message outside production, generic in production", async () => {
    JobApplication.findById.mockReturnValue(failingQuery(new Error("boom")));
    expect((await run()).body.message).toBe("boom");
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect((await run()).body.message).toBe("Failed to update application");
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

// ---------------------------------------------------------------------------
describe("deleteMyApplication (withdraw)", () => {
  const mkApp = (o = {}) => ({ _id: "app1", status: "pending", applicant: { toString: () => U }, save: jest.fn().mockResolvedValue(), ...o });
  const run = () => call(c.deleteMyApplication, userReq({ params: { id: "app1" } }));

  test("WB-JOB-85 unknown 404, not yours 403", async () => {
    JobApplication.findById.mockReturnValue(query(null));
    expect((await run()).status).toBe(404);
    JobApplication.findById.mockReturnValue(query(mkApp({ applicant: { toString: () => "other" } })));
    expect((await run()).status).toBe(403);
  });

  test("WB-JOB-86 a hired application cannot be withdrawn", async () => {
    const a = mkApp({ status: "hired" });
    JobApplication.findById.mockReturnValue(query(a));
    expect((await run()).status).toBe(400);
    expect(a.save).not.toHaveBeenCalled();
  });

  test.each(["accepted", "Accepted", "HIRED"])("WB-JOB-87 KNOWN-ISSUE: status %p is the same state as hired elsewhere in the code but can still be withdrawn", async (status) => {
    const a = mkApp({ status });
    JobApplication.findById.mockReturnValue(query(a));
    expect((await run()).status).toBe(200);
    expect(a.status).toBe("withdrawn");
  });

  test("WB-JOB-88 withdrawing sets status and timestamp (row kept) and audits", async () => {
    const a = mkApp();
    JobApplication.findById.mockReturnValue(query(a));
    const { body } = await run();
    expect(a.status).toBe("withdrawn");
    expect(a.statusUpdatedAt).toBeInstanceOf(Date);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "job.application.deleted" }));
    expect(body).toEqual({ message: "Application withdrawn successfully", id: "app1" });
  });

  test("WB-JOB-89 save failure is a generic 500", async () => {
    const a = mkApp();
    a.save.mockRejectedValue(dbError());
    JobApplication.findById.mockReturnValue(query(a));
    const r = await run();
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ message: "Failed to delete application" });
  });
});

// ---------------------------------------------------------------------------
describe("closeJob / archiveJob / reopenJob", () => {
  const mkJob = (o = {}) => {
    const j = { _id: J, title: "Welder", employer: { toString: () => E }, status: "active", save: jest.fn().mockResolvedValue(), ...o };
    j.toObject = jest.fn(() => ({ _id: J, status: j.status }));
    return j;
  };
  const owner = { id: E, role: "employer" };
  const admin = { id: U, role: "admin" };
  const wire = (job, apps = []) => {
    JobVacancy.findById.mockResolvedValue(job);
    JobApplication.find.mockReturnValue(query(apps));
    User.find.mockReturnValue(query([]));
  };
  const closeReq = (user) => makeReq({ params: { id: J }, user });
  const archiveReq = (user, body) => makeReq({ params: { id: J }, user, body });

  describe("closeJob", () => {
    test("WB-JOB-90 unknown 404; neither owner nor admin 403", async () => {
      JobVacancy.findById.mockResolvedValue(null);
      expect((await call(c.closeJob, closeReq(owner))).status).toBe(404);
      wire(mkJob());
      expect((await call(c.closeJob, closeReq({ id: U, role: "employer" }))).status).toBe(403);
      expect((await call(c.closeJob, closeReq({ id: U, role: "superadmin" }))).status).toBe(403);
    });

    test("WB-JOB-91 an already archived job returns early without side effects", async () => {
      const j = mkJob({ archived: true });
      wire(j);
      const { body } = await call(c.closeJob, closeReq(owner));
      expect(body.message).toBe("Job already archived");
      expect(j.save).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    test("WB-JOB-92 owner close: archived with snapshot, reason mapped to 'manual', pending applicants notified, no admin notice", async () => {
      const j = mkJob();
      wire(j, [
        { applicant: "p1", status: "pending" }, { applicant: "p2", status: "Under_Review" }, { applicant: "p3", status: "shortlisted" },
        { applicant: "p4", status: "approved" }, { applicant: "h1", status: "hired" }, { applicant: "h2", status: "accepted" }, { applicant: "r1", status: "rejected" },
      ]);
      User.find.mockReturnValue(query([{ _id: "h1", name: "Hired One" }]));
      const { body } = await call(c.closeJob, closeReq(owner));
      expect(j).toMatchObject({ status: "closed", archived: true, archiveReason: "manual_close", closeReason: "manual", closedBy: "employer" });
      expect(j.closedAt).toBeInstanceOf(Date);
      expect(j.archivedMetrics).toMatchObject({ totalApplicants: 7, qualifiedCount: 5, shortlistedCount: 4, hiredCount: 2, hiredCandidateNames: ["Hired One"] });
      const notified = createNotificationForUser.mock.calls.map((x) => x[0].recipientId);
      expect(notified).toEqual(["p1", "p2", "p3", "p4"]);
      expect(createNotificationForUser.mock.calls.every((x) => x[0].type === "system")).toBe(true);
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "employer.job.closed", actorRole: "employer" }));
      expect(body.message).toBe("Job closed and archived successfully");
    });

    test("WB-JOB-93 withdrawn applications are excluded from the snapshot by the query", async () => {
      wire(mkJob());
      await call(c.closeJob, closeReq(owner));
      expect(JobApplication.find).toHaveBeenCalledWith({ vacancy: J, status: { $ne: "withdrawn" } });
    });

    test("WB-JOB-94 no hired applicants: the User lookup is skipped", async () => {
      wire(mkJob(), [{ applicant: "p1", status: "pending" }]);
      await call(c.closeJob, closeReq(owner));
      expect(User.find).not.toHaveBeenCalled();
    });

    test("WB-JOB-95 admin closing someone else's job records closedBy admin and tells the employer", async () => {
      const j = mkJob();
      wire(j);
      await call(c.closeJob, closeReq(admin));
      expect(j).toMatchObject({ closeReason: "admin", closedBy: "admin" });
      expect(createNotificationForUser).toHaveBeenCalledWith(expect.objectContaining({ recipientId: j.employer, title: "Your job posting was closed" }));
    });

    test("WB-JOB-96 admin closing their OWN job is treated as an owner close (no admin notice)", async () => {
      const j = mkJob({ employer: { toString: () => U } });
      wire(j);
      await call(c.closeJob, closeReq(admin));
      expect(j.closedBy).toBe("employer");
      expect(createNotificationForUser).not.toHaveBeenCalled();
    });

    test("WB-JOB-97 existing closeReason and closedAt are preserved", async () => {
      const closedAt = new Date("2026-01-01");
      const j = mkJob({ closeReason: "filled", closedBy: "employer", closedAt });
      wire(j);
      await call(c.closeJob, closeReq(owner));
      expect(j.closeReason).toBe("filled");
    });

    test("WB-JOB-98 failure is a generic 500", async () => {
      const j = mkJob();
      j.save.mockRejectedValue(dbError());
      wire(j);
      const r = await call(c.closeJob, closeReq(owner));
      expect(r.status).toBe(500);
      expect(r.body).toEqual({ message: "Failed to close job" });
    });
  });

  describe("archiveJob", () => {
    test("WB-JOB-99 unknown 404; not owner/admin 403; already archived returns early", async () => {
      JobVacancy.findById.mockResolvedValue(null);
      expect((await call(c.archiveJob, archiveReq(owner))).status).toBe(404);
      wire(mkJob());
      expect((await call(c.archiveJob, archiveReq({ id: U, role: "employer" }))).status).toBe(403);
      wire(mkJob({ archived: true }));
      expect((await call(c.archiveJob, archiveReq(owner))).body.message).toBe("Job already archived");
    });

    test.each([
      ["manual_close", "manual"], ["deadline_passed", "expired"], ["quota_reached", "filled"], ["something_else", "manual"],
    ])("WB-JOB-100 archiving an open job with reason %s records closeReason %s", async (reason, closeReason) => {
      const j = mkJob();
      wire(j);
      await call(c.archiveJob, archiveReq(owner, { reason }));
      expect(j).toMatchObject({ status: "closed", archiveReason: reason, closeReason });
      expect(j.closedAt).toBeInstanceOf(Date);
    });

    test("WB-JOB-101 default reason is manual_close (missing body or reason)", async () => {
      const j = mkJob();
      wire(j);
      await call(c.archiveJob, archiveReq(owner, undefined));
      expect(j.archiveReason).toBe("manual_close");
    });

    test("WB-JOB-102 archiving an ALREADY CLOSED job keeps its original close reason and time", async () => {
      const closedAt = new Date("2026-01-01");
      const j = mkJob({ status: "closed", closedAt, closeReason: "expired", closedBy: "employer" });
      wire(j);
      await call(c.archiveJob, archiveReq(owner, { reason: "manual_close" }));
      expect(j.closeReason).toBe("expired");
      expect(j.closedAt).toBe(closedAt);
      const noReason = mkJob({ status: "closed" });
      wire(noReason);
      await call(c.archiveJob, archiveReq(owner, { reason: "manual_close" }));
      expect(noReason.closeReason).toBeUndefined();
    });

    test("WB-JOB-103 admin archiving another employer's OPEN job: closedBy admin and the employer is notified", async () => {
      const j = mkJob();
      wire(j);
      await call(c.archiveJob, archiveReq(admin, {}));
      expect(j).toMatchObject({ closeReason: "admin", closedBy: "admin" });
      expect(createNotificationForUser).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("archived your job posting") }));
    });

    test("WB-JOB-104 admin archiving an already-closed job sends no notification; owner archive sends none", async () => {
      wire(mkJob({ status: "closed" }));
      await call(c.archiveJob, archiveReq(admin, {}));
      wire(mkJob());
      await call(c.archiveJob, archiveReq(owner, {}));
      expect(createNotificationForUser).not.toHaveBeenCalled();
    });

    test("WB-JOB-105 audit event and success body; failure is a generic 500", async () => {
      wire(mkJob());
      const ok = await call(c.archiveJob, archiveReq(owner, {}));
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "employer.job.archived" }));
      expect(ok.body.message).toBe("Job archived successfully");
      const j = mkJob();
      j.save.mockRejectedValue(dbError());
      wire(j);
      const r = await call(c.archiveJob, archiveReq(owner, {}));
      expect(r.status).toBe(500);
      expect(r.body).toEqual({ message: "Failed to archive job" });
    });
  });

  describe("reopenJob", () => {
    test("WB-JOB-106 unknown 404; not owner/admin 403; only closed jobs can be reopened", async () => {
      JobVacancy.findById.mockResolvedValue(null);
      expect((await call(c.reopenJob, closeReq(owner))).status).toBe(404);
      wire(mkJob({ status: "closed" }));
      expect((await call(c.reopenJob, closeReq({ id: U, role: "employer" }))).status).toBe(403);
      wire(mkJob({ status: "active" }));
      const r = await call(c.reopenJob, closeReq(owner));
      expect(r.status).toBe(400);
      expect(r.body.message).toBe("Only closed jobs can be reopened");
    });

    test("WB-JOB-107 owner reopen: active again, closedAt cleared, un-archived, audited, no admin notice", async () => {
      const j = mkJob({ status: "closed", closedAt: new Date(), archived: true });
      wire(j);
      const { body } = await call(c.reopenJob, closeReq(owner));
      expect(j).toMatchObject({ status: "active", closedAt: null, archived: false });
      expect(j.save).toHaveBeenCalled();
      expect(createNotificationForUser).not.toHaveBeenCalled();
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "employer.job.reopened" }));
      expect(body.message).toBe("Job reopened successfully");
    });

    test("WB-JOB-108 admin reopening someone else's job notifies the employer; admin reopening their own does not", async () => {
      wire(mkJob({ status: "closed" }));
      await call(c.reopenJob, closeReq(admin));
      expect(createNotificationForUser).toHaveBeenCalledWith(expect.objectContaining({ title: "Your job posting was reopened" }));
      createNotificationForUser.mockClear();
      wire(mkJob({ status: "closed", employer: { toString: () => U } }));
      await call(c.reopenJob, closeReq(admin));
      expect(createNotificationForUser).not.toHaveBeenCalled();
    });

    test("WB-JOB-109 failure is a generic 500", async () => {
      const j = mkJob({ status: "closed" });
      j.save.mockRejectedValue(dbError());
      wire(j);
      const r = await call(c.reopenJob, closeReq(owner));
      expect(r.status).toBe(500);
      expect(r.body).toEqual({ message: "Failed to reopen job" });
    });
  });
});
