// White-box branch coverage for jobseekerDocumentController, jobLikeController,
// nsrpFormController and systemOptionController.
// Tests tagged KNOWN-ISSUE pin CURRENT behaviour that looks like a defect (see
// docs/WHITE_BOX_TEST_REPORT.md).

jest.mock("../utils/jobVisibility", () => ({
  ...jest.requireActual("../utils/jobVisibility"),
  // Employer gate stubbed to "nobody is locked": plain functions so resetAllMocks keeps them.
  getUnlistedEmployerIds: async () => [],
  withListedEmployers: async (filter) => filter,
}));
jest.mock("../models/JobseekerDocument", () => ({
  find: jest.fn(), countDocuments: jest.fn(), exists: jest.fn(), create: jest.fn(), findById: jest.fn(),
  updateMany: jest.fn(), findByIdAndDelete: jest.fn(), findOne: jest.fn(),
}));
jest.mock("../models/JobApplication", () => ({ exists: jest.fn() }));
jest.mock("../models/JobLike", () => ({ findOne: jest.fn(), create: jest.fn(), countDocuments: jest.fn(), findOneAndDelete: jest.fn(), find: jest.fn() }));
jest.mock("../models/JobVacancy", () => ({ findById: jest.fn(), find: jest.fn(), countDocuments: jest.fn() }));
jest.mock("../models/User", () => ({ findById: jest.fn() }));
jest.mock("../models/JobseekerProfile", () => ({ findOne: jest.fn() }));
jest.mock("../models/EmployerProfile", () => ({ findOne: jest.fn() }));
jest.mock("../models/SystemOption", () => ({ find: jest.fn(), exists: jest.fn(), create: jest.fn(), findByIdAndUpdate: jest.fn(), findByIdAndDelete: jest.fn() }));
jest.mock("../services/storageService", () => ({ upload: jest.fn(), remove: jest.fn() }));
jest.mock("../services/notificationService", () => ({ notifyLike: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn() }));
jest.mock("../services/systemOptionService", () => ({ invalidateCache: jest.fn() }));
jest.mock("../services/nsrpFormService", () => ({ fillForm1: jest.fn(), fillForm2: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const JobseekerDocument = require("../models/JobseekerDocument");
const JobApplication = require("../models/JobApplication");
const JobLike = require("../models/JobLike");
const JobVacancy = require("../models/JobVacancy");
const User = require("../models/User");
const JobseekerProfile = require("../models/JobseekerProfile");
const EmployerProfile = require("../models/EmployerProfile");
const SystemOption = require("../models/SystemOption");
const storage = require("../services/storageService");
const { notifyLike } = require("../services/notificationService");
const { logAuditEvent } = require("../services/auditService");
const { invalidateCache } = require("../services/systemOptionService");
const { fillForm1, fillForm2 } = require("../services/nsrpFormService");
const logger = require("../utils/logger");
const docs = require("../controllers/jobseekerDocumentController");
const likes = require("../controllers/jobLikeController");
const nsrp = require("../controllers/nsrpFormController");
const options = require("../controllers/systemOptionController");
const { makeReq, query, failingQuery, call } = require("../testUtils/httpMocks");

const U = "a".repeat(24);
const J = "b".repeat(24);
const flush = () => new Promise((r) => setImmediate(r));
const dbError = () => new Error("secret db internals");
const ureq = (o = {}) => makeReq({ user: { id: U, _id: U, role: "jobseeker" }, ...o });
const expect500 = (r, message) => {
  expect(r.status).toBe(500);
  expect(r.body).toEqual({ message });
};

let errSpy;
beforeEach(() => {
  jest.resetAllMocks();
  errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  storage.remove.mockResolvedValue();
  logAuditEvent.mockResolvedValue();
  notifyLike.mockResolvedValue();
  // Employer gate: every job counts as listed unless a test says otherwise.
  JobVacancy.countDocuments.mockResolvedValue(1);
  JobVacancy.find.mockImplementation(() => ({ distinct: async () => ["listed"] }));
});
afterEach(() => errSpy.mockRestore());

// ---------------------------------------------------------------------------
describe("jobseekerDocumentController", () => {
  describe("listMyDocuments", () => {
    test.each([["resume", { owner: U, kind: "resume" }], ["coverLetter", { owner: U, kind: "coverLetter" }], ["other", { owner: U }], [undefined, { owner: U }], ["  resume  ", { owner: U, kind: "resume" }]])(
      "WB-DOC-01 kind %p filters as %j (always scoped to the caller)", async (kind, filter) => {
        JobseekerDocument.find.mockReturnValue(query([{ _id: "d" }]));
        const { body } = await call(docs.listMyDocuments, ureq({ query: { kind } }));
        expect(JobseekerDocument.find).toHaveBeenCalledWith(filter);
        expect(body).toEqual([{ _id: "d" }]);
      }
    );

    test("WB-DOC-02 DB failure is a generic 500", async () => {
      JobseekerDocument.find.mockReturnValue(failingQuery(dbError()));
      expect500(await call(docs.listMyDocuments, ureq({ query: {} })), "Failed to load your documents");
    });
  });

  describe("uploadMyDocument", () => {
    const file = (o = {}) => ({ originalname: "cv.pdf", mimetype: "application/pdf", size: 1234, ...o });
    const run = (body, over = {}) => call(docs.uploadMyDocument, ureq({ body, file: file(), ...over }));
    const wire = (count = 0, hasPrimary = null) => {
      JobseekerDocument.countDocuments.mockResolvedValue(count);
      storage.upload.mockResolvedValue({ storedValue: "stored/cv.pdf" });
      JobseekerDocument.exists.mockResolvedValue(hasPrimary);
      JobseekerDocument.create.mockImplementation(async (d) => ({ _id: "new", ...d }));
    };

    test.each([[undefined], [""], ["image"]])("WB-DOC-03 invalid kind %p is 400 before anything else", async (kind) => {
      const r = await run({ kind });
      expect(r.status).toBe(400);
      expect(JobseekerDocument.countDocuments).not.toHaveBeenCalled();
    });

    test.each([["constructor"], ["toString"], ["hasOwnProperty"]])("WB-DOC-03b KNOWN-ISSUE: kind %p passes the `CATEGORY_BY_KIND[kind]` check (it is an Object.prototype member), so the request is NOT rejected as 400 and reaches the database", async (kind) => {
      JobseekerDocument.countDocuments.mockResolvedValue(0);
      storage.upload.mockResolvedValue({ storedValue: "s" });
      JobseekerDocument.exists.mockResolvedValue(null);
      JobseekerDocument.create.mockRejectedValue(new Error("enum validation"));
      const r = await run({ kind });
      expect(r.status).toBe(500);
      expect(JobseekerDocument.countDocuments).toHaveBeenCalledWith({ owner: U, kind });
    });

    test("WB-DOC-04 missing file is 400", async () => {
      const r = await call(docs.uploadMyDocument, ureq({ body: { kind: "resume" }, file: undefined }));
      expect(r.status).toBe(400);
      expect(r.body.message).toBe("No file uploaded");
    });

    test("WB-DOC-05 boundary: 9 saved is allowed, 10 is refused with the kind's label; nothing is uploaded when refused", async () => {
      wire(9);
      expect((await run({ kind: "resume" })).status).toBe(201);
      storage.upload.mockClear();
      wire(10);
      const r = await run({ kind: "coverLetter" });
      expect(r.status).toBe(400);
      expect(r.body.message).toBe("You can save up to 10 cover letters. Delete one before adding another.");
      expect(storage.upload).not.toHaveBeenCalled();
      wire(10);
      expect((await run({ kind: "resume" })).body.message).toContain("10 resumes");
    });

    test("WB-DOC-06 success: stored under the right category and owner; first document of a kind becomes primary", async () => {
      wire(0, null);
      const r = await run({ kind: "resume", title: "  My CV  " });
      expect(storage.upload).toHaveBeenCalledWith(expect.anything(), { category: "jobseekerResume", ownerId: U });
      expect(JobseekerDocument.create).toHaveBeenCalledWith({
        owner: U, kind: "resume", title: "My CV", storedValue: "stored/cv.pdf", mimeType: "application/pdf", sizeBytes: 1234, source: "upload", isPrimary: true, sourceJobId: null,
      });
      expect(r.status).toBe(201);
      wire(0, null);
      await run({ kind: "coverLetter" });
      expect(storage.upload.mock.calls[1][1].category).toBe("jobseekerCoverLetter");
    });

    test("WB-DOC-07 later documents are not primary when one already exists", async () => {
      wire(1, { _id: "p" });
      await run({ kind: "resume" });
      expect(JobseekerDocument.create.mock.calls[0][0].isPrimary).toBe(false);
    });

    test("WB-DOC-08 title: trimmed and cut to 120 chars; falls back to the original file name, then a per-kind default", async () => {
      wire();
      await run({ kind: "resume", title: "x".repeat(300) });
      expect(JobseekerDocument.create.mock.calls[0][0].title).toHaveLength(120);
      await run({ kind: "resume", title: "   " });
      expect(JobseekerDocument.create.mock.calls[1][0].title).toBe("cv.pdf");
      await run({ kind: "resume" }, { file: file({ originalname: undefined }) });
      expect(JobseekerDocument.create.mock.calls[2][0].title).toBe("Resume");
      await run({ kind: "coverLetter" }, { file: file({ originalname: "" }) });
      expect(JobseekerDocument.create.mock.calls[3][0].title).toBe("Cover letter");
    });

    test("WB-DOC-09 source is 'builder' only when exactly 'builder'; missing mime/size default safely", async () => {
      wire();
      await run({ kind: "resume", source: "builder" }, { file: file({ mimetype: undefined, size: undefined }) });
      expect(JobseekerDocument.create.mock.calls[0][0]).toMatchObject({ source: "builder", mimeType: "", sizeBytes: 0 });
      await run({ kind: "resume", source: "Builder" });
      expect(JobseekerDocument.create.mock.calls[1][0].source).toBe("upload");
    });

    test("WB-DOC-10 sourceJobId is kept only for a COVER LETTER with a valid ObjectId", async () => {
      wire();
      await run({ kind: "coverLetter", sourceJobId: J });
      expect(JobseekerDocument.create.mock.calls[0][0].sourceJobId).toBe(J);
      await run({ kind: "coverLetter", sourceJobId: "not-an-id" });
      expect(JobseekerDocument.create.mock.calls[1][0].sourceJobId).toBeNull();
      await run({ kind: "resume", sourceJobId: J });
      expect(JobseekerDocument.create.mock.calls[2][0].sourceJobId).toBeNull();
    });

    test("WB-DOC-11 KNOWN-ISSUE: the file is already in storage when the DB create fails, and nothing removes it (orphaned upload)", async () => {
      wire();
      JobseekerDocument.create.mockRejectedValue(dbError());
      const r = await run({ kind: "resume" });
      expect500(r, "Failed to save document");
      expect(storage.upload).toHaveBeenCalled();
      expect(storage.remove).not.toHaveBeenCalled();
    });
  });

  describe("setPrimaryDocument", () => {
    const run = () => call(docs.setPrimaryDocument, ureq({ params: { id: "d1" } }));
    const doc = (o = {}) => ({ _id: "d1", kind: "resume", owner: U, isPrimary: false, save: jest.fn().mockResolvedValue(), ...o });

    test("WB-DOC-12 unknown 404; someone else's 403", async () => {
      JobseekerDocument.findById.mockResolvedValue(null);
      expect((await run()).status).toBe(404);
      JobseekerDocument.findById.mockResolvedValue(doc({ owner: "other" }));
      expect((await run()).status).toBe(403);
      expect(JobseekerDocument.updateMany).not.toHaveBeenCalled();
    });

    test("WB-DOC-13 success un-primaries the other documents of the SAME kind and owner, then primaries this one", async () => {
      const d = doc();
      JobseekerDocument.findById.mockResolvedValue(d);
      JobseekerDocument.updateMany.mockResolvedValue();
      await run();
      expect(JobseekerDocument.updateMany).toHaveBeenCalledWith({ owner: U, kind: "resume", _id: { $ne: "d1" } }, { $set: { isPrimary: false } });
      expect(d.isPrimary).toBe(true);
      expect(d.save).toHaveBeenCalled();
    });

    test("WB-DOC-14 DB failure is a generic 500", async () => {
      JobseekerDocument.findById.mockRejectedValue(dbError());
      expect500(await run(), "Failed to update primary document");
    });
  });

  describe("deleteMyDocument", () => {
    const run = () => call(docs.deleteMyDocument, ureq({ params: { id: "d1" } }));
    const doc = (o = {}) => ({ _id: "d1", kind: "resume", owner: U, isPrimary: false, storedValue: "stored/cv.pdf", ...o });

    test("WB-DOC-15 unknown 404; someone else's 403 (nothing deleted)", async () => {
      JobseekerDocument.findById.mockResolvedValue(null);
      expect((await run()).status).toBe(404);
      JobseekerDocument.findById.mockResolvedValue(doc({ owner: "other" }));
      expect((await run()).status).toBe(403);
      expect(JobseekerDocument.findByIdAndDelete).not.toHaveBeenCalled();
    });

    test("WB-DOC-16 an unused document is deleted and its stored file purged", async () => {
      JobseekerDocument.findById.mockResolvedValue(doc());
      JobApplication.exists.mockResolvedValue(null);
      JobseekerDocument.findByIdAndDelete.mockResolvedValue();
      const r = await run();
      expect(JobApplication.exists).toHaveBeenCalledWith({ $or: [{ resumeDocumentId: "d1" }, { coverLetterDocumentId: "d1" }] });
      expect(storage.remove).toHaveBeenCalledWith("stored/cv.pdf");
      expect(r.body).toEqual({ message: "Document deleted", id: "d1" });
    });

    test("WB-DOC-17 a document used by a past application is removed from the library but its file is KEPT", async () => {
      JobseekerDocument.findById.mockResolvedValue(doc());
      JobApplication.exists.mockResolvedValue({ _id: "app" });
      JobseekerDocument.findByIdAndDelete.mockResolvedValue();
      await run();
      expect(storage.remove).not.toHaveBeenCalled();
    });

    test("WB-DOC-18 a failing storage purge is logged, never thrown", async () => {
      JobseekerDocument.findById.mockResolvedValue(doc());
      JobApplication.exists.mockResolvedValue(null);
      JobseekerDocument.findByIdAndDelete.mockResolvedValue();
      storage.remove.mockRejectedValue(new Error("disk"));
      expect((await run()).status).toBe(200);
      await flush();
      expect(logger.error).toHaveBeenCalledWith("Failed to remove jobseeker document from storage", expect.anything());
    });

    test("WB-DOC-19 deleting the PRIMARY promotes the most recent remaining document of that kind; none left means nothing to promote", async () => {
      JobApplication.exists.mockResolvedValue(null);
      JobseekerDocument.findByIdAndDelete.mockResolvedValue();
      JobseekerDocument.findById.mockResolvedValue(doc({ isPrimary: true }));
      const next = { isPrimary: false, save: jest.fn().mockResolvedValue() };
      const q = query(next);
      JobseekerDocument.findOne.mockReturnValue(q);
      await run();
      expect(JobseekerDocument.findOne).toHaveBeenCalledWith({ owner: U, kind: "resume" });
      expect(q.sort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(next.isPrimary).toBe(true);
      expect(next.save).toHaveBeenCalled();
      JobseekerDocument.findOne.mockReturnValue(query(null));
      JobseekerDocument.findById.mockResolvedValue(doc({ isPrimary: true }));
      expect((await run()).status).toBe(200);
    });

    test("WB-DOC-20 a non-primary delete never looks for a replacement; DB failure is a generic 500", async () => {
      JobseekerDocument.findById.mockResolvedValue(doc());
      JobApplication.exists.mockResolvedValue(null);
      JobseekerDocument.findByIdAndDelete.mockResolvedValue();
      await run();
      expect(JobseekerDocument.findOne).not.toHaveBeenCalled();
      JobseekerDocument.findById.mockRejectedValue(dbError());
      expect500(await run(), "Failed to delete document");
    });
  });
});

// ---------------------------------------------------------------------------
describe("jobLikeController", () => {
  const lreq = (o = {}) => ureq({ params: { jobId: J }, ...o });

  describe("likeJob", () => {
    const wire = () => {
      JobVacancy.findById.mockResolvedValue({ _id: J, title: "Welder", employer: "emp" });
      JobLike.findOne.mockResolvedValue(null);
      JobLike.create.mockResolvedValue();
      JobLike.countDocuments.mockResolvedValue(3);
      User.findById.mockReturnValue(query({ name: "Ann" }));
    };

    test("WB-LIKE-01 unknown job 404; already liked is a 400 (unlike the news endpoint, which is idempotent)", async () => {
      JobVacancy.findById.mockResolvedValue(null);
      expect((await call(likes.likeJob, lreq())).status).toBe(404);
      wire();
      JobLike.findOne.mockResolvedValue({ _id: "l" });
      const r = await call(likes.likeJob, lreq());
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: "Already liked this job" });
      expect(JobLike.create).not.toHaveBeenCalled();
    });

    test("WB-LIKE-02 success: like stored, employer notified with the liker's name (or 'Someone'), audited, count returned", async () => {
      wire();
      const r = await call(likes.likeJob, lreq());
      expect(r.status).toBe(201);
      expect(JobLike.create).toHaveBeenCalledWith({ userId: U, jobId: J });
      expect(notifyLike).toHaveBeenCalledWith(expect.objectContaining({ recipientId: "emp", actorName: "Ann", itemLabel: 'your job posting "Welder"', actionUrl: "/employer" }));
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "social.job.liked", targetId: J }));
      expect(r.body).toEqual({ success: true, message: "Job liked successfully", data: { jobId: J, likeCount: 3 } });
      User.findById.mockReturnValue(query(null));
      await call(likes.likeJob, lreq());
      expect(notifyLike.mock.calls[1][0].actorName).toBe("Someone");
    });

    test("WB-LIKE-03 KNOWN-ISSUE: any existing job can be liked, including a CLOSED/inactive one (no status check), and a failing notification turns an already-saved like into a 500", async () => {
      wire();
      JobVacancy.findById.mockResolvedValue({ _id: J, title: "Old", employer: "emp", status: "closed", isActive: false });
      expect((await call(likes.likeJob, lreq())).status).toBe(201);
      notifyLike.mockRejectedValue(new Error("smtp"));
      const r = await call(likes.likeJob, lreq());
      expect(JobLike.create).toHaveBeenCalledTimes(2);
      expect(r.status).toBe(500);
      expect(r.body).toEqual({ error: "Failed to like job" });
    });
  });

  describe("unlikeJob", () => {
    test("WB-LIKE-04 no such like is 404; success returns the new count and audits", async () => {
      JobLike.findOneAndDelete.mockResolvedValue(null);
      expect((await call(likes.unlikeJob, lreq())).status).toBe(404);
      JobLike.findOneAndDelete.mockResolvedValue({ _id: "l" });
      JobLike.countDocuments.mockResolvedValue(2);
      const r = await call(likes.unlikeJob, lreq());
      expect(JobLike.findOneAndDelete).toHaveBeenCalledWith({ userId: U, jobId: J });
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "social.job.unliked" }));
      expect(r.body).toEqual({ success: true, message: "Job unliked successfully", data: { jobId: J, likeCount: 2 } });
    });

    test("WB-LIKE-05 failure is a generic 500", async () => {
      JobLike.findOneAndDelete.mockRejectedValue(dbError());
      const r = await call(likes.unlikeJob, lreq());
      expect(r.body).toEqual({ error: "Failed to unlike job" });
    });
  });

  describe("getLikedJobs", () => {
    const wire = (rows, total = rows.length) => {
      JobLike.countDocuments.mockResolvedValue(total);
      const q = query(rows);
      JobLike.find.mockReturnValue(q);
      return q;
    };

    test("WB-LIKE-06 returns the populated jobs; defaults page 1 limit 10", async () => {
      const q = wire([{ jobId: { _id: "a" } }, { jobId: { _id: "b" } }], 25);
      const { body } = await call(likes.getLikedJobs, lreq({ query: {} }));
      expect(body.data).toEqual([{ _id: "a" }, { _id: "b" }]);
      expect(q.skip).toHaveBeenCalledWith(0);
      expect(q.limit).toHaveBeenCalledWith(10);
      expect(body.pagination).toEqual({ total: 25, page: 1, limit: 10, pages: 3 });
    });

    test("WB-LIKE-07 limit is capped at 100; non-numeric values fall back to defaults", async () => {
      let q = wire([]);
      await call(likes.getLikedJobs, lreq({ query: { page: "2", limit: "500" } }));
      expect(q.limit).toHaveBeenCalledWith(100);
      expect(q.skip).toHaveBeenCalledWith(100);
      q = wire([]);
      await call(likes.getLikedJobs, lreq({ query: { page: "x", limit: "y" } }));
      expect(q.skip).toHaveBeenCalledWith(0);
      expect(q.limit).toHaveBeenCalledWith(10);
    });

    test("WB-LIKE-08 KNOWN-ISSUE: a deleted job leaves a null entry in `data`, a negative page produces a negative skip, and an empty list reports 0 pages", async () => {
      let q = wire([{ jobId: null }, { jobId: { _id: "a" } }], 2);
      const { body } = await call(likes.getLikedJobs, lreq({ query: {} }));
      expect(body.data).toEqual([null, { _id: "a" }]);
      q = wire([], 0);
      const neg = await call(likes.getLikedJobs, lreq({ query: { page: "-3" } }));
      expect(q.skip).toHaveBeenCalledWith(-40);
      expect(neg.body.pagination.pages).toBe(0);
    });

    test("WB-LIKE-09 failure is a generic 500", async () => {
      JobLike.countDocuments.mockRejectedValue(dbError());
      expect((await call(likes.getLikedJobs, lreq({ query: {} }))).body).toEqual({ error: "Failed to fetch liked jobs" });
    });
  });

  test("WB-LIKE-10 getJobLikeStatus: liked / not liked, failure", async () => {
    JobLike.findOne.mockResolvedValue({ _id: "l" });
    JobLike.countDocuments.mockResolvedValue(4);
    expect((await call(likes.getJobLikeStatus, lreq())).body).toEqual({ success: true, data: { isLiked: true, likeCount: 4 } });
    JobLike.findOne.mockResolvedValue(null);
    expect((await call(likes.getJobLikeStatus, lreq())).body.data.isLiked).toBe(false);
    JobLike.findOne.mockRejectedValue(dbError());
    expect((await call(likes.getJobLikeStatus, lreq())).body).toEqual({ error: "Failed to fetch like status" });
  });

  test("WB-LIKE-11 getJobLikeCount: unknown job 404, count, failure", async () => {
    JobVacancy.findById.mockResolvedValue(null);
    expect((await call(likes.getJobLikeCount, lreq())).status).toBe(404);
    JobVacancy.findById.mockResolvedValue({ _id: J });
    JobLike.countDocuments.mockResolvedValue(9);
    expect((await call(likes.getJobLikeCount, lreq())).body).toEqual({ success: true, data: { likeCount: 9 } });
    JobVacancy.findById.mockRejectedValue(dbError());
    expect((await call(likes.getJobLikeCount, lreq())).body).toEqual({ error: "Failed to fetch like count" });
  });
});

// ---------------------------------------------------------------------------
describe("nsrpFormController", () => {
  const BUF = Buffer.from("%PDF");

  describe.each([
    ["exportOwnForm1", "jobseeker", "employer", JobseekerProfile, fillForm1, "NSRP-Form-1.pdf", /only available to jobseeker/],
    ["exportOwnForm2", "employer", "jobseeker", EmployerProfile, fillForm2, "NSRP-Form-2.pdf", /only available to employer/],
  ])("%s", (name, okRole, wrongRole, Profile, fill, filename, wrongMsg) => {
    const run = () => call(nsrp[name], ureq());

    test("WB-NSRP-01 unknown user 404; wrong role 400", async () => {
      User.findById.mockReturnValue(query(null));
      expect((await run()).status).toBe(404);
      User.findById.mockReturnValue(query({ _id: U, role: wrongRole }));
      const r = await run();
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(wrongMsg);
      expect(fill).not.toHaveBeenCalled();
    });

    test("WB-NSRP-02 sends the PDF as an attachment built from the caller's own profile; password is never selected", async () => {
      const q = query({ _id: U, role: okRole });
      User.findById.mockReturnValue(q);
      Profile.findOne.mockResolvedValue({ p: 1 });
      fill.mockResolvedValue(BUF);
      const { res } = await run();
      expect(q.select).toHaveBeenCalledWith("-password");
      expect(Profile.findOne).toHaveBeenCalledWith({ userId: U });
      expect(res.set).toHaveBeenCalledWith("Content-Type", "application/pdf");
      expect(res.set).toHaveBeenCalledWith("Content-Disposition", `attachment; filename="${filename}"`);
      expect(res.send).toHaveBeenCalledWith(BUF);
    });

    test("WB-NSRP-03 a PDF-generation failure is a generic 500", async () => {
      User.findById.mockReturnValue(query({ _id: U, role: okRole }));
      Profile.findOne.mockResolvedValue(null);
      fill.mockRejectedValue(dbError());
      const r = await run();
      expect(r.status).toBe(500);
      expect(r.body).toEqual({ message: "Something went wrong" });
    });
  });

  describe.each([
    ["adminExportForm1", "jobseeker", "employer", JobseekerProfile, fillForm1, "NSRP-Form-1-U1.pdf"],
    ["adminExportForm2", "employer", "jobseeker", EmployerProfile, fillForm2, "NSRP-Form-2-U1.pdf"],
  ])("%s", (name, okRole, wrongRole, Profile, fill, filename) => {
    const run = () => call(nsrp[name], makeReq({ params: { id: "U1" } }));

    test("WB-NSRP-04 unknown user 404; the other role's user 400", async () => {
      User.findById.mockReturnValue(query(null));
      expect((await run()).status).toBe(404);
      User.findById.mockReturnValue(query({ _id: "U1", role: wrongRole }));
      expect((await run()).status).toBe(400);
    });

    test("WB-NSRP-05 an admin can export any matching user's form; file name carries the user id", async () => {
      User.findById.mockReturnValue(query({ _id: "U1", role: okRole }));
      Profile.findOne.mockResolvedValue({});
      fill.mockResolvedValue(BUF);
      const { res } = await run();
      expect(res.set).toHaveBeenCalledWith("Content-Disposition", `attachment; filename="${filename}"`);
      expect(res.send).toHaveBeenCalledWith(BUF);
    });

    test("WB-NSRP-06 generation failure is a generic 500", async () => {
      User.findById.mockReturnValue(failingQuery(dbError()));
      expect((await run()).status).toBe(500);
    });
  });

  test("WB-NSRP-07 own-form export reads the id from req.user.id when _id is absent", async () => {
    User.findById.mockReturnValue(query(null));
    await call(nsrp.exportOwnForm1, makeReq({ user: { id: "only" } }));
    expect(User.findById).toHaveBeenCalledWith("only");
  });
});

// ---------------------------------------------------------------------------
describe("systemOptionController", () => {
  describe("listByCategory", () => {
    const run = (category, user, q = {}) => call(options.listByCategory, makeReq({ params: { category }, user, query: q }));

    test.each([["industry"], ["jobType"], ["governmentIdType"]])("WB-OPT-01 known category %s is accepted", async (c) => {
      SystemOption.find.mockReturnValue(query([{ value: "x" }]));
      expect((await run(c, { role: "jobseeker" })).status).toBe(200);
    });

    test.each([["nope"], ["__proto__"], ["INDUSTRY"], [undefined]])("WB-OPT-02 unknown category %p is 400", async (c) => {
      const r = await run(c, { role: "jobseeker" });
      expect(r.status).toBe(400);
      expect(SystemOption.find).not.toHaveBeenCalled();
    });

    test("WB-OPT-03 regular users only ever get ACTIVE options (includeInactive is ignored)", async () => {
      SystemOption.find.mockReturnValue(query([{ value: "x" }]));
      await run("industry", { role: "jobseeker" }, { includeInactive: "true" });
      expect(SystemOption.find).toHaveBeenLastCalledWith({ category: "industry", isActive: true });
      await run("industry", { role: "admin" }, { includeInactive: "true" });
      expect(SystemOption.find).toHaveBeenLastCalledWith({ category: "industry", isActive: true });
      await run("industry", undefined, { includeInactive: "true" });
      expect(SystemOption.find).toHaveBeenLastCalledWith({ category: "industry", isActive: true });
    });

    test("WB-OPT-04 only a superadmin asking with includeInactive=true (exactly) sees inactive rows", async () => {
      SystemOption.find.mockReturnValue(query([{ value: "x" }]));
      await run("industry", { role: "superadmin" }, { includeInactive: "true" });
      expect(SystemOption.find).toHaveBeenLastCalledWith({ category: "industry" });
      await run("industry", { role: "superadmin" }, { includeInactive: "1" });
      expect(SystemOption.find).toHaveBeenLastCalledWith({ category: "industry", isActive: true });
    });

    test("WB-OPT-05 `configured` distinguishes an unseeded category from one whose rows are all inactive", async () => {
      const q = query([{ value: "x" }]);
      SystemOption.find.mockReturnValue(q);
      expect((await run("industry", { role: "jobseeker" })).body.configured).toBe(true);
      expect(SystemOption.exists).not.toHaveBeenCalled();
      SystemOption.find.mockReturnValue(query([]));
      SystemOption.exists.mockResolvedValue({ _id: "inactive" });
      expect((await run("industry", { role: "jobseeker" })).body).toEqual({ options: [], configured: true });
      SystemOption.exists.mockResolvedValue(null);
      expect((await run("industry", { role: "jobseeker" })).body).toEqual({ options: [], configured: false });
    });

    test("WB-OPT-06 DB failure is a generic 500", async () => {
      SystemOption.find.mockReturnValue(failingQuery(dbError()));
      expect500(await run("industry", { role: "jobseeker" }), "Failed to load options");
    });
  });

  describe("createOption", () => {
    const run = (body) => call(options.createOption, makeReq({ body, user: { id: "sa", role: "superadmin" } }));

    test("WB-OPT-07 unknown category and blank value are 400", async () => {
      expect((await run({ category: "x", value: "v" })).status).toBe(400);
      expect((await run({ category: "industry" })).body.message).toBe("value is required.");
      expect((await run({ category: "industry", value: "   " })).status).toBe(400);
      expect(SystemOption.create).not.toHaveBeenCalled();
    });

    test.each([[5, 5], ["7", 7], [undefined, 0], ["abc", 0], [null, 0]])("WB-OPT-08 order %p is stored as %p", async (order, stored) => {
      SystemOption.create.mockImplementation(async (d) => ({ _id: "o1", ...d }));
      await run({ category: "industry", value: " IT ", order });
      expect(SystemOption.create).toHaveBeenCalledWith({ category: "industry", value: "IT", order: stored });
    });

    test("WB-OPT-09 success invalidates that category's cache and audits it", async () => {
      SystemOption.create.mockResolvedValue({ _id: "o1" });
      const r = await run({ category: "jobType", value: "Full-time" });
      expect(r.status).toBe(201);
      expect(invalidateCache).toHaveBeenCalledWith("jobType");
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "superadmin.system_option.created", metadata: { category: "jobType", value: "Full-time" } }));
    });

    test("WB-OPT-10 duplicate (E11000) is a friendly 400; other errors a generic 500", async () => {
      SystemOption.create.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
      expect((await run({ category: "industry", value: "IT" })).body.message).toMatch(/already exists/);
      SystemOption.create.mockRejectedValue(dbError());
      expect500(await run({ category: "industry", value: "IT" }), "Failed to create option");
    });
  });

  describe("updateOption", () => {
    const run = (body, id = "o1") => call(options.updateOption, makeReq({ params: { id }, body, user: { id: "sa", role: "superadmin" } }));

    test("WB-OPT-11 a blank value is 400; value is trimmed", async () => {
      expect((await run({ value: "  " })).body.message).toBe("value can't be empty.");
      SystemOption.findByIdAndUpdate.mockResolvedValue({ _id: "o1", category: "industry" });
      await run({ value: " IT " });
      expect(SystemOption.findByIdAndUpdate).toHaveBeenCalledWith("o1", { $set: { value: "IT" } }, { new: true, runValidators: true });
    });

    test.each([[5, 5], ["abc", 0], [0, 0], [null, 0]])("WB-OPT-12 order %p is stored as %p", async (order, stored) => {
      SystemOption.findByIdAndUpdate.mockResolvedValue({ _id: "o1", category: "industry" });
      await run({ order });
      expect(SystemOption.findByIdAndUpdate.mock.calls[0][1].$set.order).toBe(stored);
    });

    test("WB-OPT-13 KNOWN-ISSUE: isActive uses Boolean(), so the STRING 'false' (and any non-empty string) DEACTIVATES nothing: it activates", async () => {
      SystemOption.findByIdAndUpdate.mockResolvedValue({ _id: "o1", category: "industry" });
      await run({ isActive: "false" });
      expect(SystemOption.findByIdAndUpdate.mock.calls[0][1].$set.isActive).toBe(true);
      await run({ isActive: false });
      expect(SystemOption.findByIdAndUpdate.mock.calls[1][1].$set.isActive).toBe(false);
      await run({ isActive: 0 });
      expect(SystemOption.findByIdAndUpdate.mock.calls[2][1].$set.isActive).toBe(false);
    });

    test("WB-OPT-14 KNOWN-ISSUE: an empty body sends an empty $set to Mongo (which rejects it) instead of a clean 400", async () => {
      SystemOption.findByIdAndUpdate.mockResolvedValue({ _id: "o1", category: "industry" });
      await run({});
      expect(SystemOption.findByIdAndUpdate.mock.calls[0][1]).toEqual({ $set: {} });
    });

    test("WB-OPT-15 unknown option 404; success invalidates the option's category and audits the change", async () => {
      SystemOption.findByIdAndUpdate.mockResolvedValue(null);
      expect((await run({ order: 1 })).status).toBe(404);
      expect(invalidateCache).not.toHaveBeenCalled();
      SystemOption.findByIdAndUpdate.mockResolvedValue({ _id: "o1", category: "jobType" });
      const r = await run({ order: 2 });
      expect(invalidateCache).toHaveBeenCalledWith("jobType");
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "superadmin.system_option.updated", metadata: { category: "jobType", update: { order: 2 } } }));
      expect(r.body.option).toEqual({ _id: "o1", category: "jobType" });
    });

    test("WB-OPT-16 duplicate (E11000) is a friendly 400; other errors a generic 500", async () => {
      SystemOption.findByIdAndUpdate.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
      expect((await run({ value: "IT" })).body.message).toMatch(/already exists/);
      SystemOption.findByIdAndUpdate.mockRejectedValue(dbError());
      expect500(await run({ value: "IT" }), "Failed to update option");
    });
  });

  describe("deleteOption", () => {
    const run = () => call(options.deleteOption, makeReq({ params: { id: "o1" }, user: { id: "sa", role: "superadmin" } }));

    test("WB-OPT-17 unknown 404; success hard-deletes, invalidates the category cache and audits as a warning", async () => {
      SystemOption.findByIdAndDelete.mockResolvedValue(null);
      expect((await run()).status).toBe(404);
      SystemOption.findByIdAndDelete.mockResolvedValue({ _id: "o1", category: "industry", value: "IT" });
      const r = await run();
      expect(invalidateCache).toHaveBeenCalledWith("industry");
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "superadmin.system_option.deleted", severity: "warning", metadata: { category: "industry", value: "IT" } }));
      expect(r.body).toEqual({ success: true });
    });

    test("WB-OPT-18 failure is a generic 500", async () => {
      SystemOption.findByIdAndDelete.mockRejectedValue(dbError());
      expect500(await run(), "Failed to delete option");
    });
  });
});
