// Staff posting management (create, edit, publish, close, archive, delete) and the
// applicant's postings list and detail, including 15-17 and 31+ behavior and the
// per-posting guardian override. Models and services are mocked.

jest.mock("../models/SpesPosting", () => ({ create: jest.fn(), deleteOne: jest.fn() }));
jest.mock("../models/SpesApplication", () => ({
  countDocuments: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  exists: jest.fn(),
  aggregate: jest.fn(),
}));
jest.mock("../models/User", () => ({ findById: jest.fn(), find: jest.fn() }));
jest.mock("../services/spesPostingService", () => ({
  resolvePosting: jest.fn(),
  applicationFilterFor: (p) => ({ posting: p._id }),
  applicationRefsFor: (p) => ({ posting: p._id }),
  listPublishedPostings: jest.fn(),
  listAllPostings: jest.fn(),
  announcePosting: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../services/notificationService", () => ({
  createNotificationForUser: jest.fn().mockResolvedValue(null),
  notifyManyUsers: jest.fn().mockResolvedValue(null),
}));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const express = require("express");
const request = require("supertest");

const SpesPosting = require("../models/SpesPosting");
const SpesApplication = require("../models/SpesApplication");
const User = require("../models/User");
const service = require("../services/spesPostingService");
const { logAuditEvent } = require("../services/auditService");
const postings = require("../controllers/spesPostingController");
const spes = require("../controllers/spesController");

const ADMIN = { id: "aaaaaaaaaaaaaaaaaaaaaaaa", role: "admin" };
const APPLICANT = "bbbbbbbbbbbbbbbbbbbbbbbb";
const PID = "cccccccccccccccccccccccc";
const day = 86400000;

const run = (handler, { user = ADMIN, params = {}, body = {}, query = {}, files } = {}) => {
  const app = express();
  app.use(express.json());
  app.all("/t/:postingId?", (req, _res, next) => {
    req.user = user;
    Object.assign(req.params, params);
    req.files = files;
    req.app.set("io", null);
    next();
  }, handler);
  return request(app).post("/t/x").query(query).send(body);
};

const dobYearsAgo = (years, offsetDays = 0) => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear() - years, n.getUTCMonth(), n.getUTCDate() + offsetDays));
};

const nativePosting = (extra = {}) => {
  const p = {
    _id: PID,
    title: "SPES 2026",
    status: "draft",
    description: "d",
    results: { status: "pending" },
    requiredSlots: [],
    save: jest.fn().mockResolvedValue(undefined),
    ...extra,
  };
  p.toObject = () => ({ ...p });
  return p;
};

const auditActions = () => logAuditEvent.mock.calls.map(([e]) => e.action);

beforeEach(() => {
  jest.clearAllMocks();
  logAuditEvent.mockResolvedValue(undefined);
  service.announcePosting.mockResolvedValue(undefined);
});

describe("normalizePostingInput", () => {
  const { normalizePostingInput } = postings._internals;
  test.each([
    [{ title: "  " }, "SPES_TITLE_REQUIRED"],
    [{ title: "T", applicationDeadline: "not a date" }, "SPES_DATE_INVALID"],
    [{ title: "T", slots: "2.5" }, "SPES_SLOTS_INVALID"],
    [{ title: "T", slots: -1 }, "SPES_SLOTS_INVALID"],
    [{ title: "T", requiredSlots: ["form2", "passport"] }, "SPES_SLOT_TYPES_INVALID"],
    [{ title: "T", opensAt: "2026-12-10", applicationDeadline: "2026-12-01" }, "SPES_PERIOD_INVALID"],
  ])("%j -> %s", (body, code) => {
    expect(normalizePostingInput(body).error.code).toBe(code);
  });

  test("accepts a valid posting and never lets results STATE through", () => {
    const { value } = normalizePostingInput({
      title: "T",
      slots: "10",
      requiredSlots: ["form2", "form2", "proof_of_age"],
      guardianRequired: "inherit",
      results: { status: "released", summary: "s", exposeScores: "true" },
    });
    expect(value.slots).toBe(10);
    expect(value.requiredSlots).toEqual(["form2", "proof_of_age"]);
    expect(value.guardianRequired).toBeNull();
    expect(value["results.summary"]).toBe("s");
    expect(value["results.exposeScores"]).toBe(true);
    expect(value).not.toHaveProperty("results.status");
    expect(value).not.toHaveProperty("results");
  });
});

describe("create and publish", () => {
  test("a draft is created without notices or a news card", async () => {
    SpesPosting.create.mockResolvedValue(nativePosting());
    const res = await run(postings.createPosting, { body: { title: "SPES 2026" } });
    expect(res.status).toBe(201);
    expect(SpesPosting.create.mock.calls[0][0]).toMatchObject({ status: "draft", createdBy: ADMIN.id });
    expect(service.announcePosting).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(["spes.posting.created"]);
  });

  test("publishing sets publishedAt, audits, and announces with the news-card choice (default on)", async () => {
    const p = nativePosting();
    SpesPosting.create.mockResolvedValue(p);
    const res = await run(postings.createPosting, {
      body: { title: "SPES 2026", status: "published", applicationDeadline: new Date(Date.now() + day).toISOString() },
    });
    expect(res.status).toBe(201);
    expect(p.status).toBe("published");
    expect(p.publishedAt).toBeInstanceOf(Date);
    expect(service.announcePosting.mock.calls[0][0]).toMatchObject({ alsoPostToNews: true, authorId: ADMIN.id });
    expect(auditActions()).toEqual(expect.arrayContaining(["spes.posting.created", "spes.posting.published"]));
  });

  test("the checkbox off means no news card", async () => {
    SpesPosting.create.mockResolvedValue(nativePosting());
    await run(postings.createPosting, { body: { title: "T", status: "published", alsoPostToNews: false } });
    expect(service.announcePosting.mock.calls[0][0].alsoPostToNews).toBe(false);
  });

  test("cannot publish with a deadline in the past", async () => {
    const res = await run(postings.createPosting, {
      body: { title: "T", status: "published", applicationDeadline: new Date(Date.now() - day).toISOString() },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SPES_DEADLINE_IN_PAST");
    expect(SpesPosting.create).not.toHaveBeenCalled();
  });
});

describe("edit, status, delete", () => {
  test("a legacy posting cannot be edited, re-statused or deleted here", async () => {
    service.resolvePosting.mockResolvedValue({ _id: PID, legacy: true, status: "published" });
    for (const [handler, body] of [
      [postings.updatePosting, { title: "x" }],
      [postings.setPostingStatus, { status: "archived" }],
      [postings.deletePosting, {}],
    ]) {
      const res = await run(handler, { params: { postingId: PID }, body });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("SPES_POSTING_LEGACY");
    }
  });

  test("an edit changes only editable fields and audits the field names, not values", async () => {
    const p = nativePosting({ results: { status: "pending", summary: "" } });
    service.resolvePosting.mockResolvedValue(p);
    const res = await run(postings.updatePosting, {
      params: { postingId: PID },
      body: { title: "New title", results: { summary: "Done", status: "released" } },
    });
    expect(res.status).toBe(200);
    expect(p.title).toBe("New title");
    expect(p.results.summary).toBe("Done");
    expect(p.results.status).toBe("pending");
    const event = logAuditEvent.mock.calls.map(([e]) => e).find((e) => e.action === "spes.posting.updated");
    expect(event.metadata.fields).toEqual(expect.arrayContaining(["title", "results.summary"]));
  });

  test("going back to draft is refused once there are applications", async () => {
    service.resolvePosting.mockResolvedValue(nativePosting({ status: "published" }));
    SpesApplication.countDocuments.mockResolvedValue(2);
    const res = await run(postings.setPostingStatus, { params: { postingId: PID }, body: { status: "draft" } });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SPES_HAS_APPLICATIONS");
  });

  test("archive works and is audited; an invalid status is refused", async () => {
    const p = nativePosting({ status: "published" });
    service.resolvePosting.mockResolvedValue(p);
    const ok = await run(postings.setPostingStatus, { params: { postingId: PID }, body: { status: "archived" } });
    expect(ok.status).toBe(200);
    expect(p.status).toBe("archived");
    expect(auditActions()).toContain("spes.posting.archived");
    const bad = await run(postings.setPostingStatus, { params: { postingId: PID }, body: { status: "open" } });
    expect(bad.body.code).toBe("SPES_STATUS_INVALID");
  });

  test("only an empty draft can be deleted", async () => {
    service.resolvePosting.mockResolvedValue(nativePosting({ status: "published" }));
    expect((await run(postings.deletePosting, { params: { postingId: PID } })).body.code).toBe("SPES_DELETE_NOT_ALLOWED");

    service.resolvePosting.mockResolvedValue(nativePosting());
    SpesApplication.countDocuments.mockResolvedValue(1);
    expect((await run(postings.deletePosting, { params: { postingId: PID } })).body.code).toBe("SPES_HAS_APPLICATIONS");

    SpesApplication.countDocuments.mockResolvedValue(0);
    SpesPosting.deleteOne.mockResolvedValue({});
    const ok = await run(postings.deletePosting, { params: { postingId: PID } });
    expect(ok.status).toBe(200);
    expect(auditActions()).toContain("spes.posting.deleted");
  });

  test("close and reopen work on a legacy posting and write through its own save", async () => {
    const legacy = { _id: PID, legacy: true, status: "published", closedAt: null, save: jest.fn().mockResolvedValue(undefined) };
    service.resolvePosting.mockResolvedValue(legacy);
    await run(postings.setPostingClosed, { params: { postingId: PID }, body: { closed: true } });
    expect(legacy.closedAt).toBeInstanceOf(Date);
    await run(postings.setPostingClosed, { params: { postingId: PID }, body: { closed: false } });
    expect(legacy.closedAt).toBeNull();
    expect(legacy.save).toHaveBeenCalledTimes(2);
    expect(auditActions()).toEqual(["spes.posting.closed", "spes.posting.reopened"]);
  });
});

describe("applicant postings list and detail (15-17 apply, 31+ read-only)", () => {
  const published = (extra = {}) => nativePosting({ status: "published", ...extra });
  const arrange = ({ dob, posting = published(), application = null, nsrp = true }) => {
    service.listPublishedPostings.mockResolvedValue([posting]);
    service.resolvePosting.mockResolvedValue(posting);
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: APPLICANT, role: "jobseeker", dateOfBirth: dob, hasCompletedOnboarding: nsrp }),
    });
    SpesApplication.find.mockReturnValue({ select: jest.fn().mockResolvedValue(application ? [application] : []) });
    SpesApplication.findOne.mockReturnValue({
      populate: () => ({ populate: () => Promise.resolve(application) }),
    });
  };
  const list = () => run(spes.listPostings, { user: { id: APPLICANT, role: "jobseeker" } });
  const detail = () => run(spes.getPostingDetail, { user: { id: APPLICANT, role: "jobseeker" }, params: { postingId: PID } });

  test("a 16-year-old can apply from the list", async () => {
    arrange({ dob: dobYearsAgo(16, -30) });
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ canApply: true, readOnly: false });
    expect(res.body.ageTier).toBe("minor15to17");
  });

  test("a 19-year-old can apply; their own application is shown", async () => {
    arrange({ dob: dobYearsAgo(19), application: { _id: "app1", status: "under_review", posting: PID } });
    const res = await list();
    expect(res.body.items[0].canApply).toBe(false);
    expect(res.body.items[0].blockers).toContain("SPES_ALREADY_APPLIED");
    expect(res.body.items[0].myApplication).toEqual({ _id: "app1", status: "documents_review" });
  });

  test("a 31-year-old sees the posting read-only and cannot apply", async () => {
    arrange({ dob: dobYearsAgo(31) });
    const res = await list();
    expect(res.body.items[0]).toMatchObject({ canApply: false, readOnly: true });
    expect(res.body.items[0].blockers).toContain("SPES_AGE_ABOVE_MAX");
    expect((await detail()).body.eligibility).toMatchObject({ readOnly: true, canApply: false });
  });

  test("incomplete NSRP and a closed posting are reported as blockers", async () => {
    arrange({ dob: dobYearsAgo(20), nsrp: false, posting: published({ closedAt: new Date(Date.now() - 1000) }) });
    const res = await list();
    expect(res.body.items[0].blockers).toEqual(expect.arrayContaining(["NSRP_INCOMPLETE", "SPES_NOT_OPEN"]));
    expect(res.body.items[0].posting.displayStatus).toBe("closed");
  });

  test("a draft posting is not visible to someone who has not applied", async () => {
    arrange({ dob: dobYearsAgo(20), posting: nativePosting({ status: "draft" }) });
    const res = await detail();
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SPES_PROGRAM_NOT_FOUND");
  });

  test("the guardian requirement follows the posting's override", async () => {
    arrange({ dob: dobYearsAgo(16, -30), posting: published({ guardianRequired: false }) });
    expect((await detail()).body.eligibility.guardianRequired).toBe(false);
    arrange({ dob: dobYearsAgo(16, -30), posting: published({ guardianRequired: null }) });
    expect((await detail()).body.eligibility.guardianRequired).toBe(true);
    arrange({ dob: dobYearsAgo(20), posting: published({ guardianRequired: true }) });
    expect((await detail()).body.eligibility.guardianRequired).toBe(false); // only applicants under 18
  });
});

describe("applying to two postings (one application per posting)", () => {
  const POSTING_A = "dddddddddddddddddddddddd";
  const POSTING_B = "eeeeeeeeeeeeeeeeeeeeeeee";
  const file = (slot) => ({ [slot]: [{ storedValue: `cloud:${slot}`, originalname: `${slot}.pdf`, mimetype: "application/pdf", size: 5 }] });
  const files = {
    ...file("form2"),
    ...file("proof_of_age"),
    ...file("proof_of_financial_status"),
    ...file("proof_of_academic_standing"),
  };
  const body = { applicantType: "student", school: "MNHS", gradeLevel: "Grade 12", gwa: "90", gwaScale: "percent", contactNumber: "09171234567" };

  test("the same person can apply to posting A and posting B; a repeat on A is refused", async () => {
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: APPLICANT, role: "jobseeker", name: "Juan", dateOfBirth: dobYearsAgo(20), hasCompletedOnboarding: true }),
    });
    User.find.mockReturnValue({ select: jest.fn().mockResolvedValue([]) });
    SpesApplication.create.mockImplementation(async (data) => ({ _id: `app-${data.posting}`, ...data, toObject() { return { ...this }; } }));

    const apply = (postingId) => {
      service.resolvePosting.mockResolvedValue(nativePosting({ _id: postingId, status: "published" }));
      return run(spes.applyToSpes, { user: { id: APPLICANT, role: "jobseeker" }, params: { postingId }, body, files });
    };

    SpesApplication.findOne.mockResolvedValue(null);
    expect((await apply(POSTING_A)).status).toBe(201);
    expect((await apply(POSTING_B)).status).toBe(201);
    expect(SpesApplication.create.mock.calls.map(([d]) => String(d.posting))).toEqual([POSTING_A, POSTING_B]);

    SpesApplication.findOne.mockResolvedValue({ _id: "existing", toObject() { return { _id: "existing" }; } });
    const again = await apply(POSTING_A);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("SPES_ALREADY_APPLIED");
    expect(SpesApplication.create).toHaveBeenCalledTimes(2);
  });

  test("the duplicate-key error from the partial index is reported as already applied", async () => {
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: APPLICANT, role: "jobseeker", name: "Juan", dateOfBirth: dobYearsAgo(20), hasCompletedOnboarding: true }),
    });
    service.resolvePosting.mockResolvedValue(nativePosting({ status: "published" }));
    SpesApplication.findOne.mockResolvedValue(null);
    SpesApplication.create.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
    const res = await run(spes.applyToSpes, { user: { id: APPLICANT, role: "jobseeker" }, params: { postingId: PID }, body, files });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SPES_ALREADY_APPLIED");
  });
});
