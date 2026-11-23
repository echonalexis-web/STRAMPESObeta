// Apply-document flow, server side: the hiring manager name, the "can I prepare documents for
// this job" check, the library upload rules, and what submit does with documents it is handed.
// Self-contained on purpose (no shared test helper); nothing here touches a database.

jest.mock("../models/JobVacancy", () => ({ findById: jest.fn(), updateOne: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ startSession: jest.fn(), findOne: jest.fn(), create: jest.fn() }));
jest.mock("../models/User", () => ({ findById: jest.fn() }));
jest.mock("../models/JobseekerDocument", () => ({
  findOne: jest.fn(), countDocuments: jest.fn(), exists: jest.fn(), create: jest.fn(),
}));
jest.mock("../services/notificationService", () => ({ createNotificationForUser: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(null) }));
jest.mock("../services/storageService", () => ({ upload: jest.fn(), remove: jest.fn().mockResolvedValue(null) }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const User = require("../models/User");
const JobseekerDocument = require("../models/JobseekerDocument");
const storageService = require("../services/storageService");
const { cleanHiringManagerName, HIRING_MANAGER_NAME_MAX } = require("../utils/hiringManager");
const { getApplyContext, applyToJob } = require("../controllers/jobController");
const { uploadMyDocument } = require("../controllers/jobseekerDocumentController");

const JOB = "333333333333333333333333";
const EMPLOYER = "111111111111111111111111";
const SEEKER = "222222222222222222222222";
const RESUME_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const LETTER_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const makeRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  return res;
};
const run = async (handler, req) => {
  const res = makeRes();
  await handler({ user: { id: SEEKER, role: "jobseeker", dateOfBirth: new Date("2000-01-01") }, body: {}, params: {}, ...req }, res);
  return { status: res.status.mock.calls.at(-1)?.[0] ?? 200, body: res.json.mock.calls.at(-1)?.[0] };
};
const withSelect = (value) => ({ select: jest.fn().mockResolvedValue(value) });
const withLean = (value) => ({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }) });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("hiring manager name", () => {
  test("is optional, trimmed, spaces collapsed, markup and control characters removed, length limited", () => {
    expect(cleanHiringManagerName(undefined)).toBe("");
    expect(cleanHiringManagerName(null)).toBe("");
    expect(cleanHiringManagerName("   Maria   Santos  ")).toBe("Maria Santos");
    const cleaned = cleanHiringManagerName('<script>alert(1)</script>\u0007 Maria');
    expect(cleaned).not.toMatch(/[<>\u0007]/);
    expect(cleaned).toContain("Maria");
    expect(cleanHiringManagerName("x".repeat(500))).toHaveLength(HIRING_MANAGER_NAME_MAX);
  });
});

describe("apply context (can documents be prepared for this job?)", () => {
  const openJob = (over = {}) => ({
    _id: JOB, employer: EMPLOYER, title: "Service Crew", status: "active", location: "Boac, Marinduque",
    hiringManagerName: "Maria Santos", applicationDeadline: null, ...over,
  });
  const wire = ({ job = openJob(), employer = { name: "Owner", companyName: "Acme Foods", isActive: true }, application = null } = {}) => {
    JobVacancy.findById.mockResolvedValue(job);
    User.findById.mockReturnValue(withSelect(employer));
    JobApplication.findOne.mockReturnValue(withLean(application));
  };

  test("open, listed and not applied: returns only what the letter needs", async () => {
    wire();
    const r = await run(getApplyContext, { params: { id: JOB } });
    expect(r.status).toBe(200);
    expect(r.body.job).toEqual({
      _id: JOB, title: "Service Crew", companyName: "Acme Foods", hiringManagerName: "Maria Santos", location: "Boac, Marinduque",
    });
  });

  test("an old job without a hiring manager still works", async () => {
    wire({ job: openJob({ hiringManagerName: undefined }) });
    const r = await run(getApplyContext, { params: { id: JOB } });
    expect(r.body.job.hiringManagerName).toBe("");
  });

  test("a missing job and an unlisted (suspended) employer both answer 404", async () => {
    JobVacancy.findById.mockResolvedValue(null);
    expect((await run(getApplyContext, { params: { id: JOB } })).status).toBe(404);
    wire({ employer: { companyName: "Acme", isActive: true, accountStatus: "suspended" } });
    const r = await run(getApplyContext, { params: { id: JOB } });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe("JOB_NOT_FOUND");
  });

  test("a closed job answers 400 JOB_CLOSED", async () => {
    wire({ job: openJob({ status: "closed" }) });
    const r = await run(getApplyContext, { params: { id: JOB } });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("JOB_CLOSED");
  });

  test("an existing application answers 409 ALREADY_APPLIED; a withdrawn one does not", async () => {
    wire({ application: { status: "pending" } });
    const blocked = await run(getApplyContext, { params: { id: JOB } });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("ALREADY_APPLIED");
    wire({ application: { status: "withdrawn" } });
    expect((await run(getApplyContext, { params: { id: JOB } })).status).toBe(200);
  });
});

describe("library upload", () => {
  const file = (over = {}) => ({ originalname: "cv.pdf", mimetype: "application/pdf", size: 1234, ...over });
  const wire = () => {
    JobseekerDocument.countDocuments.mockResolvedValue(0);
    JobseekerDocument.exists.mockResolvedValue(null);
    storageService.upload.mockResolvedValue({ storedValue: "stored/cv.pdf" });
    JobseekerDocument.create.mockImplementation(async (d) => ({ _id: "new", ...d }));
  };

  test("an image is not a resume: refused before anything is stored", async () => {
    wire();
    const r = await run(uploadMyDocument, { body: { kind: "resume" }, file: file({ originalname: "me.png", mimetype: "image/png" }) });
    expect(r.status).toBe(400);
    expect(storageService.upload).not.toHaveBeenCalled();
  });

  test("an empty file is refused", async () => {
    wire();
    const r = await run(uploadMyDocument, { body: { kind: "coverLetter" }, file: file({ size: 0 }) });
    expect(r.status).toBe(400);
    expect(storageService.upload).not.toHaveBeenCalled();
  });

  test("a DOCX resume is accepted and stays 'standard'", async () => {
    wire();
    const r = await run(uploadMyDocument, { body: { kind: "resume", resumeType: "ats" }, file: file({ originalname: "cv.docx", mimetype: DOCX }) });
    expect(r.status).toBe(201);
    // A plain upload can claim "ats" in the body; it is only honoured for a builder-made resume.
    expect(JobseekerDocument.create.mock.calls[0][0].resumeType).toBeUndefined(); // schema default: standard
  });

  test("a builder-made resume keeps 'ats'; any other value falls back to 'standard'", async () => {
    wire();
    await run(uploadMyDocument, { body: { kind: "resume", source: "builder", resumeType: "ats" }, file: file() });
    expect(JobseekerDocument.create.mock.calls[0][0].resumeType).toBe("ats");
    await run(uploadMyDocument, { body: { kind: "resume", source: "builder", resumeType: "<b>x</b>" }, file: file() });
    expect(JobseekerDocument.create.mock.calls[1][0].resumeType).toBeUndefined();
  });

  test("the per-kind limit still applies", async () => {
    wire();
    JobseekerDocument.countDocuments.mockResolvedValue(10);
    const r = await run(uploadMyDocument, { body: { kind: "resume" }, file: file() });
    expect(r.status).toBe(400);
    expect(storageService.upload).not.toHaveBeenCalled();
  });
});

describe("submit with library documents", () => {
  let session;
  beforeEach(() => {
    JobVacancy.findById.mockResolvedValue({ _id: JOB, employer: EMPLOYER, title: "Clerk", status: "active", archived: false });
    User.findById.mockReturnValue(withSelect({ isActive: true }));
    let active = false;
    session = {
      startTransaction: jest.fn(() => { active = true; }),
      inTransaction: jest.fn(() => active),
      commitTransaction: jest.fn(async () => { active = false; }),
      abortTransaction: jest.fn(async () => { active = false; }),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    JobApplication.startSession.mockResolvedValue(session);
    JobApplication.findOne.mockReturnValue({ session: jest.fn().mockResolvedValue(null) });
  });

  test("documents are only looked up inside the applicant's own library; a foreign id attaches nothing", async () => {
    JobseekerDocument.findOne.mockResolvedValue(null); // the owner filter finds nothing
    const foreign = "555555555555555555555555";
    const r = await run(applyToJob, { params: { id: JOB }, body: { resumeDocumentId: foreign, coverLetterDocumentId: foreign } });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/resume/i);
    for (const [filter] of JobseekerDocument.findOne.mock.calls) {
      expect(String(filter.owner)).toBe(SEEKER);
    }
    expect(JobApplication.create).not.toHaveBeenCalled();
  });

  test("a cover letter that was not made for this job is refused, whatever the client claims", async () => {
    const resume = { _id: RESUME_ID, storedValue: "s/r.pdf", kind: "resume" };
    const letter = { _id: LETTER_ID, storedValue: "s/c.pdf", kind: "coverLetter", sourceJobId: "666666666666666666666666" };
    JobseekerDocument.findOne.mockImplementation(async (filter) => (filter.kind === "resume" ? resume : letter));
    const r = await run(applyToJob, {
      params: { id: JOB },
      body: { resumeDocumentId: RESUME_ID, coverLetterDocumentId: LETTER_ID, tailored: true, resumeType: "ats" },
    });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/tailor/i);
    expect(JobApplication.create).not.toHaveBeenCalled();
  });
});
