// SPES lifecycle: the pure state machine, eligibility on apply, what an
// applicant can see and when, every admin transition (allowed and forbidden),
// document verification, release, amendment, and the notification + audit
// writes. Models and services are mocked (no database, no email).

jest.mock("../models/User", () => ({ findById: jest.fn(), find: jest.fn() }));
jest.mock("../models/Announcement", () => ({ findOne: jest.fn(), findById: jest.fn(), find: jest.fn() }));
jest.mock("../models/SpesApplication", () => ({
  create: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  findById: jest.fn(),
  updateMany: jest.fn(),
  exists: jest.fn(),
  aggregate: jest.fn(),
  countDocuments: jest.fn(),
}));
jest.mock("../services/notificationService", () => ({
  createNotificationForUser: jest.fn().mockResolvedValue(null),
  notifyManyUsers: jest.fn().mockResolvedValue(null),
}));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const express = require("express");
const request = require("supertest");

const User = require("../models/User");
const Announcement = require("../models/Announcement");
const SpesApplication = require("../models/SpesApplication");
const notifications = require("../services/notificationService");
const { logAuditEvent } = require("../services/auditService");
const spes = require("../controllers/spesController");
const lifecycle = require("../utils/spesLifecycle");
const { requiredSlotsFor } = require("../utils/spesDocuments");

const ADMIN = "aaaaaaaaaaaaaaaaaaaaaaaa";
const APPLICANT = "bbbbbbbbbbbbbbbbbbbbbbbb";
const PROGRAM = "cccccccccccccccccccccccc";
const APP_ID = "dddddddddddddddddddddddd";
const DOC_ID = "eeeeeeeeeeeeeeeeeeeeeeee";

// ---------------------------------------------------------------- helpers
// A thenable query chain: .populate/.sort/... return itself, awaiting yields value.
const q = (value) => {
  const o = {
    populate: () => o,
    sort: () => o,
    skip: () => o,
    limit: () => o,
    select: () => o,
    then: (res, rej) => Promise.resolve(value).then(res, rej),
  };
  return o;
};

const dobYearsAgo = (years, dayOffset = 0) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate() + dayOffset));
};

const doc = (overrides = {}) => ({
  slot: "form2",
  label: "form2.pdf",
  fileUrl: "cloudinary:f1",
  verification: { state: "pending", reason: "" },
  ...overrides,
});

// A SpesApplication stand-in with the bits the controller touches.
const makeApp = (overrides = {}) => {
  const documents = overrides.documents || [
    doc({ _id: DOC_ID, slot: "form2" }),
    doc({ _id: "e2", slot: "proof_of_age" }),
  ];
  documents.id = (id) => documents.find((d) => String(d._id) === String(id)) || null;
  documents.set = (i, v) => {
    documents[i] = v;
  };
  const base = {
    _id: APP_ID,
    applicant: { _id: APPLICANT, name: "Juan Dela Cruz", email: "juan@example.com", dateOfBirth: dobYearsAgo(20) },
    announcement: { _id: PROGRAM, title: "SPES 2026", spes: {} },
    status: "documents_review",
    applicantType: "student",
    isOutOfSchoolYouth: false,
    adminNote: "internal note",
    evaluation: { examScore: null, interviewScore: null, examTakenAt: null, interviewAt: null, evaluatedBy: null },
    result: { outcome: "pending", rank: null, remarks: "", decidedBy: null, decidedAt: null },
    disqualification: { reason: "", by: null, at: null },
    needsResubmission: { reason: "", requestedAt: null },
    resultReleasedAt: null,
    ...overrides,
    documents,
  };
  base.save = jest.fn().mockResolvedValue(base);
  base.toObject = () => JSON.parse(JSON.stringify({ ...base, save: undefined, toObject: undefined }));
  return base;
};

const run = (handler, { user = { id: ADMIN, role: "admin" }, params = {}, body = {}, query = {}, files, file } = {}) => {
  const app = express();
  app.use(express.json());
  app.all("/t/:id?/:docId?/:announcementId?/:slot?", (req, _res, next) => {
    req.user = user;
    Object.assign(req.params, params);
    req.files = files;
    req.file = file;
    req.app.set("io", null);
    next();
  }, handler);
  return request(app).post("/t/x").query(query).send(body);
};

const auditActions = () => logAuditEvent.mock.calls.map(([e]) => e.action);
const notifiedTitles = () =>
  [...notifications.createNotificationForUser.mock.calls, ...notifications.notifyManyUsers.mock.calls].map(([a]) => a.title);

beforeEach(() => {
  jest.clearAllMocks();
  logAuditEvent.mockResolvedValue(undefined);
  notifications.createNotificationForUser.mockResolvedValue(null);
  notifications.notifyManyUsers.mockResolvedValue(null);
});

// ------------------------------------------------------------ state machine
describe("lifecycle state machine", () => {
  const { STATUS, canAdminTransition, canWithdraw, normalizeStatus } = lifecycle;

  test("legacy statuses read through the new lifecycle", () => {
    expect(normalizeStatus("under_review")).toBe(STATUS.DOCUMENTS_REVIEW);
    expect(normalizeStatus("for_exam")).toBe(STATUS.QUALIFIED);
    expect(normalizeStatus("for_interview")).toBe(STATUS.QUALIFIED);
    expect(normalizeStatus("submitted")).toBe("submitted");
  });

  test.each([
    ["submitted", "documents_review", true],
    ["submitted", "qualified", false],
    ["documents_review", "needs_resubmission", true],
    ["documents_review", "qualified", true],
    ["documents_review", "evaluated", false],
    ["needs_resubmission", "documents_review", true],
    ["needs_resubmission", "qualified", false],
    ["qualified", "evaluated", true],
    ["evaluated", "result_recorded", true],
    ["result_recorded", "evaluated", true],
    ["qualified", "results_released", false],
    ["results_released", "disqualified", false],
    ["withdrawn", "documents_review", false],
    ["disqualified", "qualified", false],
    ["submitted", "disqualified", true],
    ["evaluated", "disqualified", true],
  ])("admin %s -> %s allowed: %s", (from, to, allowed) => {
    expect(canAdminTransition(from, to)).toBe(allowed);
  });

  test("an applicant may withdraw until a result is recorded", () => {
    ["submitted", "documents_review", "needs_resubmission", "qualified", "evaluated"].forEach((s) =>
      expect(canWithdraw(s)).toBe(true)
    );
    ["result_recorded", "results_released", "withdrawn", "disqualified"].forEach((s) =>
      expect(canWithdraw(s)).toBe(false)
    );
  });
});

// ------------------------------------------------------------------ apply
describe("applyToSpes: eligibility and validation", () => {
  const filesFor = (slots) =>
    Object.fromEntries(
      slots.map((s) => [s, [{ storedValue: `cloudinary:${s}`, originalname: `${s}.pdf`, mimetype: "application/pdf", size: 100 }]])
    );
  const STUDENT_SLOTS = ["form2", "proof_of_age", "proof_of_financial_status", "proof_of_academic_standing"];
  const studentBody = {
    applicantType: "student",
    school: "MNHS",
    gradeLevel: "Grade 12",
    gwa: "88",
    gwaScale: "percent",
    contactNumber: "09171234567",
  };

  const arrange = ({ dob = dobYearsAgo(20), spesCfg = {}, nsrp = true, existing = null } = {}) => {
    Announcement.findOne.mockResolvedValue({ _id: PROGRAM, category: "spes", title: "SPES 2026", spes: spesCfg });
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: APPLICANT,
        role: "jobseeker",
        name: "Juan",
        hasCompletedOnboarding: nsrp,
        dateOfBirth: dob,
      }),
    });
    User.find.mockReturnValue({ select: jest.fn().mockResolvedValue([{ _id: ADMIN }]) });
    SpesApplication.findOne.mockResolvedValue(existing);
    SpesApplication.create.mockImplementation(async (data) => makeApp({ ...data, announcement: PROGRAM, applicant: APPLICANT }));
  };
  const apply = (extra = {}) =>
    run(spes.applyToSpes, {
      user: { id: APPLICANT, role: "jobseeker" },
      params: { announcementId: PROGRAM },
      body: studentBody,
      files: filesFor(STUDENT_SLOTS),
      ...extra,
    });

  test("a valid 20-year-old student applies: 201, submitted, notifications and audit written", async () => {
    arrange();
    const res = await apply();
    expect(res.status).toBe(201);
    const data = SpesApplication.create.mock.calls[0][0];
    expect(data.status).toBe("submitted");
    expect(data.applicantType).toBe("student");
    expect(data.ageTierAtApplication).toBe("adult18to30");
    expect(data.gwa).toBe(88);
    expect(data.gwaScale).toBe("percent");
    expect(data.documents.map((d) => d.slot).sort()).toEqual([...STUDENT_SLOTS].sort());
    expect(data.documents.every((d) => d.verification.state === "pending")).toBe(true);
    expect(notifiedTitles()).toEqual(expect.arrayContaining(["New SPES application", "SPES application received"]));
    expect(auditActions()).toContain("spes.application.submitted");
  });

  test.each([
    ["under 15", () => dobYearsAgo(15, 1), "AGE_UNDER_MINIMUM"],
    ["31 years old", () => dobYearsAgo(31), "SPES_AGE_ABOVE_MAX"],
    ["no date of birth", () => null, "DOB_REQUIRED"],
  ])("%s is refused on the server with %s and nothing is created", async (_l, dob, code) => {
    arrange({ dob: dob() });
    const res = await apply();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(code);
    expect(SpesApplication.create).not.toHaveBeenCalled();
  });

  test("exactly 30 and exactly 15 are accepted", async () => {
    for (const dob of [dobYearsAgo(30), dobYearsAgo(15)]) {
      arrange({ dob });
      const res = await apply({ body: { ...studentBody, guardianName: "Maria", guardianContact: "09170000000" } });
      expect(res.status).toBe(201);
    }
  });

  test("a deadline in the past -> SPES_DEADLINE_PASSED; a closed program -> SPES_NOT_OPEN", async () => {
    arrange({ spesCfg: { applicationDeadline: new Date(Date.now() - 86400000) } });
    expect((await apply()).body.code).toBe("SPES_DEADLINE_PASSED");
    arrange({ spesCfg: { closedAt: new Date(Date.now() - 1000) } });
    expect((await apply()).body.code).toBe("SPES_NOT_OPEN");
    expect(SpesApplication.create).not.toHaveBeenCalled();
  });

  test("incomplete NSRP -> NSRP_INCOMPLETE", async () => {
    arrange({ nsrp: false });
    expect((await apply()).body.code).toBe("NSRP_INCOMPLETE");
  });

  test("a second application -> 409 SPES_ALREADY_APPLIED", async () => {
    arrange({ existing: makeApp() });
    const res = await apply();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SPES_ALREADY_APPLIED");
  });

  test("a missing required document slot -> SPES_DOCS_MISSING with the missing slots", async () => {
    arrange();
    const res = await apply({ files: filesFor(["form2", "proof_of_age"]) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SPES_DOCS_MISSING");
    expect(res.body.missingSlots.sort()).toEqual(["proof_of_academic_standing", "proof_of_financial_status"]);
  });

  test("an out-of-school youth needs the OSY certification instead of the academic proof, and no school", async () => {
    arrange();
    const osySlots = ["form2", "proof_of_age", "proof_of_financial_status", "osy_certification"];
    const res = await apply({ body: { applicantType: "osy", contactNumber: "09171234567" }, files: filesFor(osySlots) });
    expect(res.status).toBe(201);
    const data = SpesApplication.create.mock.calls[0][0];
    expect(data.isOutOfSchoolYouth).toBe(true);
    expect(data.school).toBe("");
    expect(data.gwa).toBeNull();
  });

  test("a 16-year-old must give a guardian; relaxing the config flag is the only way around it", async () => {
    arrange({ dob: dobYearsAgo(16, -30) });
    const res = await apply();
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SPES_GUARDIAN_REQUIRED");

    const ok = await apply({ body: { ...studentBody, guardianName: "Maria", guardianContact: "09170000000" } });
    expect(ok.status).toBe(201);
    expect(SpesApplication.create.mock.calls[0][0].ageTierAtApplication).toBe("minor15to17");
  });

  test("an invalid GWA for its scale is rejected", async () => {
    arrange();
    const res = await apply({ body: { ...studentBody, gwa: "6", gwaScale: "one_to_five" } });
    expect(res.body.code).toBe("SPES_GWA_INVALID");
  });

  test("a program's requiredSlots narrows what is required", () => {
    expect(requiredSlotsFor({ spes: { requiredSlots: ["form2", "proof_of_age"] } }, "student")).toEqual(["form2", "proof_of_age"]);
    expect(requiredSlotsFor({ spes: {} }, "osy")).toContain("osy_certification");
    expect(requiredSlotsFor({ spes: {} }, "osy")).not.toContain("proof_of_academic_standing");
  });
});

// ------------------------------------------------------- applicant visibility
describe("what an applicant can see", () => {
  const mine = (appDoc) => {
    SpesApplication.findOne.mockReturnValue(q(appDoc));
    return run(spes.getMySpesApplication, {
      user: { id: APPLICANT, role: "jobseeker" },
      params: { announcementId: PROGRAM },
    });
  };

  test("before release: no result, no scores, no internal note, and result_recorded reads as evaluated", async () => {
    const app = makeApp({
      status: "result_recorded",
      evaluation: { examScore: 90, interviewScore: 80 },
      result: { outcome: "accepted", rank: 1, remarks: "congrats" },
    });
    const res = await mine(app);
    const a = res.body.application;
    expect(a.result).toBeUndefined();
    expect(a.evaluation).toBeUndefined();
    expect(a.adminNote).toBeUndefined();
    expect(a.status).toBe("evaluated");
  });

  test("a disqualification reason is visible straight away, without releasing results", async () => {
    const app = makeApp({
      status: "disqualified",
      disqualification: { reason: "Birth certificate does not match", by: ADMIN, at: new Date() },
    });
    const res = await mine(app);
    expect(res.body.application.status).toBe("disqualified");
    expect(res.body.application.disqualification.reason).toBe("Birth certificate does not match");
    expect(res.body.application.disqualification.by).toBeUndefined();
    expect(res.body.application.result).toBeUndefined();
  });

  test("a resubmission reason and the per-document reasons are visible while documents need replacing", async () => {
    const documents = [doc({ _id: DOC_ID, verification: { state: "needs_replacement", reason: "Photo is blurry", by: ADMIN } })];
    const app = makeApp({ status: "needs_resubmission", documents, needsResubmission: { reason: "Photo is blurry", requestedAt: new Date() } });
    const res = await mine(app);
    expect(res.body.application.needsResubmission.reason).toBe("Photo is blurry");
    expect(res.body.application.documents[0].verification.reason).toBe("Photo is blurry");
    expect(res.body.application.documents[0].verification.by).toBeUndefined();
  });

  test("after release: result and remarks are shown; scores only when the program exposes them", async () => {
    const base = {
      status: "results_released",
      resultReleasedAt: new Date(),
      evaluation: { examScore: 90, interviewScore: 80 },
      result: { outcome: "waitlisted", rank: 3, remarks: "Next batch" },
    };
    const hidden = (await mine(makeApp({ ...base, announcement: { _id: PROGRAM, spes: { exposeScores: false } } }))).body.application;
    expect(hidden.result.outcome).toBe("waitlisted");
    expect(hidden.evaluation.examScore).toBeUndefined();

    const shown = (await mine(makeApp({ ...base, announcement: { _id: PROGRAM, spes: { exposeScores: true } } }))).body.application;
    expect(shown.evaluation.examScore).toBe(90);
  });
});

// ------------------------------------------------------------ admin changes
describe("adminRecordEvaluation: transitions, validation, notifications, audit", () => {
  const evaluate = (appDoc, body) => {
    SpesApplication.findById.mockReturnValue(q(appDoc));
    return run(spes.adminRecordEvaluation, { params: { id: APP_ID }, body });
  };

  test("the response is a populated application: a real name, an age tier, and never the date of birth", async () => {
    const app = makeApp({ status: "qualified" });
    const res = await evaluate(app, { examScore: 85 });
    expect(res.status).toBe(200);
    const a = res.body.application;
    expect(a.applicant.name).toBe("Juan Dela Cruz");
    expect(a.applicant.email).toBe("juan@example.com");
    expect(a.applicantAgeTier).toBe("adult18to30");
    expect(a.applicant.dateOfBirth).toBeUndefined();
    expect(a.applicantMissingProfile).toBe(false);
  });

  test("an applicant with no profile name is flagged, not renamed", async () => {
    const app = makeApp({ status: "qualified", applicant: { _id: APPLICANT, name: "", email: "x@y.co", dateOfBirth: null } });
    const res = await evaluate(app, { examScore: 85 });
    expect(res.body.application.applicantMissingProfile).toBe(true);
    expect(res.body.application.applicantAgeTier).toBe("unknown");
  });

  test("a deleted applicant account is reported as deleted, not as a missing name", async () => {
    const res = await evaluate(makeApp({ status: "qualified", applicant: null }), { examScore: 85 });
    expect(res.status).toBe(200);
    expect(res.body.application.applicantDeleted).toBe(true);
    expect(res.body.application.applicantMissingProfile).toBe(false);
    expect(res.body.application.applicantAgeTier).toBeUndefined();
  });

  test("qualifying needs every document verified", async () => {
    const pending = makeApp({ status: "documents_review" });
    const refused = await evaluate(pending, { status: "qualified" });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("SPES_DOCS_NOT_VERIFIED");

    const verified = makeApp({
      status: "documents_review",
      documents: [doc({ _id: DOC_ID, verification: { state: "verified" } }), doc({ _id: "e2", slot: "proof_of_age", verification: { state: "verified" } })],
    });
    const ok = await evaluate(verified, { status: "qualified" });
    expect(ok.status).toBe(200);
    expect(verified.status).toBe("qualified");
    expect(notifiedTitles()).toContain("SPES: you are qualified");
    expect(auditActions()).toContain("spes.application.qualified");
  });

  test("disqualifying needs a reason, then notifies the applicant with it and audits at warning level", async () => {
    const noReason = await evaluate(makeApp({ status: "documents_review" }), { status: "disqualified" });
    expect(noReason.status).toBe(400);
    expect(noReason.body.code).toBe("SPES_REASON_REQUIRED");

    const app = makeApp({ status: "documents_review" });
    const ok = await evaluate(app, { status: "disqualified", remarks: "Over the income limit" });
    expect(ok.status).toBe(200);
    expect(app.disqualification.reason).toBe("Over the income limit");
    const message = notifications.createNotificationForUser.mock.calls[0][0].message;
    expect(message).toContain("Over the income limit");
    const event = logAuditEvent.mock.calls.map(([e]) => e).find((e) => e.action === "spes.application.disqualified");
    expect(event.severity).toBe("warning");
  });

  test("requesting a resubmission needs a rejected document and notifies the applicant", async () => {
    const none = await evaluate(makeApp({ status: "documents_review" }), { status: "needs_resubmission" });
    expect(none.body.code).toBe("SPES_NO_DOCS_REJECTED");

    const app = makeApp({
      status: "documents_review",
      documents: [doc({ _id: DOC_ID, verification: { state: "needs_replacement", reason: "Blurry" } })],
    });
    const ok = await evaluate(app, { status: "needs_resubmission" });
    expect(ok.status).toBe(200);
    expect(app.needsResubmission.reason).toContain("Blurry");
    expect(notifiedTitles()).toContain("SPES: documents need replacing");
  });

  test("forbidden jumps are refused", async () => {
    const res = await evaluate(makeApp({ status: "submitted" }), { status: "qualified" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SPES_TRANSITION_NOT_ALLOWED");
    const done = makeApp({ status: "disqualified" });
    expect((await evaluate(done, { status: "qualified" })).body.code).toBe("SPES_TRANSITION_NOT_ALLOWED");
  });

  test("scores and results need a qualified applicant", async () => {
    const res = await evaluate(makeApp({ status: "documents_review" }), { examScore: 80 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SPES_NOT_QUALIFIED");
  });

  test.each([["101"], ["-1"], ["abc"]])("score %s is invalid", async (score) => {
    const res = await evaluate(makeApp({ status: "qualified" }), { examScore: score });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SPES_SCORE_INVALID");
  });

  test("recording scores moves qualified -> evaluated; recording a result moves it to result_recorded", async () => {
    const app = makeApp({ status: "qualified" });
    await evaluate(app, { examScore: 90, interviewScore: 85 });
    expect(app.status).toBe("evaluated");
    expect(app.evaluation.examScore).toBe(90);
    expect(app.evaluation.interviewScore).toBe(85);

    await evaluate(app, { outcome: "accepted", rank: 2, remarks: "Welcome" });
    expect(app.status).toBe("result_recorded");
    expect(app.result.outcome).toBe("accepted");
    expect(app.result.rank).toBe(2);
    expect(auditActions()).toEqual(expect.arrayContaining(["spes.evaluation.recorded", "spes.result.recorded"]));
  });

  test("a result needs a score first, and a rank must be a whole number", async () => {
    const noScore = await evaluate(makeApp({ status: "qualified" }), { outcome: "accepted" });
    expect(noScore.body.code).toBe("SPES_SCORES_REQUIRED");
    const badRank = await evaluate(makeApp({ status: "evaluated", evaluation: { examScore: 80 } }), { outcome: "accepted", rank: "1.5" });
    expect(badRank.body.code).toBe("SPES_RANK_INVALID");
  });

  test("after release this endpoint refuses to change anything", async () => {
    const res = await evaluate(makeApp({ status: "results_released", resultReleasedAt: new Date() }), { examScore: 50 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SPES_ALREADY_RELEASED");
  });
});

describe("adminVerifyDocument", () => {
  const verify = (appDoc, body) => {
    SpesApplication.findById.mockReturnValue(q(appDoc));
    return run(spes.adminVerifyDocument, { params: { id: APP_ID, docId: DOC_ID }, body });
  };

  test("needs_replacement requires a reason; verified does not", async () => {
    expect((await verify(makeApp(), { state: "needs_replacement" })).body.code).toBe("SPES_REASON_REQUIRED");

    const app = makeApp({ status: "submitted" });
    const ok = await verify(app, { state: "verified" });
    expect(ok.status).toBe(200);
    expect(app.documents[0].verification.state).toBe("verified");
    expect(app.status).toBe("documents_review");
    expect(auditActions()).toContain("spes.document.verified");
  });

  test("a document cannot be reviewed once results are released", async () => {
    const res = await verify(makeApp({ status: "results_released", resultReleasedAt: new Date() }), { state: "verified" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SPES_DOCS_LOCKED");
  });
});

describe("replaceMyDocument and withdraw", () => {
  test("replacing the last rejected document sends the application back to review and tells the admins", async () => {
    const app = makeApp({
      status: "needs_resubmission",
      documents: [doc({ _id: DOC_ID, slot: "form2", verification: { state: "needs_replacement", reason: "Blurry" } })],
      needsResubmission: { reason: "Blurry", requestedAt: new Date() },
    });
    SpesApplication.findOne.mockResolvedValue(app);
    User.find.mockReturnValue({ select: jest.fn().mockResolvedValue([{ _id: ADMIN }]) });
    const res = await run(spes.replaceMyDocument, {
      user: { id: APPLICANT, role: "jobseeker" },
      params: { announcementId: PROGRAM, slot: "form2" },
      file: { storedValue: "cloudinary:new", originalname: "new.pdf", mimetype: "application/pdf", size: 5 },
    });
    expect(res.status).toBe(200);
    expect(app.documents[0].fileUrl).toBe("cloudinary:new");
    expect(app.documents[0].verification.state).toBe("pending");
    expect(app.status).toBe("documents_review");
    expect(notifiedTitles()).toContain("SPES documents resubmitted");
  });

  test("documents cannot be replaced once the applicant is qualified", async () => {
    SpesApplication.findOne.mockResolvedValue(makeApp({ status: "qualified" }));
    const res = await run(spes.replaceMyDocument, {
      user: { id: APPLICANT, role: "jobseeker" },
      params: { announcementId: PROGRAM, slot: "form2" },
      file: { storedValue: "cloudinary:new", originalname: "new.pdf", mimetype: "application/pdf", size: 5 },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SPES_DOCS_LOCKED");
  });

  test("withdraw works before a result and is refused after", async () => {
    const early = makeApp({ status: "documents_review" });
    SpesApplication.findOne.mockReturnValue(q(early));
    User.find.mockReturnValue({ select: jest.fn().mockResolvedValue([{ _id: ADMIN }]) });
    const ok = await run(spes.withdrawMyApplication, { user: { id: APPLICANT, role: "jobseeker" }, params: { announcementId: PROGRAM } });
    expect(ok.status).toBe(200);
    expect(early.status).toBe("withdrawn");
    expect(auditActions()).toContain("spes.application.withdrawn");

    SpesApplication.findOne.mockReturnValue(q(makeApp({ status: "result_recorded" })));
    const refused = await run(spes.withdrawMyApplication, { user: { id: APPLICANT, role: "jobseeker" }, params: { announcementId: PROGRAM } });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("SPES_WITHDRAW_NOT_ALLOWED");
  });
});

// -------------------------------------------------------- release + amend
describe("results release and amendment", () => {
  const program = (overrides = {}) => {
    const p = {
      _id: PROGRAM,
      category: "spes",
      title: "SPES 2026",
      spes: { resultsStatus: "pending" },
      save: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
    Announcement.findById.mockResolvedValue(p);
    return p;
  };
  const decided = (status, outcome) => ({ applicant: APPLICANT, status, result: { outcome } });

  test("release is blocked while any non-excluded application is undecided", async () => {
    program();
    SpesApplication.find.mockResolvedValue([decided("result_recorded", "accepted"), decided("evaluated", "pending")]);
    const res = await run(spes.adminReleaseResults, { params: { announcementId: PROGRAM } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SPES_UNDECIDED_REMAIN");
    expect(res.body.undecided).toBe(1);
    expect(SpesApplication.updateMany).not.toHaveBeenCalled();
  });

  test("withdrawn and disqualified applicants do not count and are not notified", async () => {
    const p = program();
    SpesApplication.find.mockResolvedValue([
      decided("result_recorded", "accepted"),
      decided("disqualified", "pending"),
      decided("withdrawn", "pending"),
    ]);
    SpesApplication.updateMany.mockResolvedValue({});
    const res = await run(spes.adminReleaseResults, { params: { announcementId: PROGRAM } });
    expect(res.status).toBe(200);
    expect(p.spes.resultsStatus).toBe("published");
    expect(SpesApplication.updateMany.mock.calls[0][0].status.$nin).toEqual(["withdrawn", "disqualified"]);
    expect(SpesApplication.updateMany.mock.calls[0][1].$set.status).toBe("results_released");
    expect(notifications.notifyManyUsers.mock.calls[0][0].recipientIds).toHaveLength(1);
    const event = logAuditEvent.mock.calls.map(([e]) => e).find((e) => e.action === "spes.results.released");
    expect(event.severity).toBe("warning");
    expect(event.metadata.releasedCount).toBe(1);
  });

  test("a program cannot be released twice", async () => {
    program({ spes: { resultsStatus: "published" } });
    const res = await run(spes.adminReleaseResults, { params: { announcementId: PROGRAM } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SPES_ALREADY_RELEASED");
  });

  test("the release summary reports what a release would do and writes nothing", async () => {
    // This endpoint reads the program with .select(), unlike the release itself.
    Announcement.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: PROGRAM, category: "spes", title: "SPES 2026", spes: { resultsStatus: "pending" } }),
    });
    SpesApplication.find.mockReturnValue(
      q([
        { status: "result_recorded", result: { outcome: "accepted" } },
        { status: "result_recorded", result: { outcome: "not_accepted" } },
        { status: "evaluated", result: { outcome: "pending" } },
        { status: "withdrawn", result: { outcome: "pending" } },
      ])
    );
    const res = await run(spes.adminReleaseSummary, { params: { announcementId: PROGRAM } });
    expect(res.body).toMatchObject({ toNotify: 3, excluded: 1, undecided: 1, canRelease: false });
    expect(res.body.byOutcome.accepted).toBe(1);
    expect(SpesApplication.updateMany).not.toHaveBeenCalled();
  });

  test("amending needs the results to be released and a reason; then it notifies and audits", async () => {
    const before = makeApp({ status: "result_recorded", result: { outcome: "accepted" } });
    SpesApplication.findById.mockReturnValue(q(before));
    const early = await run(spes.adminAmendResult, { params: { id: APP_ID }, body: { outcome: "waitlisted", remarks: "x" } });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe("SPES_NOT_RELEASED");

    const released = makeApp({
      status: "results_released",
      resultReleasedAt: new Date(),
      result: { outcome: "accepted", rank: 1 },
    });
    SpesApplication.findById.mockReturnValue(q(released));
    const noReason = await run(spes.adminAmendResult, { params: { id: APP_ID }, body: { outcome: "waitlisted" } });
    expect(noReason.body.code).toBe("SPES_REASON_REQUIRED");

    const ok = await run(spes.adminAmendResult, { params: { id: APP_ID }, body: { outcome: "waitlisted", rank: 4, remarks: "Slots were reduced" } });
    expect(ok.status).toBe(200);
    expect(released.result.outcome).toBe("waitlisted");
    expect(released.result.rank).toBe(4);
    expect(notifiedTitles()).toContain("SPES result updated");
    const event = logAuditEvent.mock.calls.map(([e]) => e).find((e) => e.action === "spes.result.amended");
    expect(event.severity).toBe("warning");
    expect(event.metadata).toMatchObject({ outcome: "waitlisted", previousOutcome: "accepted" });
  });
});

describe("adminListPrograms says why a program is closed", () => {
  test.each([
    ["deadline passed", { spes: { applicationDeadline: new Date(Date.now() - 86400000) } }, false, "deadline"],
    ["closed by staff", { spes: { closedAt: new Date(Date.now() - 1000) } }, false, "manual"],
    ["unpublished", { isActive: false, spes: {} }, false, "inactive"],
    ["not open yet", { spes: { opensAt: new Date(Date.now() + 86400000) } }, false, "notYetOpen"],
    ["open", { spes: { applicationDeadline: new Date(Date.now() + 86400000) } }, true, null],
  ])("%s", async (_label, program, open, reason) => {
    Announcement.find.mockReturnValue(q([{ _id: PROGRAM, title: "SPES", isActive: true, ...program }]));
    SpesApplication.aggregate.mockResolvedValue([]);
    const res = await run(spes.adminListPrograms);
    expect(res.status).toBe(200);
    expect(res.body.items[0].open).toBe(open);
    expect(res.body.items[0].closedReason).toBe(reason);
  });
});

// ---------------------------------------------------------------- admin list
describe("adminListSpesApplications", () => {
  test("filters by status alias, applicant type and age tier, and never returns a date of birth", async () => {
    User.find.mockReturnValue({ distinct: jest.fn().mockResolvedValue(["u1", "u2"]) });
    SpesApplication.countDocuments.mockResolvedValue(1);
    SpesApplication.find.mockReturnValue(q([makeApp()]));
    const res = await run(spes.adminListSpesApplications, { query: { status: "qualified", applicantType: "osy", ageTier: "minor15to17" } });
    expect(res.status).toBe(200);
    const filter = SpesApplication.find.mock.calls[0][0];
    expect(filter.status).toEqual({ $in: ["qualified", "for_exam", "for_interview"] });
    expect(filter.$or).toEqual([{ applicantType: "osy" }, { isOutOfSchoolYouth: true }]);
    expect(filter.applicant).toEqual({ $in: ["u1", "u2"] });
    const range = User.find.mock.calls[0][0].dateOfBirth;
    expect(range.$gt).toBeInstanceOf(Date);
    expect(res.body.items[0].applicant.dateOfBirth).toBeUndefined();
    expect(res.body.items[0].applicantAgeTier).toBe("adult18to30");
  });
});
