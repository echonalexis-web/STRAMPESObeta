jest.mock("../models/JobVacancy", () => ({ findById: jest.fn(), updateOne: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ startSession: jest.fn(), findOne: jest.fn(), create: jest.fn() }));
jest.mock("../models/User", () => ({ findById: jest.fn() }));
jest.mock("../models/JobseekerDocument", () => ({ findOne: jest.fn() }));
jest.mock("../services/notificationService", () => ({ createNotificationForUser: jest.fn().mockResolvedValue(null) }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(null) }));
jest.mock("../services/storageService", () => ({ remove: jest.fn().mockResolvedValue(null) }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), error: jest.fn() }));

const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const JobseekerDocument = require("../models/JobseekerDocument");
const User = require("../models/User");
const { createNotificationForUser } = require("../services/notificationService");
const { applyToJob } = require("../controllers/jobController");

const JOB = "333333333333333333333333", EMPLOYER = "111111111111111111111111", SEEKER = "222222222222222222222222";
let req, res, session, job;
beforeEach(() => {
  jest.clearAllMocks();
  job = { _id: JOB, employer: EMPLOYER, title: "Clerk", status: "active", archived: false };
  JobVacancy.findById.mockImplementation(async () => job);
  JobVacancy.updateOne.mockResolvedValue({});
  User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ isActive: true }) });
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
  JobApplication.create.mockResolvedValue([{ _id: "application-1" }]);
  req = { params: { id: JOB }, user: { id: SEEKER }, body: {}, app: { get: jest.fn() }, files: {
    resume: [{ storedValue: "/uploads/resume.pdf" }], coverLetterFile: [{ storedValue: "/uploads/letter.pdf" }],
  } };
  res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
});

test.each([
  ["closed", { status: "closed" }], ["draft", { status: "draft" }],
  ["archived", { archived: true }], ["expired", { applicationDeadline: new Date(Date.now() - 86400000) }],
])("rejects a %s job before starting a transaction or notifying", async (_label, state) => {
  Object.assign(job, state);
  await applyToJob(req, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(JobApplication.startSession).not.toHaveBeenCalled();
  expect(JobApplication.create).not.toHaveBeenCalled();
  expect(createNotificationForUser).not.toHaveBeenCalled();
});

test.each([null, { isActive: false }])("rejects missing or inactive employers (%j)", async employer => {
  User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(employer) });
  await applyToJob(req, res);
  expect(User.findById).toHaveBeenCalledWith(EMPLOYER);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(JobApplication.startSession).not.toHaveBeenCalled();
  expect(createNotificationForUser).not.toHaveBeenCalled();
});

test("missing vacancy returns 404 without allocating a session", async () => {
  job = null;
  await applyToJob(req, res);
  expect(res.status).toHaveBeenCalledWith(404);
  expect(JobApplication.startSession).not.toHaveBeenCalled();
});

test.each([undefined, new Date(Date.now() + 86400000)])("active eligible jobs still create an application (deadline %s)", async deadline => {
  job.applicationDeadline = deadline;
  await applyToJob(req, res);
  expect(JobApplication.create).toHaveBeenCalledWith([expect.objectContaining({ applicant: SEEKER, vacancy: JOB })], { session });
  expect(session.commitTransaction).toHaveBeenCalledTimes(1);
  expect(session.abortTransaction).not.toHaveBeenCalled();
  expect(session.endSession).toHaveBeenCalledTimes(1);
  expect(createNotificationForUser).toHaveBeenCalledWith(expect.objectContaining({ recipientId: EMPLOYER }));
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Application submitted successfully" }));
});

test("withdrawn application is reactivated without inserting another record", async () => {
  const existing = { _id: "application-1", status: "withdrawn", set: jest.fn(), save: jest.fn().mockResolvedValue(null) };
  JobApplication.findOne.mockReturnValue({ session: jest.fn().mockResolvedValue(existing) });
  await applyToJob(req, res);
  expect(existing.set).toHaveBeenCalledWith(expect.objectContaining({ status: "pending" }));
  expect(existing.save).toHaveBeenCalledWith({ session });
  expect(JobApplication.create).not.toHaveBeenCalled();
  expect(session.commitTransaction).toHaveBeenCalled();
  expect(session.endSession).toHaveBeenCalledTimes(1);
});

test("existing non-withdrawn application aborts and closes the session once", async () => {
  JobApplication.findOne.mockReturnValue({ session: jest.fn().mockResolvedValue({ status: "pending" }) });
  await applyToJob(req, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(session.abortTransaction).toHaveBeenCalledTimes(1);
  expect(session.endSession).toHaveBeenCalledTimes(1);
});

test.each(["resume", "coverLetterFile"])("missing required %s aborts without creating", async field => {
  delete req.files[field];
  await applyToJob(req, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(JobApplication.create).not.toHaveBeenCalled();
  expect(session.abortTransaction).toHaveBeenCalledTimes(1);
  expect(session.endSession).toHaveBeenCalledTimes(1);
});

test("library cover letter must still be tailored to this vacancy", async () => {
  delete req.files.coverLetterFile;
  req.body.coverLetterDocumentId = "444444444444444444444444";
  JobseekerDocument.findOne.mockResolvedValue({ sourceJobId: "555555555555555555555555" });
  await applyToJob(req, res);
  expect(JobseekerDocument.findOne).toHaveBeenCalledWith({ _id: req.body.coverLetterDocumentId, owner: SEEKER, kind: "coverLetter" });
  expect(res.status).toHaveBeenCalledWith(400);
  expect(JobApplication.create).not.toHaveBeenCalled();
  expect(session.endSession).toHaveBeenCalledTimes(1);
});

test("write failure rolls back and closes the session", async () => {
  JobApplication.create.mockRejectedValue(new Error("dummy write failure"));
  await applyToJob(req, res);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(session.abortTransaction).toHaveBeenCalledTimes(1);
  expect(session.endSession).toHaveBeenCalledTimes(1);
  expect(createNotificationForUser).not.toHaveBeenCalled();
});

test("failed session creation returns a controlled error", async () => {
  JobApplication.startSession.mockRejectedValue(new Error("dummy session failure"));
  await applyToJob(req, res);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(JobApplication.create).not.toHaveBeenCalled();
});
