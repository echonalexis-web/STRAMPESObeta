// White-box branch coverage for server/controllers/employerController.js.
// Tests tagged KNOWN-ISSUE pin CURRENT behaviour that looks like a defect (see
// docs/WHITE_BOX_TEST_REPORT.md).

jest.mock("../models/JobVacancy", () => ({ find: jest.fn(), findById: jest.fn(), create: jest.fn(), updateMany: jest.fn(), findByIdAndDelete: jest.fn() }));
jest.mock("../models/JobApplication", () => ({
  find: jest.fn(), findById: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn(), deleteMany: jest.fn(), exists: jest.fn(),
}));
jest.mock("../models/Message", () => ({ create: jest.fn() }));
jest.mock("../models/JobseekerProfile", () => ({ find: jest.fn(), findOne: jest.fn() }));
jest.mock("../models/User", () => ({ findById: jest.fn(), find: jest.fn() }));
jest.mock("../models/Follow", () => ({ exists: jest.fn() }));
jest.mock("../models/SystemSettings", () => ({ getSingleton: jest.fn() }));
jest.mock("../controllers/messageController", () => ({ ensureConversationBetweenUsers: jest.fn() }));
jest.mock("../services/notificationService", () => ({ createNotificationForUser: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn() }));
jest.mock("../services/profileProjection", () => ({ resolveRelationship: jest.fn(), projectJobseeker: jest.fn(), projectApplicant: jest.fn() }));
jest.mock("../services/bannerTemplateService", () => ({ resolveCover: jest.fn() }));
jest.mock("../services/archivedJobsService", () => ({
  FILTERS: ["all", "filled", "expired"], SORTS: ["recent", "oldest"], HIRED_STATUSES: ["hired", "accepted"],
  buildArchivedItem: jest.fn(), buildStats: jest.fn(), filterCounts: jest.fn(), applyListControls: jest.fn(), stripInternal: jest.fn(),
}));
jest.mock("../utils/qualificationRules", () => ({ normalizeQualificationList: jest.fn() }));
jest.mock("../utils/age", () => ({ MIN_ACCOUNT_AGE: 15, getAgeTier: jest.fn(), TIERS: { MINOR: "minor", ADULT: "adult", SENIOR: "senior" } }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const Message = require("../models/Message");
const JobseekerProfile = require("../models/JobseekerProfile");
const User = require("../models/User");
const Follow = require("../models/Follow");
const SystemSettings = require("../models/SystemSettings");
const { ensureConversationBetweenUsers } = require("../controllers/messageController");
const { createNotificationForUser } = require("../services/notificationService");
const { logAuditEvent } = require("../services/auditService");
const { resolveRelationship, projectJobseeker, projectApplicant } = require("../services/profileProjection");
const { resolveCover } = require("../services/bannerTemplateService");
const archived = require("../services/archivedJobsService");
const { normalizeQualificationList } = require("../utils/qualificationRules");
const { getAgeTier } = require("../utils/age");
const ctl = require("../controllers/employerController");
const { makeReq, makeRes, query, failingQuery, call } = require("../testUtils/httpMocks");

const EMP = "emp1";
const DAY = 86400000;
const dbError = () => new Error("secret db internals");
// `io` defaults to "no socket server"; tests that need one pass their own `app`.
const ereq = (o = {}) => makeReq({ user: { id: EMP, _id: EMP, role: "employer" }, app: { get: jest.fn(() => null) }, ...o });
const future = (days = 7) => new Date(Date.now() + days * DAY).toISOString();
const past = (days = 1) => new Date(Date.now() - days * DAY);
const mkIo = () => {
  const emit = jest.fn();
  return { to: jest.fn(() => ({ emit })), emit };
};

beforeEach(() => {
  jest.resetAllMocks();
  createNotificationForUser.mockResolvedValue();
  logAuditEvent.mockResolvedValue();
  JobVacancy.updateMany.mockResolvedValue();
  SystemSettings.getSingleton.mockResolvedValue({ autoCloseDays: 30 });
  normalizeQualificationList.mockImplementation((l) => l);
  projectApplicant.mockImplementation(({ user, profile, includePhoto }) => ({ projected: true, id: user._id, hasProfile: Boolean(profile), includePhoto }));
});

// ---------------------------------------------------------------------------
describe("getEmployerJobs and the auto-close sweeps", () => {
  const run = (over = {}) => call(ctl.getEmployerJobs, ereq(over));
  // find() order inside getEmployerJobs: 1 overdue sweep, 2 inactivity sweep, 3 the list.
  const wireFinds = ({ overdue = [], active = [], list = [] } = {}) => {
    JobVacancy.find.mockReturnValueOnce(query(overdue)).mockReturnValueOnce(query(active)).mockReturnValueOnce(query(list));
    JobApplication.aggregate.mockResolvedValue([]);
  };
  const dbJob = (id, o = {}) => ({ _id: id, title: `T${id}`, createdAt: new Date(), toObject() { return { _id: id, qualifications: o.qualifications }; }, ...o });

  test("WB-EMP-01 overdue active jobs are closed (reason 'expired', closedBy system) and the employer is told per job", async () => {
    wireFinds({ overdue: [{ _id: "j1", title: "A" }, { _id: "j2", title: "B" }] });
    await run();
    expect(JobVacancy.find.mock.calls[0][0]).toMatchObject({ employer: EMP, status: "active", applicationDeadline: { $ne: null, $lt: expect.any(Date) } });
    expect(JobVacancy.updateMany).toHaveBeenCalledWith({ _id: { $in: ["j1", "j2"] } }, { $set: expect.objectContaining({ status: "closed", closeReason: "expired", closedBy: "system" }) });
    expect(createNotificationForUser).toHaveBeenCalledTimes(2);
    expect(createNotificationForUser.mock.calls[0][0].message).toContain("passed its application deadline");
  });

  test("WB-EMP-02 no overdue jobs: nothing is closed or sent", async () => {
    wireFinds();
    await run();
    expect(JobVacancy.updateMany).not.toHaveBeenCalled();
  });

  test.each([[{ autoCloseDays: 0 }], [{ autoCloseDays: -5 }]])("WB-EMP-03 inactivity setting %j: non-numeric/zero falls back to 30 days; negative disables the sweep", async (settings) => {
    SystemSettings.getSingleton.mockResolvedValue(settings);
    wireFinds();
    await run();
    expect(JobVacancy.find.mock.calls.length).toBe(settings.autoCloseDays < 0 ? 2 : 3);
  });

  test("WB-EMP-04 an account with no active jobs ends the sweep early (no aggregation)", async () => {
    wireFinds();
    await run();
    expect(JobApplication.aggregate).not.toHaveBeenCalled();
  });

  test("WB-EMP-05 inactivity classification: last application date (else createdAt) drives close vs warn vs nothing; an already-warned job is not warned twice", async () => {
    const jobs = [
      { _id: "old", title: "Old", createdAt: past(40) },
      { _id: "warn", title: "Warn", createdAt: past(28) },
      { _id: "warned", title: "Warned", createdAt: past(28), expiryWarnedAt: new Date() },
      { _id: "fresh", title: "Fresh", createdAt: past(1) },
      { _id: "revived", title: "Revived", createdAt: past(100) },
    ];
    wireFinds({ active: jobs });
    JobApplication.aggregate.mockResolvedValue([{ _id: "revived", lastAppliedAt: past(1) }]);
    await run();
    const closeCall = JobVacancy.updateMany.mock.calls.find((c) => c[1].$set.closeReason === "inactivity");
    expect(closeCall[0]).toEqual({ _id: { $in: ["old"] } });
    const warnCall = JobVacancy.updateMany.mock.calls.find((c) => c[1].$set.expiryWarnedAt);
    expect(warnCall[0]).toEqual({ _id: { $in: ["warn"] } });
    const titles = createNotificationForUser.mock.calls.map((c) => c[0].title);
    expect(titles).toEqual(["Job listing auto-closed", "Job listing closing soon"]);
    expect(createNotificationForUser.mock.calls[1][0].preferenceKey).toBe("notifyJobExpiring");
  });

  test("WB-EMP-06 a very short window never gives a negative warning lead time", async () => {
    SystemSettings.getSingleton.mockResolvedValue({ autoCloseDays: 2 });
    wireFinds({ active: [{ _id: "a", title: "A", createdAt: past(1.5) }] });
    await run();
    expect(JobVacancy.updateMany.mock.calls.some((c) => c[1].$set.expiryWarnedAt)).toBe(true);
  });

  test("WB-EMP-07 the job list includes applicant counts and cleaned/sorted qualifications; sweeps run before it", async () => {
    wireFinds({ list: [dbJob("a", { qualifications: [{ value: "b", order: 2 }, { value: "a", order: 1 }, { value: "" }, null] }), dbJob("b", { qualifications: undefined })] });
    JobApplication.countDocuments.mockResolvedValueOnce(3).mockResolvedValueOnce(0);
    const { body } = await run();
    expect(body[0]).toMatchObject({ _id: "a", applicantCount: 3 });
    expect(body[0].qualifications.map((q) => q.value)).toEqual(["a", "b"]);
    expect(body[1]).toMatchObject({ applicantCount: 0, qualifications: [] });
  });

  test("WB-EMP-08 failure is a generic 500", async () => {
    JobVacancy.find.mockReturnValue(failingQuery(dbError()));
    const r = await run();
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ message: "Failed to fetch employer jobs" });
  });
});

// ---------------------------------------------------------------------------
describe("getArchivedJobs", () => {
  const run = (q = {}) => call(ctl.getArchivedJobs, ereq({ query: q }));
  const wire = (jobs = [], apps = [], users = []) => {
    JobVacancy.find.mockReturnValue(query(jobs));
    JobApplication.find.mockReturnValue(query(apps));
    User.find.mockReturnValue(query(users));
    archived.buildArchivedItem.mockImplementation((j) => ({ _id: j._id, internal: true }));
    archived.buildStats.mockReturnValue({ s: 1 });
    archived.filterCounts.mockReturnValue({ c: 1 });
    archived.applyListControls.mockImplementation((all) => all);
    archived.stripInternal.mockImplementation((i) => ({ _id: i._id }));
  };

  test.each([[{}, 10, 1], [{ limit: "5", page: "3" }, 5, 3], [{ limit: "999" }, 50, 1], [{ limit: "0", page: "-2" }, 10, 1], [{ limit: "x", page: "y" }, 10, 1]])(
    "WB-EMP-09 paging %j gives limit %i page %i", async (q, limit, page) => {
      wire();
      expect((await run(q)).body).toMatchObject({ limit, page });
    }
  );

  test("WB-EMP-10 filter/sort are whitelisted (unknown falls back); q is cut to 100 chars and must be a string", async () => {
    wire();
    await run({ filter: "filled", sort: "oldest", q: "x".repeat(300) });
    expect(archived.applyListControls).toHaveBeenLastCalledWith(expect.anything(), { filter: "filled", sort: "oldest", q: "x".repeat(100) });
    await run({ filter: "constructor", sort: "bogus", q: ["a"] });
    expect(archived.applyListControls).toHaveBeenLastCalledWith(expect.anything(), { filter: "all", sort: "recent", q: "" });
  });

  test("WB-EMP-11 the query is scoped to the signed-in employer; no jobs means no application lookup", async () => {
    wire();
    await run();
    expect(JobVacancy.find.mock.calls[0][0]).toEqual({ employer: EMP, $or: [{ archived: true }, { status: "closed" }] });
    expect(JobApplication.find).not.toHaveBeenCalled();
    expect(User.find).not.toHaveBeenCalled();
  });

  test("WB-EMP-12 applications are grouped per job, withdrawn are excluded, only HIRED applicants' names are looked up (distinct)", async () => {
    wire([{ _id: "j1" }, { _id: "j2" }], [
      { vacancy: "j1", applicant: "a1", status: "hired" }, { vacancy: "j1", applicant: "a1", status: "Accepted" },
      { vacancy: "j1", applicant: "a2", status: "pending" }, { vacancy: "j2", applicant: "a3" },
    ], [{ _id: "a1", name: "A" }]);
    await run();
    expect(JobApplication.find.mock.calls[0][0]).toEqual({ vacancy: { $in: ["j1", "j2"] }, status: { $ne: "withdrawn" } });
    expect(User.find).toHaveBeenCalledWith({ _id: { $in: ["a1"] } });
    expect(archived.buildArchivedItem.mock.calls[0][1]).toHaveLength(3);
    expect(archived.buildArchivedItem.mock.calls[1][1]).toHaveLength(1);
  });

  test("WB-EMP-13 no hired applicants skips the user lookup; the page is sliced and sent with stats, counts and no-store caching", async () => {
    wire(Array.from({ length: 25 }, (_, i) => ({ _id: `j${i}` })), [{ vacancy: "j0", applicant: "a", status: "pending" }]);
    const { body, res } = await run({ limit: "10", page: "3" });
    expect(User.find).not.toHaveBeenCalled();
    expect(body.items).toHaveLength(5);
    expect(body).toMatchObject({ total: 25, stats: { s: 1 }, counts: { c: 1 } });
    expect(res.set).toHaveBeenCalledWith("Cache-Control", "no-store");
  });

  test("WB-EMP-14 failure is a generic 500", async () => {
    JobVacancy.find.mockReturnValue(failingQuery(dbError()));
    expect((await run()).body).toEqual({ message: "Failed to fetch archived jobs" });
  });
});

// ---------------------------------------------------------------------------
describe("createJob", () => {
  const good = { title: " Welder ", location: " Boac ", description: " Weld things " };
  const run = (b) => call(ctl.createJob, ereq({ body: b }));
  const created = () => JobVacancy.create.mockImplementation(async (d) => ({ _id: "j1", title: d.title, toObject: () => ({ ...d, _id: "j1" }) }));
  const arg = () => JobVacancy.create.mock.calls[0][0];

  test.each([[{ ...good, title: "" }], [{ ...good, location: undefined }], [{ ...good, description: "" }]])("WB-EMP-15 missing required field %j is 400", async (b) => {
    expect((await run(b)).status).toBe(400);
    expect(JobVacancy.create).not.toHaveBeenCalled();
  });

  test("WB-EMP-16 qualifications: JSON string parsed; invalid JSON and non-arrays are 400; object arrays pass", async () => {
    created();
    expect((await run({ ...good, qualifications: "{bad" })).body.message).toBe("Invalid qualifications format");
    expect((await run({ ...good, qualifications: JSON.stringify({ a: 1 }) })).body.message).toBe("Qualifications must be an array");
    expect((await run({ ...good, qualifications: { a: 1 } })).status).toBe(400);
    expect((await run({ ...good, qualifications: JSON.stringify([{ type: "education", value: "BS" }]) })).status).toBe(201);
    expect((await run({ ...good, qualifications: [{ type: "education", value: "BS", order: 5 }, { type: "license", value: "L" }] })).status).toBe(201);
    expect(JobVacancy.create.mock.calls[1][0].qualifications).toEqual([{ type: "education", value: "BS", order: 5 }, { type: "license", value: "L", order: 1 }]);
  });

  test("WB-EMP-17 at most 8 skill-type qualifications (skill, other, or untyped); other types do not count", async () => {
    created();
    const skills = (n, type) => Array.from({ length: n }, (_, i) => ({ type, value: `s${i}` }));
    expect((await run({ ...good, qualifications: skills(8, "skill") })).status).toBe(201);
    const r = await run({ ...good, qualifications: skills(9, "skill") });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("You can add up to 8 skills");
    expect((await run({ ...good, qualifications: skills(9, "other") })).status).toBe(400);
    expect((await run({ ...good, qualifications: skills(9, undefined) })).status).toBe(400);
    expect((await run({ ...good, qualifications: [...skills(8, "skill"), ...skills(5, "education")] })).status).toBe(201);
    expect((await run({ ...good, qualifications: [{ type: " SKILL ", value: "x" }, ...skills(8, "skill")] })).status).toBe(400);
  });

  test("WB-EMP-18 salary: non-numeric min/max and min greater than max are 400; clearing with null/'' is allowed", async () => {
    created();
    expect((await run({ ...good, salaryMin: "abc" })).body.message).toBe("Salary minimum must be a number");
    expect((await run({ ...good, salaryMax: "abc" })).body.message).toBe("Salary maximum must be a number");
    expect((await run({ ...good, salaryMin: 30000, salaryMax: 20000 })).body.message).toBe("Salary minimum cannot be greater than salary maximum");
    expect((await run({ ...good, salaryMin: "", salaryMax: null })).status).toBe(201);
  });

  test.each([
    [{ salaryMin: 15000, salaryMax: 25000 }, "PHP 15,000 - PHP 25,000"], [{ salaryMin: 20000, salaryMax: 20000 }, "PHP 20,000"],
    [{ salaryMin: 15000 }, "PHP 15,000"], [{ salaryMax: 25000 }, "PHP 25,000"], [{}, ""], [{ salary: "  Negotiable " }, "Negotiable"],
  ])("WB-EMP-19 salary display for %j is %p", async (extra, display) => {
    created();
    await run({ ...good, ...extra });
    expect(arg().salary).toBe(display);
  });

  test("WB-EMP-20 salaryMin/Max default to null when omitted", async () => {
    created();
    await run(good);
    expect(arg()).toMatchObject({ salaryMin: null, salaryMax: null });
  });

  test.each([
    [{ minAge: 14 }, "Minimum age cannot be below 15"], [{ minAge: "abc" }, "Minimum age cannot be below 15"], [{ maxAge: "abc" }, "Maximum age must be a number"],
    [{ minAge: 40, maxAge: 30 }, "Minimum age cannot be greater than maximum age"], [{ minExperienceYears: -1 }, "Minimum experience must be zero or a positive number"],
    [{ minExperienceYears: "abc" }, "Minimum experience must be zero or a positive number"],
  ])("WB-EMP-21 basic requirement %j is rejected: %s", async (extra, message) => {
    expect((await run({ ...good, ...extra })).body.message).toBe(message);
  });

  test("WB-EMP-22 valid basic requirements: blanks clear, education level whitelisted, language rows cleaned", async () => {
    created();
    await run({
      ...good, minAge: "", maxAge: 60, minExperienceYears: "2", minEducationLevel: "College Graduate", educationOrEquivalentExperience: 1,
      languageRequirements: [{ language: " English ", read: 1, required: false }, { language: "" }, null, { language: "Tagalog" }],
    });
    expect(arg()).toMatchObject({
      minAge: null, maxAge: 60, minExperienceYears: 2, minEducationLevel: "College Graduate", educationOrEquivalentExperience: true,
      languageRequirements: [
        { language: "English", read: true, write: false, speak: false, understand: false, required: false },
        { language: "Tagalog", read: false, write: false, speak: false, understand: false, required: true },
      ],
    });
    JobVacancy.create.mockClear();
    await run({ ...good, minEducationLevel: "PhD in Welding", languageRequirements: "not an array" });
    expect(arg()).toMatchObject({ minEducationLevel: null, languageRequirements: [] });
  });

  test("WB-EMP-23 defaults and normalisation: trimmed text, Full-time, 1 slot, deadline date, industries de-duplicated, work nature whitelisted, active + owned", async () => {
    created();
    await run({ ...good, slots: "0", industry: [" IT ", "IT", "", "BPO"], workNature: "remote", applicationDeadline: "2030-01-01" });
    expect(arg()).toMatchObject({ title: "Welder", location: "Boac", description: "Weld things", jobType: "Full-time", slots: 1, industry: ["IT", "BPO"], workNature: "remote", status: "active", isActive: true, employer: EMP });
    expect(arg().applicationDeadline).toBeInstanceOf(Date);
    JobVacancy.create.mockClear();
    await run({ ...good, slots: "5", jobType: "Part-time", industry: "IT", workNature: "anywhere" });
    expect(arg()).toMatchObject({ slots: 5, jobType: "Part-time", industry: ["IT"], workNature: null, applicationDeadline: null });
    JobVacancy.create.mockClear();
    await run({ ...good, industry: undefined });
    expect(arg().industry).toEqual([]);
  });

  test("WB-EMP-24 success is 201 with sorted qualifications and an audit entry; failure is a generic 500", async () => {
    created();
    const r = await run(good);
    expect(r.status).toBe(201);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "employer.job.created", metadata: { title: "Welder" } }));
    JobVacancy.create.mockRejectedValue(dbError());
    const bad = await run(good);
    expect(bad.status).toBe(500);
    expect(bad.body).toEqual({ message: "Failed to create job" });
  });
});

// ---------------------------------------------------------------------------
describe("updateJob / applyJobUpdate", () => {
  const mkJob = (o = {}) => {
    const j = { _id: "j1", employer: EMP, title: "Old", salaryMin: 10000, salaryMax: 20000, status: "active", isActive: true, save: jest.fn().mockResolvedValue(), ...o };
    j.toObject = () => ({ ...j, qualifications: j.qualifications });
    return j;
  };
  const run = (body, job = mkJob()) => {
    JobVacancy.findById.mockResolvedValue(job);
    return call(ctl.updateJob, ereq({ params: { id: "j1" }, body })).then((r) => ({ ...r, job }));
  };

  test("WB-EMP-25 unknown 404; someone else's job 403 (nothing changed)", async () => {
    JobVacancy.findById.mockResolvedValue(null);
    expect((await call(ctl.updateJob, ereq({ params: { id: "j1" }, body: {} }))).status).toBe(404);
    const other = mkJob({ employer: "other" });
    const r = await run({ title: "Hack" }, other);
    expect(r.status).toBe(403);
    expect(other.title).toBe("Old");
    expect(other.save).not.toHaveBeenCalled();
  });

  test("WB-EMP-26 only whitelisted fields are assigned; unknown fields (e.g. employer, isFeatured) are ignored", async () => {
    const { job } = await run({ title: "New", location: "L", description: "D", jobType: "Part-time", slots: 3, applicationDeadline: "2030-01-01", employer: "hijack", isFeatured: true });
    expect(job).toMatchObject({ title: "New", location: "L", description: "D", jobType: "Part-time", slots: 3, employer: EMP });
    expect(job.isFeatured).toBeUndefined();
    expect(job.updatedAt).toBeInstanceOf(Date);
  });

  test("WB-EMP-27 qualifications: invalid JSON / non-array / >8 skills are 400; valid are normalised with order", async () => {
    expect((await run({ qualifications: "{bad" })).body.message).toBe("Invalid qualifications format");
    expect((await run({ qualifications: "{}" })).body.message).toBe("Qualifications must be an array");
    expect((await run({ qualifications: Array.from({ length: 9 }, () => ({ type: "skill", value: "x" })) })).body.message).toBe("You can add up to 8 skills");
    const ok = await run({ qualifications: JSON.stringify([{ type: "license", value: "L" }]) });
    expect(ok.job.qualifications).toEqual([{ type: "license", value: "L", order: 0 }]);
  });

  test("WB-EMP-28 industry and work nature: arrays de-duplicated, work nature whitelisted", async () => {
    const { job } = await run({ industry: "IT", workNature: "hybrid" });
    expect(job).toMatchObject({ industry: ["IT"], workNature: "hybrid" });
    const bad = await run({ industry: ["A", "A"], workNature: "moon" });
    expect(bad.job).toMatchObject({ industry: ["A"], workNature: null });
  });

  test("WB-EMP-29 salary: non-numeric rejected; the merged range is validated against the EXISTING other bound; display regenerated unless given", async () => {
    expect((await run({ salaryMin: "x" })).body.message).toBe("Salary minimum must be a number");
    expect((await run({ salaryMax: "x" })).body.message).toBe("Salary maximum must be a number");
    expect((await run({ salaryMin: 30000 })).body.message).toBe("Salary minimum cannot be greater than salary maximum");
    const ok = await run({ salaryMax: 40000 });
    expect(ok.job).toMatchObject({ salaryMin: 10000, salaryMax: 40000, salary: "PHP 10,000 - PHP 40,000" });
    const explicit = await run({ salaryMax: 40000, salary: "  Competitive " });
    expect(explicit.job.salary).toBe("Competitive");
    const cleared = await run({ salaryMin: null, salaryMax: "" });
    expect(cleared.job).toMatchObject({ salaryMin: null, salaryMax: null, salary: "" });
    const untouched = await run({ title: "x" });
    expect(untouched.job.salary).toBeUndefined();
  });

  test("WB-EMP-30 basic requirements are validated against the merged (new + existing) values", async () => {
    const j = mkJob({ minAge: 30, maxAge: 50 });
    expect((await run({ maxAge: 20 }, j)).body.message).toBe("Minimum age cannot be greater than maximum age");
    const j2 = mkJob({ minAge: 20 });
    const ok = await run({ minAge: 25, minEducationLevel: "College Graduate" }, j2);
    expect(ok.job).toMatchObject({ minAge: 25, minEducationLevel: "College Graduate" });
    expect((await run({ minExperienceYears: -1 })).status).toBe(400);
    expect((await run({ minAge: 10 })).body.message).toBe("Minimum age cannot be below 15");
  });

  test("WB-EMP-31 status closed/active toggles isActive; other statuses leave it", async () => {
    expect((await run({ status: "closed" })).job.isActive).toBe(false);
    expect((await run({ status: "active" }, mkJob({ isActive: false }))).job.isActive).toBe(true);
    expect((await run({ status: "draft" })).job.isActive).toBe(true);
  });

  test("WB-EMP-32 KNOWN-ISSUE: `status` is assigned straight from the body, so an employer can RE-OPEN a job that an admin closed (closedBy 'admin') just by sending status 'active'; the value is also not validated here", async () => {
    const adminClosed = mkJob({ status: "closed", isActive: false, closedBy: "admin", closeReason: "admin" });
    const r = await run({ status: "active" }, adminClosed);
    expect(r.status).toBe(200);
    expect(adminClosed).toMatchObject({ status: "active", isActive: true, closedBy: "admin" });
    const weird = await run({ status: "anything-at-all" });
    expect(weird.job.status).toBe("anything-at-all");
  });

  test("WB-EMP-33 success returns the saved job with cleaned qualifications and audits with the caller's role; applyJobUpdate can be used by admins directly", async () => {
    const j = mkJob({ qualifications: [{ value: "b", order: 2 }, { value: "a", order: 1 }] });
    const { body } = await run({ title: "T" }, j);
    expect(body.qualifications.map((q) => q.value)).toEqual(["a", "b"]);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ actorRole: "employer", action: "employer.job.updated" }));
    const res = makeRes();
    await ctl.applyJobUpdate(makeReq({ user: { id: "adm", role: "admin" }, body: { title: "X" } }), res, mkJob(), "admin", "admin.job.updated");
    expect(logAuditEvent).toHaveBeenLastCalledWith(expect.objectContaining({ actorRole: "admin", action: "admin.job.updated" }));
  });

  test("WB-EMP-34 a save failure is a generic 500", async () => {
    const j = mkJob();
    j.save.mockRejectedValue(dbError());
    const r = await run({ title: "T" }, j);
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ message: "Failed to update job" });
  });
});

// ---------------------------------------------------------------------------
describe("deleteJob", () => {
  const run = () => call(ctl.deleteJob, ereq({ params: { id: "j1" } }));

  test("WB-EMP-35 unknown 404; someone else's 403 (nothing deleted)", async () => {
    JobVacancy.findById.mockResolvedValue(null);
    expect((await run()).status).toBe(404);
    JobVacancy.findById.mockResolvedValue({ employer: "other" });
    expect((await run()).status).toBe(403);
    expect(JobApplication.deleteMany).not.toHaveBeenCalled();
  });

  test("WB-EMP-36 the owner permanently deletes the job and all its applications, with a warning-level audit; failure is a generic 500", async () => {
    JobVacancy.findById.mockResolvedValue({ _id: "j1", employer: EMP, title: "Welder" });
    JobApplication.deleteMany.mockResolvedValue();
    JobVacancy.findByIdAndDelete.mockResolvedValue();
    const r = await run();
    expect(JobApplication.deleteMany).toHaveBeenCalledWith({ vacancy: "j1" });
    expect(JobVacancy.findByIdAndDelete).toHaveBeenCalledWith("j1");
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "employer.job.deleted", severity: "warning", metadata: { title: "Welder" } }));
    expect(r.body).toEqual({ message: "Job permanently deleted" });
    JobApplication.deleteMany.mockRejectedValue(dbError());
    expect((await run()).body).toEqual({ message: "Failed to delete job" });
  });
});

// ---------------------------------------------------------------------------
describe("getApplicantsForJob", () => {
  const run = () => call(ctl.getApplicantsForJob, ereq({ params: { jobId: "j1" } }));
  const app = (applicant, o = {}) => ({ applicant, includePhoto: false, toObject() { return { _id: "a", applicant: this.applicant ? { ...this.applicant } : this.applicant, includePhoto: this.includePhoto }; }, ...o });

  test("WB-EMP-37 unknown 404; not the job's employer 403", async () => {
    JobVacancy.findById.mockResolvedValue(null);
    expect((await run()).status).toBe(404);
    JobVacancy.findById.mockResolvedValue({ employer: "other" });
    expect((await run()).status).toBe(403);
  });

  test("WB-EMP-38 suspended/deleted applicants are hidden; remaining applicants are projected with their profile and photo consent", async () => {
    JobVacancy.findById.mockResolvedValue({ employer: EMP });
    JobApplication.find.mockReturnValue(query([app({ _id: "u1", isActive: true }, { includePhoto: true }), app({ _id: "u2", isActive: false }), app(null), app({ _id: "u3" })]));
    JobseekerProfile.find.mockResolvedValue([{ userId: "u1", p: 1 }]);
    const { body } = await run();
    expect(body).toHaveLength(2);
    expect(body[0].applicant).toMatchObject({ projected: true, id: "u1", hasProfile: true, includePhoto: true });
    expect(body[1].applicant).toMatchObject({ id: "u3", hasProfile: false, includePhoto: false });
    expect(JobseekerProfile.find).toHaveBeenCalledWith({ userId: { $in: ["u1", "u3"] } });
  });

  test("WB-EMP-39 failure is a generic 500", async () => {
    JobVacancy.findById.mockRejectedValue(dbError());
    expect((await run()).body).toEqual({ message: "Failed to fetch applicants" });
  });
});

// ---------------------------------------------------------------------------
describe("updateApplicationStatus", () => {
  const mkApp = (o = {}) => ({
    _id: "app1", status: "pending", vacancy: { title: "Welder", employer: EMP }, applicant: { _id: "app-user", name: "Ann" },
    save: jest.fn().mockResolvedValue(), ...o,
  });
  const wire = (application, updated) => {
    JobApplication.findById
      .mockReturnValueOnce({ populate: jest.fn(() => ({ populate: jest.fn().mockResolvedValue(application) })) })
      .mockReturnValueOnce({ populate: jest.fn(() => ({ populate: jest.fn().mockResolvedValue(updated === undefined ? { toObject: () => ({ applicant: { _id: "app-user" } }) } : updated) })) });
    const conv = { _id: "c1", save: jest.fn().mockResolvedValue() };
    ensureConversationBetweenUsers.mockResolvedValue(conv);
    Message.create.mockResolvedValue({ _id: "m1", content: "x", createdAt: "t" });
    JobseekerProfile.findOne.mockResolvedValue({ p: 1 });
    return conv;
  };
  const run = (body, over = {}) => call(ctl.updateApplicationStatus, ereq({ params: { applicationId: "app1" }, body, ...over }));

  test.each([[undefined], [""], ["Hired"], ["accepted"], ["withdrawn"], ["constructor"]])("WB-EMP-40 invalid status %p is 400 before any lookup", async (status) => {
    const r = await run({ status });
    expect(r.status).toBe(400);
    expect(JobApplication.findById).not.toHaveBeenCalled();
  });

  test("WB-EMP-41 unknown application 404; vacancy missing or owned by someone else 403 (nothing saved)", async () => {
    wire(null);
    expect((await run({ status: "hired" })).status).toBe(404);
    const noVacancy = mkApp({ vacancy: null });
    wire(noVacancy);
    expect((await run({ status: "hired" })).status).toBe(403);
    const other = mkApp({ vacancy: { employer: "other" } });
    wire(other);
    expect((await run({ status: "hired" })).status).toBe(403);
    expect(other.save).not.toHaveBeenCalled();
  });

  test.each([
    ["under_review", "employer.application.under_review", "info", true], ["shortlisted", "employer.application.shortlisted", "info", true],
    ["approved", "employer.application.approved", "info", true], ["rejected", "employer.application.rejected", "info", true],
    ["hired", "employer.application.hired", "warning", true], ["pending", "employer.application.status_updated", "info", false],
  ])("WB-EMP-42 status %s: audit %s (%s), automated message sent=%p", async (status, action, severity, messaged) => {
    const a = mkApp();
    wire(a);
    const r = await run({ status });
    expect(a.status).toBe(status);
    expect(a.statusUpdatedAt).toBeInstanceOf(Date);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action, severity, metadata: { status, jobTitle: "Welder" } }));
    expect(createNotificationForUser).toHaveBeenCalledWith(expect.objectContaining({ recipientId: "app-user", preferenceKey: "notifyApplicationUpdate", message: `Your application for Welder is now ${status}.` }));
    expect(Message.create).toHaveBeenCalledTimes(messaged ? 1 : 0);
    expect(r.body.applicant).toMatchObject({ projected: true });
  });

  test.each([
    ["under_review", /impressed/], ["shortlisted", /shortlisted/], ["approved", /has been approved/], ["hired", /Congratulations, Ann/], ["rejected", /Unfortunately/],
  ])("WB-EMP-43 automated message for %s", async (status, pattern) => {
    wire(mkApp());
    await run({ status });
    expect(Message.create.mock.calls[0][0].content).toMatch(pattern);
    expect(Message.create.mock.calls[0][0]).toMatchObject({ conversationId: "c1", sender: EMP, isRead: false });
  });

  test("WB-EMP-44 the employer note is stored only when it is a string; the conversation preview and a live socket push are updated", async () => {
    const a = mkApp({ employerNote: "keep" });
    const conv = wire(a);
    const io = mkIo();
    await run({ status: "shortlisted", employerNote: 123 }, { app: { get: jest.fn(() => io) } });
    expect(a.employerNote).toBe("keep");
    expect(conv.lastMessage).toBe("x");
    expect(conv.save).toHaveBeenCalled();
    expect(io.to).toHaveBeenCalledWith("c1");
    expect(io.emit).toHaveBeenCalledWith("receive_message", expect.objectContaining({ conversationId: "c1", sender: EMP }));
    const b = mkApp();
    wire(b);
    await run({ status: "shortlisted", employerNote: "good fit" });
    expect(b.employerNote).toBe("good fit");
  });

  test("WB-EMP-45 missing names/titles get friendly fallbacks", async () => {
    wire(mkApp({ applicant: { _id: "u" }, vacancy: { employer: EMP } }));
    await run({ status: "approved" });
    expect(createNotificationForUser.mock.calls[0][0].message).toBe("Your application for this job is now approved.");
    expect(Message.create.mock.calls[0][0].content).toContain("Great news, there!");
    expect(Message.create.mock.calls[0][0].content).toContain("this role");
  });

  test("WB-EMP-46 audit, notification and auto-message failures are best-effort: still 200", async () => {
    wire(mkApp());
    logAuditEvent.mockRejectedValue(new Error("a"));
    createNotificationForUser.mockRejectedValue(new Error("b"));
    ensureConversationBetweenUsers.mockRejectedValue(new Error("c"));
    expect((await run({ status: "hired" })).status).toBe(200);
  });

  test("WB-EMP-47 an updated record with no applicant skips the profile fetch", async () => {
    wire(mkApp(), { toObject: () => ({ applicant: null }) });
    await run({ status: "pending" });
    expect(JobseekerProfile.findOne).not.toHaveBeenCalled();
  });

  test("WB-EMP-48 KNOWN-ISSUE: there is no state machine, so an application the jobseeker WITHDREW (or one already hired/rejected) can be moved to any status, e.g. withdrawn -> hired", async () => {
    const withdrawn = mkApp({ status: "withdrawn" });
    wire(withdrawn);
    expect((await run({ status: "hired" })).status).toBe(200);
    expect(withdrawn.status).toBe("hired");
  });

  test("WB-EMP-49 a save failure is a generic 500", async () => {
    const a = mkApp();
    a.save.mockRejectedValue(dbError());
    wire(a);
    expect((await run({ status: "hired" })).body).toEqual({ message: "Failed to update application status" });
  });
});

// ---------------------------------------------------------------------------
describe("interviews", () => {
  const body = (o = {}) => ({ scheduledAt: future(), mode: "online", location: "https://meet.example/x", notes: " bring ID ", ...o });
  const mkApp = (o = {}) => ({
    _id: "app1", status: "shortlisted", vacancy: { title: "Welder", employer: EMP }, applicant: { _id: "app-user", name: "Ann" },
    save: jest.fn().mockResolvedValue(), ...o,
  });
  const wireOne = (a) => {
    JobApplication.findById.mockReturnValue({ populate: jest.fn(() => ({ populate: jest.fn().mockResolvedValue(a) })) });
    const conv = { _id: "c1", save: jest.fn().mockResolvedValue() };
    ensureConversationBetweenUsers.mockResolvedValue(conv);
    Message.create.mockResolvedValue({ _id: "m1", content: "msg", createdAt: "t" });
    return conv;
  };
  const wireMany = (apps) => {
    JobApplication.find.mockReturnValue({ populate: jest.fn(() => ({ populate: jest.fn().mockResolvedValue(apps) })) });
    ensureConversationBetweenUsers.mockResolvedValue({ _id: "c1", save: jest.fn().mockResolvedValue() });
    Message.create.mockResolvedValue({ _id: "m1", content: "msg", createdAt: "t" });
  };
  const one = (b, over = {}) => call(ctl.scheduleInterview, ereq({ params: { applicationId: "app1" }, body: b, ...over }));
  const many = (b, over = {}) => call(ctl.bulkScheduleInterview, ereq({ body: b, ...over }));

  describe("payload validation (via scheduleInterview)", () => {
    test.each([
      [{ scheduledAt: undefined }, "A valid interview date/time is required"], [{ scheduledAt: "not a date" }, "A valid interview date/time is required"],
      [{ scheduledAt: new Date(Date.now() - 1000).toISOString() }, "Interview date/time must be in the future"],
      [{ mode: "phone" }, "Interview mode must be 'onsite' or 'online'"], [{ mode: undefined }, "Interview mode must be 'onsite' or 'online'"],
      [{ location: "" }, "A meeting link is required"], [{ location: "   " }, "A meeting link is required"],
      [{ mode: "onsite", location: "" }, "A location is required"],
    ])("WB-EMP-50 %j is 400: %s", async (o, message) => {
      const r = await one(body(o));
      expect(r.status).toBe(400);
      expect(r.body.message).toBe(message);
      expect(JobApplication.findById).not.toHaveBeenCalled();
    });

    test("WB-EMP-51 KNOWN-ISSUE: a non-string truthy `location` (e.g. a number) throws inside validation and is a generic 500 instead of a 400", async () => {
      const r = await one(body({ location: 12345 }));
      expect(r.status).toBe(500);
    });
  });

  describe("scheduleInterview", () => {
    test("WB-EMP-52 unknown 404; not your job 403; closed applications are refused with their status named", async () => {
      wireOne(null);
      expect((await one(body())).status).toBe(404);
      wireOne(mkApp({ vacancy: { employer: "other" } }));
      expect((await one(body())).status).toBe(403);
      wireOne(mkApp({ vacancy: null }));
      expect((await one(body())).status).toBe(403);
      for (const status of ["rejected", "Rejected", "hired", "Accepted", "withdrawn"]) {
        wireOne(mkApp({ status }));
        const r = await one(body());
        expect(r.status).toBe(400);
        expect(r.body.message).toBe(`Cannot schedule an interview — this application is already ${status.toLowerCase()}`);
      }
    });

    test("WB-EMP-53 success: interview saved (trimmed), applicant notified as 'scheduled', message posted with the link and notes", async () => {
      const a = mkApp();
      wireOne(a);
      const r = await one(body());
      expect(a.interview).toMatchObject({ mode: "online", location: "https://meet.example/x", notes: "bring ID", scheduledBy: EMP });
      expect(a.interview.scheduledAt).toBeInstanceOf(Date);
      expect(createNotificationForUser).toHaveBeenCalledWith(expect.objectContaining({ title: "Interview scheduled", recipientId: "app-user", preferenceKey: "notifyApplicationUpdate" }));
      const content = Message.create.mock.calls[0][0].content;
      expect(content).toContain("Online — join here: https://meet.example/x");
      expect(content).toContain("bring ID");
      expect(content).not.toContain("now re");
      expect(r.body).toBe(a);
    });

    test("WB-EMP-54 rescheduling (an interview already set) is labelled as such; onsite wording; notes optional; non-string notes become empty", async () => {
      const a = mkApp({ interview: { scheduledAt: new Date() } });
      wireOne(a);
      await one(body({ mode: "onsite", location: "Boac PESO", notes: undefined }));
      expect(createNotificationForUser.mock.calls[0][0].title).toBe("Interview rescheduled");
      const content = Message.create.mock.calls[0][0].content;
      expect(content).toContain("now rescheduled");
      expect(content).toContain("Onsite at: Boac PESO");
      expect(a.interview.notes).toBe("");
      const b = mkApp();
      wireOne(b);
      await one(body({ notes: 42 }));
      expect(b.interview.notes).toBe("");
    });

    test("WB-EMP-55 a live socket gets the message; missing names fall back; notification/message failures are best-effort", async () => {
      const a = mkApp({ applicant: { _id: "u" }, vacancy: { employer: EMP } });
      const conv = wireOne(a);
      const io = mkIo();
      await one(body(), { app: { get: jest.fn(() => io) } });
      expect(io.emit).toHaveBeenCalledWith("receive_message", expect.objectContaining({ conversationId: "c1" }));
      expect(conv.lastMessage).toBe("msg");
      expect(Message.create.mock.calls[0][0].content).toContain("Hi there");
      wireOne(mkApp());
      createNotificationForUser.mockRejectedValue(new Error("x"));
      ensureConversationBetweenUsers.mockRejectedValue(new Error("y"));
      expect((await one(body())).status).toBe(200);
    });

    test("WB-EMP-56 a save failure is a generic 500", async () => {
      const a = mkApp();
      a.save.mockRejectedValue(dbError());
      wireOne(a);
      expect((await one(body())).body).toEqual({ message: "Failed to schedule interview" });
    });
  });

  describe("bulkScheduleInterview", () => {
    test.each([[undefined], [[]], ["a1"]])("WB-EMP-57 applicationIds %p is 400", async (ids) => {
      expect((await many({ ...body(), applicationIds: ids })).body.message).toBe("applicationIds must be a non-empty array");
    });

    test("WB-EMP-58 the interview payload is validated before any lookup", async () => {
      expect((await many({ ...body({ mode: "x" }), applicationIds: ["a"] })).status).toBe(400);
      expect(JobApplication.find).not.toHaveBeenCalled();
    });

    test("WB-EMP-59 applications of OTHER employers are silently excluded; none owned is 403", async () => {
      wireMany([mkApp({ vacancy: { employer: "other" } }), mkApp({ vacancy: null })]);
      expect((await many({ ...body(), applicationIds: ["a", "b"] })).status).toBe(403);
    });

    test("WB-EMP-60 closed applications are skipped and counted; if all are closed it is 400", async () => {
      const ok = mkApp();
      wireMany([ok, mkApp({ status: "hired" }), mkApp({ status: "rejected" }), mkApp({ vacancy: { employer: "other" } })]);
      const r = await many({ ...body(), applicationIds: ["a", "b", "c", "d"] });
      expect(r.body).toEqual({ updated: 1, skipped: 2 });
      expect(ok.interview).toBeDefined();
      wireMany([mkApp({ status: "hired" })]);
      const bad = await many({ ...body(), applicationIds: ["a"] });
      expect(bad.status).toBe(400);
      expect(bad.body.message).toBe("All selected applicants are already hired or rejected");
    });

    test("WB-EMP-61 failure is a generic 500", async () => {
      JobApplication.find.mockImplementation(() => { throw dbError(); });
      expect((await many({ ...body(), applicationIds: ["a"] })).body).toEqual({ message: "Failed to schedule interviews" });
    });
  });

  describe("markInterviewNoShow", () => {
    const run = (over = {}) => call(ctl.markInterviewNoShow, ereq({ params: { applicationId: "app1" }, ...over }));
    const pastInterview = () => ({ scheduledAt: new Date(Date.now() - 3600000) });

    test("WB-EMP-62 guard order: unknown 404; not your job 403; no interview 400; interview in the future 400; already rejected/hired 400", async () => {
      wireOne(null);
      expect((await run()).status).toBe(404);
      wireOne(mkApp({ vacancy: { employer: "other" }, interview: pastInterview() }));
      expect((await run()).status).toBe(403);
      wireOne(mkApp({ interview: undefined }));
      expect((await run()).body.message).toBe("This applicant has no scheduled interview");
      wireOne(mkApp({ interview: {} }));
      expect((await run()).status).toBe(400);
      wireOne(mkApp({ interview: { scheduledAt: new Date(Date.now() + 3600000) } }));
      expect((await run()).body.message).toBe("The scheduled interview hasn't happened yet");
      for (const status of ["rejected", "hired"]) {
        wireOne(mkApp({ status, interview: pastInterview() }));
        expect((await run()).body.message).toBe(`This application is already ${status}`);
      }
    });

    test("WB-EMP-63 success: rejected with the no-show flag, applicant notified and messaged (live push when a socket exists), best-effort", async () => {
      const a = mkApp({ interview: pastInterview() });
      const conv = wireOne(a);
      const io = mkIo();
      const r = await run({ app: { get: jest.fn(() => io) } });
      expect(a).toMatchObject({ status: "rejected" });
      expect(a.interview.noShow).toBe(true);
      expect(createNotificationForUser).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ reason: "interview_no_show" }) }));
      expect(Message.create.mock.calls[0][0].content).toContain("expecting you at your scheduled interview");
      expect(io.emit).toHaveBeenCalled();
      expect(conv.save).toHaveBeenCalled();
      expect(r.body).toBe(a);
      wireOne(mkApp({ interview: pastInterview(), applicant: undefined, vacancy: { employer: EMP } }));
      createNotificationForUser.mockRejectedValue(new Error("x"));
      ensureConversationBetweenUsers.mockRejectedValue(new Error("y"));
      expect((await run()).status).toBe(200);
    });

    test("WB-EMP-64 a save failure is a generic 500", async () => {
      const a = mkApp({ interview: pastInterview() });
      a.save.mockRejectedValue(dbError());
      wireOne(a);
      expect((await run()).body).toEqual({ message: "Failed to mark interview as a no-show" });
    });
  });
});

// ---------------------------------------------------------------------------
describe("employer statistics", () => {
  const wireSweeps = (jobs) => {
    JobVacancy.find.mockReturnValueOnce(query([])).mockReturnValueOnce(query([])).mockReturnValueOnce(query(jobs));
  };

  test("WB-EMP-65 getEmployerStats: totals, status-specific counts (including legacy 'Applied'/'Accepted') and active vs closed jobs", async () => {
    wireSweeps([{ _id: "a", status: "active" }, { _id: "b", status: "closed" }, { _id: "c", status: "draft" }]);
    JobApplication.countDocuments.mockResolvedValueOnce(10).mockResolvedValueOnce(4).mockResolvedValueOnce(3).mockResolvedValueOnce(2);
    const { body } = await call(ctl.getEmployerStats, ereq());
    expect(body).toEqual({ totalJobs: 3, activeJobs: 2, totalApplicants: 10, pendingReview: 4, shortlisted: 3, hired: 2 });
    expect(JobApplication.countDocuments.mock.calls[1][0].status).toEqual({ $in: ["pending", "Applied"] });
    expect(JobApplication.countDocuments.mock.calls[3][0].status).toEqual({ $in: ["hired", "Accepted"] });
  });

  test("WB-EMP-66 getEmployerProfileStats: active/closed split; failures are generic 500s", async () => {
    wireSweeps([{ _id: "a", status: "active" }, { _id: "b", status: "closed" }]);
    JobApplication.countDocuments.mockResolvedValue(7);
    expect((await call(ctl.getEmployerProfileStats, ereq())).body).toEqual({ activeJobs: 1, totalApplicants: 7, closedJobs: 1 });
    JobVacancy.find.mockReturnValue(failingQuery(dbError()));
    expect((await call(ctl.getEmployerProfileStats, ereq())).body).toEqual({ message: "Failed to fetch employer profile stats" });
    expect((await call(ctl.getEmployerStats, ereq())).body).toEqual({ message: "Failed to fetch employer stats" });
  });
});

// ---------------------------------------------------------------------------
describe("bulkUpdateApplicationStatuses", () => {
  const mkApp = (id, o = {}) => ({
    _id: id, status: "pending", vacancy: { title: "Welder", employer: EMP }, applicant: { _id: `u-${id}`, name: `N${id}` },
    save: jest.fn().mockResolvedValue(), ...o,
  });
  const run = (body, over = {}) => call(ctl.bulkUpdateApplicationStatuses, ereq({ body, ...over }));
  const wire = (apps, refetched) => {
    JobApplication.find.mockReset();
    createNotificationForUser.mockClear();
    Message.create.mockClear();
    logAuditEvent.mockClear();
    JobApplication.find
      .mockReturnValueOnce({ populate: jest.fn(() => ({ populate: jest.fn().mockResolvedValue(apps) })) })
      .mockReturnValueOnce({ populate: jest.fn(() => ({ populate: jest.fn().mockResolvedValue(refetched || apps.map((a) => ({ applicant: { _id: a.applicant._id }, toObject() { return { _id: a._id, applicant: { _id: a.applicant._id } }; } }))) })) });
    ensureConversationBetweenUsers.mockResolvedValue({ _id: "c1", save: jest.fn().mockResolvedValue() });
    Message.create.mockResolvedValue({ _id: "m1", content: "msg", createdAt: "t" });
    JobseekerProfile.find.mockResolvedValue([{ userId: "u-a1", p: 1 }]);
  };

  test.each([[undefined], [[]], ["a1"]])("WB-EMP-67 applicationIds %p is 400", async (ids) => {
    expect((await run({ applicationIds: ids, status: "hired" })).status).toBe(400);
  });

  test("WB-EMP-68 invalid status is 400; nothing found is 404; nothing owned is 403", async () => {
    expect((await run({ applicationIds: ["a1"], status: "bogus" })).body.message).toBe("Invalid status");
    wire([]);
    expect((await run({ applicationIds: ["a1"], status: "hired" })).status).toBe(404);
    wire([mkApp("a1", { vacancy: { employer: "other" } }), mkApp("a2", { vacancy: null })]);
    expect((await run({ applicationIds: ["a1", "a2"], status: "hired" })).status).toBe(403);
  });

  test("WB-EMP-69 only OWNED applications are updated (others in the list are ignored); each gets a notification and an automated message; one bulk audit entry", async () => {
    const mine = mkApp("a1");
    const theirs = mkApp("a2", { vacancy: { employer: "other" } });
    wire([mine, theirs], [{ applicant: { _id: "u-a1" }, toObject: () => ({ _id: "a1", applicant: { _id: "u-a1" } }) }]);
    const r = await run({ applicationIds: ["a1", "a2"], status: "shortlisted", employerNote: "good" });
    expect(mine).toMatchObject({ status: "shortlisted", employerNote: "good" });
    expect(theirs.status).toBe("pending");
    expect(theirs.save).not.toHaveBeenCalled();
    expect(createNotificationForUser).toHaveBeenCalledTimes(1);
    expect(Message.create).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "employer.application.bulk_status_updated", targetId: "bulk", metadata: { status: "shortlisted", count: 1, applicationIds: ["a1"] } }));
    expect(r.body.updated).toBe(1);
    expect(r.body.applications[0].applicant).toMatchObject({ projected: true, hasProfile: true });
  });

  test.each([
    ["under_review", /impressed/], ["shortlisted", /shortlisted/], ["approved", /approved/], ["hired", /Congratulations/], ["rejected", /Unfortunately/],
  ])("WB-EMP-70 automated message text for %s", async (status, pattern) => {
    wire([mkApp("a1")]);
    await run({ applicationIds: ["a1"], status });
    expect(Message.create.mock.calls[0][0].content).toMatch(pattern);
  });

  test("WB-EMP-71 'pending' sends a notification but no automated message; the hired audit is a warning; non-string notes are ignored; names/titles fall back", async () => {
    const a = mkApp("a1", { applicant: { _id: "u" }, vacancy: { employer: EMP }, employerNote: "keep" });
    wire([a]);
    await run({ applicationIds: ["a1"], status: "pending", employerNote: 5 });
    expect(Message.create).not.toHaveBeenCalled();
    expect(a.employerNote).toBe("keep");
    expect(createNotificationForUser.mock.calls[0][0].message).toBe("Your application for this job is now pending.");
    wire([mkApp("a2")]);
    await run({ applicationIds: ["a2"], status: "hired" });
    expect(logAuditEvent.mock.calls[0][0].severity).toBe("warning");
    wire([mkApp("a3", { applicant: { _id: "u" }, vacancy: { employer: EMP } })]);
    await run({ applicationIds: ["a3"], status: "hired" });
    expect(Message.create.mock.calls[0][0].content).toContain("Congratulations, there!");
  });

  test("WB-EMP-72 a live socket receives each automated message", async () => {
    wire([mkApp("a1")]);
    const io = mkIo();
    await run({ applicationIds: ["a1"], status: "hired" }, { app: { get: jest.fn(() => io) } });
    expect(io.emit).toHaveBeenCalledWith("receive_message", expect.objectContaining({ conversationId: "c1" }));
  });

  test("WB-EMP-73 refetched applications without an applicant are returned unshaped", async () => {
    wire([mkApp("a1")], [{ applicant: null, toObject: () => ({ _id: "a1", applicant: null }) }]);
    const { body } = await run({ applicationIds: ["a1"], status: "hired" });
    expect(body.applications[0].applicant).toBeNull();
  });

  test("WB-EMP-74 KNOWN-ISSUE: notifications and messages are NOT best-effort here, so one failing notification returns 500 after the statuses were already saved (the single-update endpoint tolerates this); there is also no cap on applicationIds and no check of the current status", async () => {
    const a = mkApp("a1", { status: "hired" });
    wire([a]);
    createNotificationForUser.mockRejectedValue(new Error("x"));
    const r = await run({ applicationIds: ["a1"], status: "pending" });
    expect(a.status).toBe("pending");
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ message: "Failed to bulk update application statuses" });
  });
});

// ---------------------------------------------------------------------------
describe("getConnectedJobseekerProfile", () => {
  const run = () => call(ctl.getConnectedJobseekerProfile, ereq({ params: { userId: "js1" } }));
  const target = (o = {}) => ({ _id: "js1", role: "jobseeker", isActive: true, dateOfBirth: "d", cover: "c", ...o });
  const wire = (t, { jobs = ["j1"], applied = true, follower = false, tier = "adult", projected = { user: { u: 1 }, profile: { p: 1 } } } = {}) => {
    User.findById.mockResolvedValue(t);
    JobVacancy.find.mockReturnValue(query(jobs));
    JobApplication.exists.mockResolvedValue(applied ? { _id: "a" } : null);
    Follow.exists.mockResolvedValue(follower ? { _id: "f" } : null);
    getAgeTier.mockReturnValue(tier);
    JobseekerProfile.findOne.mockResolvedValue({ p: 1 });
    resolveRelationship.mockResolvedValue({ r: 1 });
    resolveCover.mockResolvedValue("cover");
    projectJobseeker.mockReturnValue(projected);
  };

  test("WB-EMP-75 unknown, non-jobseeker and deactivated targets are 404", async () => {
    wire(null);
    expect((await run()).status).toBe(404);
    wire(target({ role: "employer" }));
    expect((await run()).body.message).toBe("Jobseeker not found");
    wire(target({ isActive: false }));
    expect((await run()).body.message).toBe("This profile is unavailable");
  });

  test("WB-EMP-76 a hidden profile is 403 even for an applicant or follower", async () => {
    wire(target({ privacy: { profileVisibility: "hidden" } }), { applied: true, follower: true });
    expect((await run()).status).toBe(403);
    expect(projectJobseeker).not.toHaveBeenCalled();
  });

  test("WB-EMP-77 only applicants or followers are visible; an employer with no jobs skips the application lookup", async () => {
    wire(target(), { applied: false, follower: false });
    expect((await run()).body.message).toMatch(/applicants or followers/);
    JobApplication.exists.mockClear();
    wire(target(), { jobs: [], follower: true });
    expect((await run()).status).toBe(200);
    expect(JobApplication.exists).not.toHaveBeenCalled();
    wire(target(), { applied: true });
    expect((await run()).status).toBe(200);
  });

  test("WB-EMP-78 a 15-17 profile is never shown (the age tier is computed from the stored DOB before any projection); adults and seniors pass", async () => {
    wire(target(), { tier: "minor" });
    expect((await run()).status).toBe(403);
    expect(getAgeTier).toHaveBeenCalledWith("d");
    expect(projectJobseeker).not.toHaveBeenCalled();
    for (const tier of ["adult", "senior", undefined]) {
      wire(target(), { tier });
      expect((await run()).status).toBe(200);
    }
  });

  test("WB-EMP-79 success returns only the projected user/profile built for an employer viewer with the relationship and resolved cover", async () => {
    wire(target(), { projected: { user: { name: "J" }, profile: { skills: [] } } });
    const { body } = await run();
    expect(body).toEqual({ user: { name: "J" }, profile: { skills: [] } });
    expect(projectJobseeker).toHaveBeenCalledWith(expect.objectContaining({ viewer: { id: EMP, role: "employer" }, relationship: { r: 1 }, cover: "cover" }));
  });

  test("WB-EMP-80 a projection that returns nothing is 403; failure is a generic 500", async () => {
    wire(target(), { projected: null });
    expect((await run()).status).toBe(403);
    User.findById.mockRejectedValue(dbError());
    const r = await run();
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ message: "Failed to fetch jobseeker profile" });
  });
});
