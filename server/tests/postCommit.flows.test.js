// E-29: for each flow whose primary write commits and is followed by a
// notification / audit / message step, a failure in that later step must not
// change the response to an error, and must not let upload cleanup delete
// files the saved record references.

jest.mock("../models/User", () => ({ findById: jest.fn(), find: jest.fn() }));
jest.mock("../models/JobVacancy", () => ({ findById: jest.fn(), find: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ findById: jest.fn(), countDocuments: jest.fn(), deleteMany: jest.fn() }));
jest.mock("../models/Conversation", () => ({}));
jest.mock("../models/Message", () => ({ create: jest.fn() }));
jest.mock("../models/JobseekerProfile", () => ({ findOne: jest.fn() }));
jest.mock("../models/EmployerProfile", () => ({}));
jest.mock("../models/AuditLog", () => ({}));
jest.mock("../models/Follow", () => ({}));
jest.mock("../models/SystemSettings", () => ({}));
jest.mock("../models/Announcement", () => ({ create: jest.fn(), findById: jest.fn(), findOne: jest.fn() }));
jest.mock("../models/NewsLike", () => ({}));
jest.mock("../models/SpesApplication", () => ({ create: jest.fn(), findOne: jest.fn() }));
jest.mock("../services/spesPostingService", () => ({
  resolvePosting: jest.fn(),
  applicationFilterFor: (p) => ({ posting: p._id }),
  applicationRefsFor: (p) => ({ posting: p._id }),
  listPublishedPostings: jest.fn(),
  listAllPostings: jest.fn(),
  announcePosting: jest.fn(),
}));
jest.mock("../utils/jobDisplay", () => ({}));
jest.mock("../utils/sanitize", () => ({ sanitizeText: (v) => v, escapeRegex: (v) => v }));
jest.mock("../services/sessionService", () => ({ forceLogout: jest.fn() }));
jest.mock("../services/notificationService", () => ({
  createNotificationForUser: jest.fn(),
  notifyManyUsers: jest.fn(),
  notifyNewsPublished: jest.fn(),
}));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn() }));
jest.mock("../services/storageService", () => ({ remove: jest.fn().mockResolvedValue(null) }));
jest.mock("../controllers/messageController", () => ({
  ensureConversationBetweenUsers: jest.fn(),
  postSystemMessage: jest.fn(),
}));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const express = require("express");
const request = require("supertest");

const User = require("../models/User");
const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const Announcement = require("../models/Announcement");
const SpesApplication = require("../models/SpesApplication");
const { resolvePosting } = require("../services/spesPostingService");
const notifications = require("../services/notificationService");
const { logAuditEvent } = require("../services/auditService");
const storageService = require("../services/storageService");
const { ensureConversationBetweenUsers } = require("../controllers/messageController");
const logger = require("../utils/logger");
const { cleanupUploadedFiles } = require("../middleware/upload");

const admin = require("../controllers/adminController");
const superadmin = require("../controllers/superadminController");
const verification = require("../controllers/verificationController");
const news = require("../controllers/newsController");
const spes = require("../controllers/spesController");
const employer = require("../controllers/employerController");

const ADMIN_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const TARGET_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";
const JOB_ID = "cccccccccccccccccccccccc";
const EMPLOYER_ID = "dddddddddddddddddddddddd";
const UPLOADS = ["cloudinary:file-1", "cloudinary:file-2"];

// Mounts one handler behind a stub user + the real cleanup middleware, with
// uploads already "persisted", so status AND file removal are both observable.
const call = (handler, { user, params = {}, body = {}, files, file } = {}) => {
  const app = express();
  app.use(express.json());
  app.all("/t/:id?/:applicationId?/:announcementId?", (req, _res, next) => {
    req.user = user;
    Object.assign(req.params, params);
    req.uploadedObjects = [...UPLOADS];
    req.files = files;
    req.file = file;
    req.app.set("io", null);
    next();
  }, cleanupUploadedFiles, handler);
  return request(app).post("/t/x").send(body);
};

const postCommitFailures = (step) =>
  logger.error.mock.calls.filter(([m, e]) => m === "Post-commit step failed" && (!step || e.step === step));

const expectFilesIntact = () => expect(storageService.remove).not.toHaveBeenCalled();

beforeEach(() => {
  jest.clearAllMocks();
  logAuditEvent.mockResolvedValue(undefined);
  notifications.createNotificationForUser.mockResolvedValue(null);
  notifications.notifyManyUsers.mockResolvedValue(null);
  notifications.notifyNewsPublished.mockResolvedValue(null);
});

describe("admin flows: notification fails after the change is saved", () => {
  const selectable = (doc) => ({ select: jest.fn().mockResolvedValue(doc) });
  const userDoc = (extra = {}) => ({ _id: TARGET_ID, role: "jobseeker", isActive: true, save: jest.fn().mockResolvedValue(undefined), ...extra });

  test("deactivateUser", async () => {
    const doc = userDoc();
    User.findById.mockReturnValue(selectable(doc));
    notifications.createNotificationForUser.mockRejectedValue(new Error("notify down"));

    const res = await call(admin.deactivateUser, { user: { id: ADMIN_ID, role: "admin" }, params: { id: TARGET_ID } });

    expect(res.status).toBe(200);
    expect(doc.save).toHaveBeenCalledTimes(1);
    expect(postCommitFailures("user_deactivate.notify_user")).toHaveLength(1);
  });

  test("reactivateUser", async () => {
    const doc = userDoc({ isActive: false, accountStatus: "suspended" });
    User.findById.mockReturnValue(selectable(doc));
    notifications.createNotificationForUser.mockRejectedValue(new Error("notify down"));

    const res = await call(admin.reactivateUser, { user: { id: ADMIN_ID, role: "admin" }, params: { id: TARGET_ID } });

    expect(res.status).toBe(200);
    expect(postCommitFailures("user_reactivate.notify_user")).toHaveLength(1);
  });

  test("updateUserRole (audit fails)", async () => {
    const doc = userDoc();
    User.findById.mockReturnValue(selectable(doc));
    logAuditEvent.mockRejectedValue(new Error("audit down"));

    const res = await call(admin.updateUserRole, { user: { id: ADMIN_ID, role: "admin" }, params: { id: TARGET_ID }, body: { role: "employer" } });

    expect(res.status).toBe(200);
    expect(doc.save).toHaveBeenCalledTimes(1);
    expect(postCommitFailures("user_role.audit")).toHaveLength(1);
    // The notification still goes out after a failed audit write.
    expect(notifications.createNotificationForUser).toHaveBeenCalledTimes(1);
  });

  test("updateJobStatus", async () => {
    const job = { _id: JOB_ID, employer: EMPLOYER_ID, title: "Clerk", status: "active", save: jest.fn().mockResolvedValue(undefined) };
    JobVacancy.findById.mockResolvedValue(job);
    notifications.createNotificationForUser.mockRejectedValue(new Error("notify down"));

    const res = await call(admin.updateJobStatus, { user: { id: ADMIN_ID, role: "admin" }, params: { id: JOB_ID }, body: { status: "closed" } });

    expect(res.status).toBe(200);
    expect(job.save).toHaveBeenCalledTimes(1);
    expect(postCommitFailures("job_status.notify_employer")).toHaveLength(1);
  });
});

describe("superadmin deleteJob: notification fails after deletion", () => {
  test("returns success and logs the failed step", async () => {
    JobVacancy.findById.mockResolvedValue({ _id: JOB_ID, employer: EMPLOYER_ID, title: "Clerk" });
    JobVacancy.findByIdAndDelete = jest.fn().mockResolvedValue(null);
    JobApplication.countDocuments.mockResolvedValue(2);
    JobApplication.deleteMany.mockResolvedValue({});
    notifications.createNotificationForUser.mockRejectedValue(new Error("notify down"));

    const res = await call(superadmin.deleteJob, { user: { id: ADMIN_ID, role: "superadmin" }, params: { id: JOB_ID }, body: {} });

    expect(res.status).toBe(200);
    expect(res.body.removedApplications).toBe(2);
    expect(postCommitFailures("job_takedown.notify_employer")).toHaveLength(1);
  });
});

describe("verification submit: notifying admins fails after the save", () => {
  test("200, status saved, permit/registration files NOT removed", async () => {
    const doc = {
      _id: EMPLOYER_ID, role: "employer", verificationStatus: "unverified", businessPermitUrl: "", registrationDocUrl: "",
      save: jest.fn().mockResolvedValue(undefined),
    };
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(doc) });
    User.find.mockReturnValue({ select: jest.fn().mockResolvedValue([{ _id: ADMIN_ID }]) });
    notifications.notifyManyUsers.mockRejectedValue(new Error("notify down"));
    notifications.createNotificationForUser.mockRejectedValue(new Error("notify down"));

    const res = await call(verification.submitEmployerVerificationWithDocuments, {
      user: { id: EMPLOYER_ID, role: "employer" },
      params: { id: EMPLOYER_ID },
      files: { businessPermit: [{ storedValue: UPLOADS[0] }], registrationDoc: [{ storedValue: UPLOADS[1] }] },
    });

    expect(res.status).toBe(200);
    expect(res.body.verificationStatus).toBe("pending");
    expect(doc.save).toHaveBeenCalledTimes(1);
    expectFilesIntact();
  });

  test("a failure BEFORE the save (missing documents) still cleans the uploads up", async () => {
    const doc = { _id: EMPLOYER_ID, role: "employer", verificationStatus: "unverified", businessPermitUrl: "", registrationDocUrl: "", save: jest.fn() };
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(doc) });

    const res = await call(verification.submitEmployerVerificationWithDocuments, {
      user: { id: EMPLOYER_ID, role: "employer" },
      params: { id: EMPLOYER_ID },
      files: { businessPermit: [{ storedValue: UPLOADS[0] }] },
    });

    expect(res.status).toBe(400);
    expect(doc.save).not.toHaveBeenCalled();
    expect(storageService.remove).toHaveBeenCalledTimes(UPLOADS.length);
  });
});

describe("news create: fan-out notification fails after the save", () => {
  test("201, image NOT removed, failure logged", async () => {
    Announcement.create.mockResolvedValue({ _id: JOB_ID, category: "general", isActive: true });
    Announcement.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue({ _id: JOB_ID, title: "Hello" }) });
    // notifyNewsPublished is local to newsController: it looks up recipients,
    // then calls notifyManyUsers. Fail the fan-out itself.
    User.find.mockReturnValue({ select: jest.fn().mockResolvedValue([{ _id: TARGET_ID }]) });
    notifications.notifyManyUsers.mockRejectedValue(new Error("fan-out failed"));

    const res = await call(news.createNews, {
      user: { id: ADMIN_ID, role: "admin" },
      body: { title: "Hello", content: "World", category: "general" },
      file: { storedValue: UPLOADS[0], originalname: "a.png" },
    });

    expect(res.status).toBe(201);
    expect(res.body.item.title).toBe("Hello");
    expectFilesIntact();
    expect(postCommitFailures("news_create.notify_users")).toHaveLength(1);
  });
});

describe("SPES apply: notifications fail after the application is saved", () => {
  test("201, application kept, documents NOT removed", async () => {
    resolvePosting.mockResolvedValue({ _id: JOB_ID, title: "SPES 2026", status: "published", results: { status: "pending" }, requiredSlots: [] });
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: TARGET_ID, role: "jobseeker", name: "Juan", hasCompletedOnboarding: true, dateOfBirth: new Date("2008-01-01") }),
    });
    User.find.mockReturnValue({ select: jest.fn().mockResolvedValue([{ _id: ADMIN_ID }]) });
    SpesApplication.findOne.mockResolvedValue(null);
    SpesApplication.create.mockResolvedValue({ _id: "spes-1" });
    notifications.notifyManyUsers.mockRejectedValue(new Error("notify down"));
    notifications.createNotificationForUser.mockRejectedValue(new Error("notify down"));

    const res = await call(spes.applyToSpes, {
      user: { id: TARGET_ID, role: "jobseeker" },
      params: { postingId: JOB_ID },
      body: { applicantType: "student", school: "MNHS", gradeLevel: "Grade 12", gwa: "88", gwaScale: "percent", guardianName: "Maria", guardianContact: "09171234567" },
      // One typed file per required slot (a student needs these four).
      files: {
        form2: [{ storedValue: UPLOADS[0], originalname: "form2.pdf", mimetype: "application/pdf", size: 10 }],
        proof_of_age: [{ storedValue: UPLOADS[1], originalname: "age.pdf", mimetype: "application/pdf", size: 10 }],
        proof_of_financial_status: [{ storedValue: UPLOADS[1], originalname: "itr.pdf", mimetype: "application/pdf", size: 10 }],
        proof_of_academic_standing: [{ storedValue: UPLOADS[0], originalname: "grades.pdf", mimetype: "application/pdf", size: 10 }],
      },
    });

    expect(res.status).toBe(201);
    expect(SpesApplication.create).toHaveBeenCalledTimes(1);
    expectFilesIntact();
    expect(postCommitFailures("spes_apply.notify_admins")).toHaveLength(1);
    expect(postCommitFailures("spes_apply.notify_applicant")).toHaveLength(1);
  });
});

describe("employer application status: notification and message fail after the save", () => {
  test("200, status saved, failures logged with the application id", async () => {
    const application = {
      _id: "app-1",
      status: "pending",
      vacancy: { title: "Clerk", employer: EMPLOYER_ID },
      applicant: { _id: TARGET_ID, name: "Juan" },
      save: jest.fn().mockResolvedValue(undefined),
      toObject() { return { ...this }; },
    };
    const chain = { populate: jest.fn() };
    chain.populate.mockReturnValueOnce(chain).mockResolvedValueOnce(application);
    const refetch = { populate: jest.fn() };
    refetch.populate.mockReturnValueOnce(refetch).mockResolvedValueOnce(application);
    JobApplication.findById.mockReturnValueOnce(chain).mockReturnValueOnce(refetch);
    notifications.createNotificationForUser.mockRejectedValue(new Error("notify down"));
    ensureConversationBetweenUsers.mockRejectedValue(new Error("conversation down"));
    require("../models/JobseekerProfile").findOne.mockResolvedValue(null);

    const res = await call(employer.updateApplicationStatus, {
      user: { id: EMPLOYER_ID, role: "employer" },
      params: { applicationId: "app-1" },
      body: { status: "shortlisted" },
    });

    expect(res.status).toBe(200);
    expect(application.save).toHaveBeenCalledTimes(1);
    expect(postCommitFailures("application_status.notify_applicant")).toHaveLength(1);
    expect(postCommitFailures("application_status.auto_message")).toHaveLength(1);
    expect(postCommitFailures("application_status.notify_applicant")[0][1]).toMatchObject({ resourceId: "app-1", userId: EMPLOYER_ID, role: "employer" });
  });
});

describe("employer interview flows: notification and message fail after the save", () => {
  const buildApplication = (extra = {}) => {
    const application = {
      _id: "app-2",
      status: "shortlisted",
      vacancy: { title: "Clerk", employer: EMPLOYER_ID },
      applicant: { _id: TARGET_ID, name: "Juan" },
      interview: { scheduledAt: new Date(Date.now() - 3600000) },
      save: jest.fn().mockResolvedValue(undefined),
      ...extra,
    };
    const chain = { populate: jest.fn() };
    chain.populate.mockReturnValueOnce(chain).mockResolvedValueOnce(application);
    JobApplication.findById.mockReturnValueOnce(chain);
    return application;
  };

  beforeEach(() => {
    notifications.createNotificationForUser.mockRejectedValue(new Error("notify down"));
    ensureConversationBetweenUsers.mockRejectedValue(new Error("conversation down"));
  });

  test("scheduleInterview", async () => {
    const application = buildApplication({ interview: {} });

    const res = await call(employer.scheduleInterview, {
      user: { id: EMPLOYER_ID, role: "employer" },
      params: { applicationId: "app-2" },
      body: { scheduledAt: new Date(Date.now() + 86400000).toISOString(), mode: "online", location: "https://meet.example/abc" },
    });

    expect(res.status).toBe(200);
    expect(application.save).toHaveBeenCalledTimes(1);
    expect(postCommitFailures("interview.notify_applicant")).toHaveLength(1);
    expect(postCommitFailures("interview.auto_message")).toHaveLength(1);
    expect(postCommitFailures("interview.notify_applicant")[0][1]).toMatchObject({ resourceId: "app-2", userId: EMPLOYER_ID, role: "employer" });
  });

  test("markInterviewNoShow", async () => {
    const application = buildApplication({ interview: { scheduledAt: new Date(Date.now() - 3600000), updatedAt: null } });

    const res = await call(employer.markInterviewNoShow, {
      user: { id: EMPLOYER_ID, role: "employer" },
      params: { applicationId: "app-2" },
    });

    expect(res.status).toBe(200);
    expect(application.save).toHaveBeenCalledTimes(1);
    expect(application.status).toBe("rejected");
    expect(postCommitFailures("no_show.notify_applicant")).toHaveLength(1);
    expect(postCommitFailures("no_show.auto_message")).toHaveLength(1);
  });
});
