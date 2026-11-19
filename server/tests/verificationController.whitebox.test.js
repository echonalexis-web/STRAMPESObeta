// White-box branch coverage for server/controllers/verificationController.js.
// Tests tagged KNOWN-ISSUE pin CURRENT behaviour that looks like a defect (see
// docs/WHITE_BOX_TEST_REPORT.md).

jest.mock("../models/User", () => ({ find: jest.fn(), findById: jest.fn(), findByIdAndUpdate: jest.fn(), countDocuments: jest.fn() }));
jest.mock("../services/notificationService", () => ({ createNotificationForUser: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn() }));
jest.mock("../controllers/messageController", () => ({ postSystemMessage: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const User = require("../models/User");
const { createNotificationForUser } = require("../services/notificationService");
const { logAuditEvent } = require("../services/auditService");
const { postSystemMessage } = require("../controllers/messageController");
const ctl = require("../controllers/verificationController");
const { makeReq, query, failingQuery, call } = require("../testUtils/httpMocks");

const EMP = "emp1";
const ADMIN = { id: "adm1", _id: "adm1", role: "admin" };
const dbError = () => new Error("secret db internals");
const employerReq = (o = {}) => makeReq({ user: { id: EMP, _id: EMP, role: "employer" }, ...o });
const adminReq = (o = {}) => makeReq({ user: ADMIN, ...o });
const expect500 = (r, message) => {
  expect(r.status).toBe(500);
  expect(r.body).toEqual({ message });
};

let warnSpy;
beforeEach(() => {
  jest.resetAllMocks();
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  createNotificationForUser.mockResolvedValue();
  logAuditEvent.mockResolvedValue();
  postSystemMessage.mockResolvedValue();
  User.find.mockReturnValue(query([]));
});
afterEach(() => warnSpy.mockRestore());

const employer = (o = {}) => ({
  _id: EMP, role: "employer", name: "Owner", companyName: "Acme", businessPermitUrl: "bp.pdf", registrationDocUrl: "reg.pdf",
  verificationStatus: "unverified", save: jest.fn().mockResolvedValue(), ...o,
});

// ---------------------------------------------------------------------------
describe("submitEmployerVerification (legacy self route)", () => {
  const run = (over = {}) => call(ctl.submitEmployerVerification, employerReq(over));
  const wire = (u) => User.findById.mockReturnValue(query(u));

  test("WB-VER-01 unknown user 404; non-employer 403", async () => {
    wire(null);
    expect((await run()).status).toBe(404);
    wire(employer({ role: "jobseeker" }));
    expect((await run()).status).toBe(403);
  });

  test.each([[{ businessPermitUrl: "" }], [{ registrationDocUrl: undefined }], [{ businessPermitUrl: null, registrationDocUrl: null }]])("WB-VER-02 missing document %j is 400", async (o) => {
    wire(employer(o));
    const r = await run();
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Upload both/);
  });

  test("WB-VER-03 already verified or already under review cannot be submitted again", async () => {
    wire(employer({ verificationStatus: "verified" }));
    expect((await run()).body.message).toBe("Your account is already verified.");
    for (const status of ["pending", "under_review"]) {
      wire(employer({ verificationStatus: status }));
      expect((await run()).body.message).toBe("Your documents are already under review.");
    }
  });

  test.each([["unverified"], ["rejected"], ["resubmission_required"], [undefined]])("WB-VER-04 an account with status %p may submit: moved to pending, note cleared, admins and the employer notified, audited", async (status) => {
    const u = employer({ verificationStatus: status, verificationNote: "old" });
    wire(u);
    User.find.mockReturnValue(query([{ _id: "a1" }, { _id: "a2" }]));
    const r = await run();
    expect(u).toMatchObject({ verificationStatus: "pending", verificationNote: null });
    expect(u.verificationSubmittedAt).toBeInstanceOf(Date);
    expect(u.save).toHaveBeenCalledWith({ validateModifiedOnly: true });
    expect(User.find).toHaveBeenCalledWith({ role: "admin" });
    const recipients = createNotificationForUser.mock.calls.map((c) => c[0].recipientId);
    expect(recipients).toEqual(["a1", "a2", EMP]);
    expect(createNotificationForUser.mock.calls[0][0]).toMatchObject({ preferenceKey: "notifyVerificationRequest", message: "Acme submitted documents for verification review." });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "employer.verification.submitted" }));
    expect(r.body.verificationStatus).toBe("pending");
  });

  test.each([[{ companyName: "", name: "Owner" }, "Owner"], [{ companyName: "", name: "" }, "An employer"]])("WB-VER-05 company label falls back (%j)", async (o, label) => {
    wire(employer(o));
    User.find.mockReturnValue(query([{ _id: "a1" }]));
    await run();
    expect(createNotificationForUser.mock.calls[0][0].message).toBe(`${label} submitted documents for verification review.`);
  });

  test("WB-VER-06 KNOWN-ISSUE: the legacy route sends notifications OUTSIDE the best-effort wrapper, so a failing notification returns 500 although the account is already saved as 'pending' (a retry is then refused as 'already under review')", async () => {
    const u = employer();
    wire(u);
    User.find.mockReturnValue(query([{ _id: "a1" }]));
    createNotificationForUser.mockRejectedValue(new Error("x"));
    expect500(await run(), "Failed to submit verification");
    expect(u.verificationStatus).toBe("pending");
  });

  test("WB-VER-07 user id may come from req.user._id; DB failure is a generic 500", async () => {
    wire(employer());
    await call(ctl.submitEmployerVerification, makeReq({ user: { _id: EMP, role: "employer" } }));
    expect(User.findById).toHaveBeenCalledWith(EMP);
    User.findById.mockReturnValue(failingQuery(dbError()));
    expect500(await run(), "Failed to submit verification");
  });
});

// ---------------------------------------------------------------------------
describe("uploadEmployerAvatar", () => {
  const run = (over = {}) => call(ctl.uploadEmployerAvatar, employerReq({ params: { id: EMP }, file: { storedValue: "av.png" }, ...over }));

  test("WB-VER-08 only the owner (id match) and only an employer may use it", async () => {
    expect((await run({ params: { id: "someone-else" } })).status).toBe(403);
    expect((await run({ user: { id: EMP, role: "jobseeker" } })).status).toBe(403);
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("WB-VER-09 no stored file is 400", async () => {
    expect((await run({ file: undefined })).status).toBe(400);
    expect((await run({ file: {} })).status).toBe(400);
  });

  test("WB-VER-10 success stores the new image URL and audits; id may be compared via req.user._id", async () => {
    User.findByIdAndUpdate.mockResolvedValue();
    const r = await run();
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(EMP, { profileImage: "av.png" });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "user.profile_image.uploaded" }));
    expect(r.body).toEqual({ success: true, avatarUrl: "av.png" });
    expect((await run({ user: { _id: EMP, role: "employer" } })).status).toBe(200);
  });

  test("WB-VER-11 DB failure is a generic 500", async () => {
    User.findByIdAndUpdate.mockRejectedValue(dbError());
    expect500(await run(), "Failed to upload profile picture");
  });
});

// ---------------------------------------------------------------------------
describe("submitEmployerVerificationWithDocuments", () => {
  const run = (over = {}) => call(ctl.submitEmployerVerificationWithDocuments, employerReq({ params: { id: EMP }, ...over }));
  const wire = (u) => User.findById.mockReturnValue(query(u));
  const f = (v) => [{ storedValue: v }];

  test("WB-VER-12 id mismatch 403; unknown 404; non-employer 403; verified 400; pending/under review 400", async () => {
    expect((await run({ params: { id: "other" } })).status).toBe(403);
    wire(null);
    expect((await run()).status).toBe(404);
    wire(employer({ role: "admin" }));
    expect((await run()).status).toBe(403);
    wire(employer({ verificationStatus: "verified" }));
    expect((await run()).body.message).toBe("Your account is already verified.");
    wire(employer({ verificationStatus: "pending" }));
    expect((await run()).status).toBe(400);
    wire(employer({ verificationStatus: "under_review" }));
    expect((await run()).status).toBe(400);
  });

  test("WB-VER-13 both documents are required: new uploads or documents already on file satisfy it", async () => {
    wire(employer({ businessPermitUrl: "", registrationDocUrl: "" }));
    expect((await run({ files: {} })).body.message).toMatch(/Both a business permit/);
    wire(employer({ businessPermitUrl: "", registrationDocUrl: "" }));
    expect((await run({ files: { businessPermit: f("new-bp") } })).status).toBe(400);
    wire(employer({ businessPermitUrl: "old-bp", registrationDocUrl: "" }));
    expect((await run({ files: { registrationDoc: f("new-reg") } })).status).toBe(200);
  });

  test("WB-VER-14 `req.files` as an array (or missing) is treated as no new files", async () => {
    const u = employer();
    wire(u);
    expect((await run({ files: [{ storedValue: "x" }] })).status).toBe(200);
    expect(u.businessPermitUrl).toBe("bp.pdf");
    wire(employer());
    expect((await run({ files: undefined })).status).toBe(200);
  });

  test("WB-VER-15 success: new files replace the stored ones, status pending, note cleared, uploads marked committed, admins notified, audited", async () => {
    const u = employer({ verificationStatus: "rejected", verificationNote: "bad" });
    wire(u);
    User.find.mockReturnValue(query([{ _id: "a1" }]));
    const req = employerReq({ params: { id: EMP }, files: { businessPermit: f("new-bp"), registrationDoc: f("new-reg") } });
    const r = await call(ctl.submitEmployerVerificationWithDocuments, req);
    expect(u).toMatchObject({ businessPermitUrl: "new-bp", registrationDocUrl: "new-reg", verificationStatus: "pending", verificationNote: null });
    expect(req.uploadsCommitted).toBe(true);
    expect(createNotificationForUser).toHaveBeenCalledTimes(2);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "employer.verification.submitted" }));
    expect(r.body).toEqual({ success: true, verificationStatus: "pending", businessPermitUrl: "new-bp", registrationDocUrl: "new-reg" });
  });

  test("WB-VER-16 only the provided file is replaced; the other keeps its stored value", async () => {
    const u = employer();
    wire(u);
    await run({ files: { businessPermit: f("new-bp") } });
    expect(u).toMatchObject({ businessPermitUrl: "new-bp", registrationDocUrl: "reg.pdf" });
  });

  test("WB-VER-17 notification and audit failures are best-effort here (still 200, unlike the legacy route)", async () => {
    wire(employer());
    User.find.mockReturnValue(query([{ _id: "a1" }]));
    createNotificationForUser.mockRejectedValue(new Error("x"));
    logAuditEvent.mockRejectedValue(new Error("y"));
    expect((await run()).status).toBe(200);
  });

  test("WB-VER-18 DB failure is a generic 500", async () => {
    User.findById.mockReturnValue(failingQuery(dbError()));
    expect500(await run(), "Failed to submit verification");
  });
});

// ---------------------------------------------------------------------------
describe("getVerificationQueue", () => {
  const run = (q = {}) => call(ctl.getVerificationQueue, adminReq({ query: q }));
  const wire = (rows = [], total = rows.length) => {
    User.countDocuments.mockResolvedValue(total);
    const qy = query(rows);
    User.find.mockReturnValue(qy);
    return qy;
  };
  const filter = () => User.find.mock.calls[User.find.mock.calls.length - 1][0];

  test("WB-VER-19 defaults to the pending queue of employers", async () => {
    wire();
    const { body } = await run();
    expect(filter()).toEqual({ role: "employer", verificationStatus: "pending" });
    expect(body).toMatchObject({ status: "pending", currentPage: 1, totalPages: 1 });
  });

  test.each(["pending", "under_review", "verified", "resubmission_required", "rejected", "unverified"])("WB-VER-20 status %s is accepted", async (status) => {
    wire();
    expect((await run({ status })).body.status).toBe(status);
    expect(filter().verificationStatus).toBe(status);
  });

  test("WB-VER-21 'all' removes the status filter; unknown statuses fall back to pending", async () => {
    wire();
    expect((await run({ status: "all" })).body.status).toBe("all");
    expect(filter()).toEqual({ role: "employer" });
    expect((await run({ status: "bogus" })).body.status).toBe("pending");
    expect((await run({ status: "$ne" })).body.status).toBe("pending");
  });

  test("WB-VER-22 search builds an escaped regex over name, email and company", async () => {
    wire();
    await run({ search: "a.b(" });
    expect(filter().$or).toHaveLength(3);
    expect(filter().$or[0].name.$regex).toBe("a\\.b\\(");
  });

  test.each([["pending", { createdAt: -1 }], ["under_review", { createdAt: -1 }], ["all", { createdAt: -1 }], ["verified", { verificationReviewedAt: -1, createdAt: -1 }], ["rejected", { verificationReviewedAt: -1, createdAt: -1 }]])(
    "WB-VER-23 status %s sorts by %j", async (status, sort) => {
      const qy = wire();
      await run({ status });
      expect(qy.sort).toHaveBeenCalledWith(sort);
    }
  );

  test("WB-VER-24 pagination maths; page/limit are floored at 1", async () => {
    let qy = wire([], 45);
    const { body } = await run({ page: "3", limit: "10" });
    expect(qy.skip).toHaveBeenCalledWith(20);
    expect(body).toMatchObject({ totalPages: 5, currentPage: 3 });
    qy = wire();
    await run({ page: "-1", limit: "0" });
    expect(qy.skip).toHaveBeenCalledWith(0);
    expect(qy.limit).toHaveBeenCalledWith(20);
  });

  test("WB-VER-25 KNOWN-ISSUE: `limit` has no upper bound", async () => {
    const qy = wire();
    await run({ limit: "999999" });
    expect(qy.limit).toHaveBeenCalledWith(999999);
  });

  test("WB-VER-26 DB failure is a generic 500", async () => {
    User.countDocuments.mockRejectedValue(dbError());
    User.find.mockReturnValue(query([]));
    expect500(await run(), "Failed to load verification queue");
  });
});

// ---------------------------------------------------------------------------
describe("decisions (applyVerificationDecision through its callers)", () => {
  const wireUpdate = (u) => User.findByIdAndUpdate.mockReturnValue(query(u));
  const updated = (o = {}) => ({ _id: EMP, role: "employer", ...o });
  const review = (body) => call(ctl.reviewEmployerVerification, adminReq({ params: { id: EMP }, body }));
  const $set = () => User.findByIdAndUpdate.mock.calls[0][1].$set;

  describe("reviewEmployerVerification (legacy PATCH)", () => {
    test("WB-VER-27 decision verbs map to statuses and override a raw status", async () => {
      wireUpdate(updated());
      await review({ decision: "approved", verificationStatus: "rejected" });
      expect($set().verificationStatus).toBe("verified");
      User.findByIdAndUpdate.mockClear();
      wireUpdate(updated());
      await review({ decision: "rejected", note: "bad docs" });
      expect($set().verificationStatus).toBe("rejected");
    });

    test.each(["unverified", "pending", "under_review", "verified", "resubmission_required", "rejected"])("WB-VER-28 explicit status %s is accepted", async (status) => {
      wireUpdate(updated());
      const r = await review({ verificationStatus: status, note: "reason" });
      expect(r.status).toBe(200);
      expect($set().verificationStatus).toBe(status);
      expect(r.body.message).toBe("Employer verification updated");
    });

    test.each([[undefined], ["approved"], ["constructor"], [""], ["VERIFIED"]])("WB-VER-29 invalid status %p is 400 and nothing is written", async (verificationStatus) => {
      const r = await review({ verificationStatus });
      expect(r.status).toBe(400);
      expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    test("WB-VER-30 an employer can be set to 'verified' straight from 'unverified' (no documents/pending check in the controller; that is left to route guards)", async () => {
      wireUpdate(updated({ verificationStatus: "verified" }));
      expect((await review({ verificationStatus: "verified" })).status).toBe(200);
    });

    test("WB-VER-31 DB failure is a generic 500", async () => {
      User.findByIdAndUpdate.mockReturnValue(failingQuery(dbError()));
      expect500(await review({ verificationStatus: "verified" }), "Failed to update verification");
    });
  });

  describe("the shared decision core", () => {
    test.each([["rejected", "A reason is required when rejecting a submission."], ["resubmission_required", "A reason is required when requesting resubmission."]])(
      "WB-VER-32 %s needs a non-blank string reason", async (status, message) => {
        for (const note of [undefined, "", "   ", 123, null, {}]) {
          const r = await review({ verificationStatus: status, note });
          expect(r.status).toBe(400);
          expect(r.body.message).toBe(message);
        }
        expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
      }
    );

    test("WB-VER-33 the reason is trimmed and cut to 500 characters", async () => {
      wireUpdate(updated());
      await review({ verificationStatus: "rejected", note: `  ${"x".repeat(900)}  ` });
      expect($set().verificationNote).toHaveLength(500);
    });

    test("WB-VER-34 the update sets reviewer and time; verified clears the note; under_review/pending/unverified leave the note alone", async () => {
      wireUpdate(updated());
      await review({ verificationStatus: "verified", note: "ignored" });
      expect($set()).toMatchObject({ verificationStatus: "verified", verificationNote: null, verificationReviewedBy: "adm1", verificationReviewedAt: expect.any(Date) });
      expect(User.findByIdAndUpdate.mock.calls[0][2]).toEqual({ new: true, runValidators: true });
      User.findByIdAndUpdate.mockClear();
      wireUpdate(updated());
      await review({ verificationStatus: "under_review" });
      expect($set()).not.toHaveProperty("verificationNote");
    });

    test("WB-VER-35 unknown user is 404", async () => {
      wireUpdate(null);
      expect((await review({ verificationStatus: "verified" })).status).toBe(404);
    });

    test("WB-VER-36 KNOWN-ISSUE (write before validate): the status is written with findByIdAndUpdate BEFORE the role check, so verifying a NON-employer id returns 400 'Only employers can be verified' but has already changed that account's verificationStatus", async () => {
      wireUpdate(updated({ role: "jobseeker" }));
      const r = await review({ verificationStatus: "verified" });
      expect(r.status).toBe(400);
      expect(r.body.message).toBe("Only employers can be verified");
      expect(User.findByIdAndUpdate).toHaveBeenCalledTimes(1);
      expect($set().verificationStatus).toBe("verified");
    });

    test.each([["verified", "info"], ["under_review", "info"], ["rejected", "warning"], ["resubmission_required", "warning"], ["pending", "warning"], ["unverified", "warning"]])(
      "WB-VER-37 audit severity for %s is %s", async (status, severity) => {
        wireUpdate(updated());
        await review({ verificationStatus: status, note: "why" });
        expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.user.verification_updated", severity }));
      }
    );

    test("WB-VER-38 the audit note is the trimmed reason, or undefined when there is none", async () => {
      wireUpdate(updated());
      await review({ verificationStatus: "rejected", note: " why " });
      expect(logAuditEvent.mock.calls[0][0].metadata).toEqual({ verificationStatus: "rejected", note: "why" });
      wireUpdate(updated());
      await review({ verificationStatus: "verified" });
      expect(logAuditEvent.mock.calls[1][0].metadata.note).toBeUndefined();
    });

    test.each([
      ["verified", /has been verified/], ["rejected", /Reason: why — update your documents/], ["resubmission_required", /Some changes are needed.*Reason: why/],
      ["under_review", /started reviewing/], ["pending", /under review/], ["unverified", /status was reset/],
    ])("WB-VER-39 employer notification text for %s", async (status, pattern) => {
      wireUpdate(updated());
      await review({ verificationStatus: status, note: "why" });
      const n = createNotificationForUser.mock.calls[0][0];
      expect(n).toMatchObject({ recipientId: EMP, actorId: "adm1", title: "Employer verification updated", metadata: { verificationStatus: status } });
      expect(n.message).toMatch(pattern);
    });

    test.each([["verified", true], ["rejected", true], ["resubmission_required", true], ["under_review", false], ["pending", false], ["unverified", false]])(
      "WB-VER-40 a decision message is posted to the employer's thread for %s = %p", async (status, posted) => {
        wireUpdate(updated());
        await review({ verificationStatus: status, note: "why" });
        expect(postSystemMessage).toHaveBeenCalledTimes(posted ? 1 : 0);
        if (posted) expect(postSystemMessage).toHaveBeenCalledWith(expect.objectContaining({ fromUserId: "adm1", toUserId: EMP, io: "io" }));
      }
    );

    test("WB-VER-41 audit, notification and thread-message failures are all non-fatal; the decision still returns 200", async () => {
      wireUpdate(updated());
      logAuditEvent.mockRejectedValue(new Error("a"));
      createNotificationForUser.mockRejectedValue(new Error("b"));
      postSystemMessage.mockRejectedValue(new Error("c"));
      expect((await review({ verificationStatus: "verified" })).status).toBe(200);
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe("id-scoped wrappers", () => {
    test("WB-VER-42 approve: verified with no reason; errors from the core map to their status; failure is a generic 500", async () => {
      wireUpdate(updated());
      const r = await call(ctl.approveEmployerVerification, adminReq({ params: { id: EMP } }));
      expect(r.body).toEqual({ success: true, verificationStatus: "verified" });
      wireUpdate(null);
      expect((await call(ctl.approveEmployerVerification, adminReq({ params: { id: EMP } }))).status).toBe(404);
      User.findByIdAndUpdate.mockReturnValue(failingQuery(dbError()));
      expect500(await call(ctl.approveEmployerVerification, adminReq({ params: { id: EMP } })), "Failed to approve verification");
    });

    test.each([[undefined], [""], ["   "]])("WB-VER-43 reject without a reason (%p) is 400 before any write", async (reason) => {
      const r = await call(ctl.rejectEmployerVerification, adminReq({ params: { id: EMP }, body: { reason } }));
      expect(r.status).toBe(400);
      expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    test("WB-VER-44 reject returns the saved (trimmed) note; core errors map; failure is a generic 500", async () => {
      wireUpdate(updated());
      const r = await call(ctl.rejectEmployerVerification, adminReq({ params: { id: EMP }, body: { reason: " fake permit " } }));
      expect(r.body).toEqual({ success: true, verificationStatus: "rejected", verificationNote: "fake permit" });
      wireUpdate(null);
      expect((await call(ctl.rejectEmployerVerification, adminReq({ params: { id: EMP }, body: { reason: "x" } }))).status).toBe(404);
      User.findByIdAndUpdate.mockReturnValue(failingQuery(dbError()));
      expect500(await call(ctl.rejectEmployerVerification, adminReq({ params: { id: EMP }, body: { reason: "x" } })), "Failed to reject verification");
    });

    test("WB-VER-45 under-review ping needs no reason; errors map; failure generic", async () => {
      wireUpdate(updated());
      const r = await call(ctl.markEmployerVerificationUnderReview, adminReq({ params: { id: EMP } }));
      expect(r.body).toEqual({ success: true, verificationStatus: "under_review" });
      wireUpdate(null);
      expect((await call(ctl.markEmployerVerificationUnderReview, adminReq({ params: { id: EMP } }))).status).toBe(404);
      User.findByIdAndUpdate.mockReturnValue(failingQuery(dbError()));
      expect500(await call(ctl.markEmployerVerificationUnderReview, adminReq({ params: { id: EMP } })), "Failed to mark verification under review");
    });

    test.each([[undefined], [""], ["  "]])("WB-VER-46 resubmission without a reason (%p) is 400", async (reason) => {
      const r = await call(ctl.requestEmployerResubmission, adminReq({ params: { id: EMP }, body: { reason } }));
      expect(r.status).toBe(400);
      expect(r.body.message).toBe("A reason is required when requesting resubmission.");
    });

    test("WB-VER-47 resubmission request returns the saved note; core errors map; failure generic", async () => {
      wireUpdate(updated());
      const r = await call(ctl.requestEmployerResubmission, adminReq({ params: { id: EMP }, body: { reason: " blurry scan " } }));
      expect(r.body).toEqual({ success: true, verificationStatus: "resubmission_required", verificationNote: "blurry scan" });
      wireUpdate(null);
      expect((await call(ctl.requestEmployerResubmission, adminReq({ params: { id: EMP }, body: { reason: "x" } }))).status).toBe(404);
      User.findByIdAndUpdate.mockReturnValue(failingQuery(dbError()));
      expect500(await call(ctl.requestEmployerResubmission, adminReq({ params: { id: EMP }, body: { reason: "x" } })), "Failed to request resubmission");
    });
  });
});
