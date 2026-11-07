// E-01: once applyToJob's transaction commits, a failing later step must not
// fail the request or delete the uploaded files; a failure BEFORE commit must
// still abort the session and clean the uploads up.

jest.mock("../models/JobVacancy", () => ({ findById: jest.fn(), updateOne: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ startSession: jest.fn(), findOne: jest.fn(), create: jest.fn() }));
jest.mock("../models/User", () => ({ findById: jest.fn() }));
jest.mock("../models/JobseekerDocument", () => ({ findOne: jest.fn() }));
jest.mock("../services/notificationService", () => ({ createNotificationForUser: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(null) }));
jest.mock("../services/storageService", () => ({ remove: jest.fn().mockResolvedValue(null) }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const express = require("express");
const request = require("supertest");

const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const User = require("../models/User");
const { createNotificationForUser } = require("../services/notificationService");
const { logAuditEvent } = require("../services/auditService");
const storageService = require("../services/storageService");
const logger = require("../utils/logger");
const { cleanupUploadedFiles } = require("../middleware/upload");
const { applyToJob } = require("../controllers/jobController");

const JOB = "333333333333333333333333";
const EMPLOYER = "111111111111111111111111";
const SEEKER = "222222222222222222222222";
const APPLICATION_ID = "444444444444444444444444";
const UPLOADS = ["cloudinary:resume-1", "cloudinary:letter-1"];

let session;

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.post(
    "/jobs/:id/apply",
    (req, _res, next) => {
      req.user = { id: SEEKER, role: "jobseeker" };
      req.files = {
        resume: [{ storedValue: UPLOADS[0] }],
        coverLetterFile: [{ storedValue: UPLOADS[1] }],
      };
      // Same shape persistFields leaves behind for cleanupUploadedFiles.
      req.uploadedObjects = [...UPLOADS];
      next();
    },
    cleanupUploadedFiles,
    applyToJob
  );
  return app;
};

beforeEach(() => {
  jest.clearAllMocks();
  JobVacancy.findById.mockResolvedValue({ _id: JOB, employer: EMPLOYER, title: "Clerk", status: "active", archived: false });
  JobVacancy.updateOne.mockReturnValue(Promise.resolve({}));
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
  JobApplication.create.mockResolvedValue([{ _id: APPLICATION_ID }]);
  createNotificationForUser.mockResolvedValue(null);
});

describe("applyToJob after commit (E-01)", () => {
  test("notification throws after commit: 200, application kept, uploads NOT removed, failure logged with ids", async () => {
    createNotificationForUser.mockRejectedValue(new Error("Notification.create failed"));

    const res = await request(buildApp()).post(`/jobs/${JOB}/apply`).send({});

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Application submitted successfully");
    expect(res.body.application._id).toBe(APPLICATION_ID);
    expect(session.commitTransaction).toHaveBeenCalledTimes(1);
    expect(session.abortTransaction).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalledTimes(1);
    expect(storageService.remove).not.toHaveBeenCalled();

    const failure = logger.error.mock.calls.find(([message]) => message === "Post-commit step failed");
    expect(failure).toBeDefined();
    expect(failure[1]).toMatchObject({
      step: "application.notify_employer",
      resourceType: "application",
      resourceId: APPLICATION_ID,
      userId: SEEKER,
      role: "jobseeker",
    });
    expect(failure[1].stack).toEqual(expect.any(String));
    // The audit event still runs after a failed notification.
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
  });

  test("audit step throws after commit: still 200 and files intact", async () => {
    logAuditEvent.mockRejectedValueOnce(new Error("audit sink down"));

    const res = await request(buildApp()).post(`/jobs/${JOB}/apply`).send({});

    expect(res.status).toBe(200);
    expect(storageService.remove).not.toHaveBeenCalled();
    expect(logger.error.mock.calls.some(([m, e]) => m === "Post-commit step failed" && e.step === "application.audit")).toBe(true);
  });

  test("a retry after the failed notification is not needed: the first response already succeeded (no created-twice path)", async () => {
    createNotificationForUser.mockRejectedValue(new Error("boom"));

    await request(buildApp()).post(`/jobs/${JOB}/apply`).send({});

    expect(JobApplication.create).toHaveBeenCalledTimes(1);
  });
});

describe("applyToJob before commit (E-01)", () => {
  test("failure before commit: 500, session aborted and ended, uploads removed, nothing committed", async () => {
    JobApplication.create.mockRejectedValue(new Error("insert failed"));

    const res = await request(buildApp()).post(`/jobs/${JOB}/apply`).send({});

    expect(res.status).toBe(500);
    expect(session.commitTransaction).not.toHaveBeenCalled();
    expect(session.abortTransaction).toHaveBeenCalledTimes(1);
    expect(session.endSession).toHaveBeenCalledTimes(1);
    expect(createNotificationForUser).not.toHaveBeenCalled();
    expect(storageService.remove.mock.calls.map(([ref]) => ref).sort()).toEqual([...UPLOADS].sort());
  });

  test("commit itself fails: session aborted/ended and uploads removed (nothing was saved)", async () => {
    session.commitTransaction.mockRejectedValue(new Error("commit failed"));

    const res = await request(buildApp()).post(`/jobs/${JOB}/apply`).send({});

    expect(res.status).toBe(500);
    expect(session.endSession).toHaveBeenCalledTimes(1);
    expect(createNotificationForUser).not.toHaveBeenCalled();
    expect(storageService.remove).toHaveBeenCalledTimes(UPLOADS.length);
  });

  test("abort itself throwing does not mask the original error or skip endSession", async () => {
    JobApplication.create.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
    session.abortTransaction.mockRejectedValue(new Error("abort failed"));

    const res = await request(buildApp()).post(`/jobs/${JOB}/apply`).send({});

    // E11000 still maps to the duplicate-apply message instead of a masked 500.
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("You have already applied to this job");
    expect(session.endSession).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls.some(([m]) => m === "Failed to abort application transaction")).toBe(true);
  });
});
