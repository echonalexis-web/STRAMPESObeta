const SpesApplication = require("../models/SpesApplication");
const User = require("../models/User");
const { createNotificationForUser, notifyManyUsers } = require("../services/notificationService");
const { logAuditEvent } = require("../services/auditService");
const { runPostCommit } = require("../utils/postCommit");
const { sendError } = require("../utils/sendError");
const { getAgeTier, getAgeFromDate, dobRangeForTier, TIERS, SPES_MIN_AGE, SPES_MAX_AGE } = require("../utils/age");
const { getAgeDenial, sendAgeDenial } = require("../utils/ageAccess");
const { escapeRegex } = require("../utils/sanitize");
const { APPLICANT_TYPES, requiredSlotsFor, ALL_SLOTS } = require("../utils/spesDocuments");
const {
  STATUS,
  EXCLUDED_STATUSES,
  CAN_RECORD_EVALUATION,
  normalizeStatus,
  canAdminTransition,
  canWithdraw,
} = require("../utils/spesLifecycle");
const { presentPosting, fromAnnouncement, applyBlockerCode, getApplyState, APPLY_STATE } = require("../utils/spesPosting");
const {
  resolvePosting,
  applicationFilterFor,
  applicationRefsFor,
  listPublishedPostings,
} = require("../services/spesPostingService");
const { isGuardianRequired } = require("../config/spes");

const getUserId = (req) => req.user.id || req.user._id;

const RELEASABLE_OUTCOMES = ["accepted", "waitlisted", "not_accepted"];
const GWA_SCALES = {
  percent: { min: 0, max: 100 },
  one_to_five: { min: 1, max: 5 },
};
const SCORE_MIN = 0;
const SCORE_MAX = 100;

// Stable error body. The client translates `code`; `message` is an English fallback.
const fail = (res, status, code, message, extra = {}) => res.status(status).json({ code, message, ...extra });

const parseScore = (value) => {
  if (value === undefined || value === null || value === "") return { skip: true };
  const n = Number(value);
  if (!Number.isFinite(n) || n < SCORE_MIN || n > SCORE_MAX) return { error: true };
  return { value: n };
};

// The posting an application belongs to, as the client sees it. A native posting is
// populated on `posting`; an application from before postings existed has only a
// populated `announcement`, which is wrapped so it looks the same.
const programOf = (obj) => {
  if (obj.posting && typeof obj.posting === "object" && obj.posting.title !== undefined) {
    return presentPosting(obj.posting);
  }
  if (obj.announcement && typeof obj.announcement === "object" && obj.announcement.title !== undefined) {
    return presentPosting(fromAnnouncement(obj.announcement));
  }
  return null;
};

// What an applicant may see of their own application. Admin-only working data
// (scores, result, internal note) is stripped until results are released.
// Disqualification and resubmission reasons are visible straight away.
const gateResult = (appDoc) => {
  const obj = appDoc.toObject ? appDoc.toObject() : { ...appDoc };
  const program = programOf(obj);
  delete obj.announcement;
  if (program) obj.posting = program;
  else delete obj.posting;
  const published = Boolean(obj.resultReleasedAt) || program?.results?.status === "released";

  delete obj.adminNote;
  obj.status = normalizeStatus(obj.status);
  if (obj.status !== STATUS.DISQUALIFIED) {
    if (obj.disqualification) obj.disqualification = { reason: "", at: null };
  } else if (obj.disqualification) {
    delete obj.disqualification.by;
  }
  if (obj.needsResubmission && obj.status !== STATUS.NEEDS_RESUBMISSION) {
    obj.needsResubmission = { reason: "", requestedAt: null };
  }
  (obj.documents || []).forEach((d) => {
    if (d.verification) delete d.verification.by;
  });

  if (!published) {
    delete obj.result;
    delete obj.evaluation;
    // Internal stage words never leak ahead of release.
    if (obj.status === STATUS.RESULT_RECORDED) obj.status = STATUS.EVALUATED;
    return obj;
  }
  if (program && program.results.exposeScores === false && obj.evaluation) {
    delete obj.evaluation.examScore;
    delete obj.evaluation.interviewScore;
  }
  return obj;
};

// Admin view: the application plus the applicant's age tier. The date of birth
// itself is never returned.
const adminView = (appDoc) => {
  const obj = appDoc.toObject ? appDoc.toObject() : { ...appDoc };
  obj.status = normalizeStatus(obj.status);
  const program = programOf(obj);
  delete obj.announcement;
  if (program) obj.posting = program;
  else delete obj.posting;
  const applicant = obj.applicant && typeof obj.applicant === "object" ? obj.applicant : null;
  if (applicant) {
    obj.applicantAgeTier = getAgeTier(applicant.dateOfBirth);
    delete applicant.dateOfBirth;
  }
  // "No profile name" and "account no longer exists" read differently to staff.
  obj.applicantDeleted = !applicant;
  obj.applicantMissingProfile = Boolean(applicant) && !String(applicant.name || "").trim();
  return obj;
};

const populateProgram = (query) => query.populate("posting").populate("announcement", "title content imageUrl isActive publishedAt spes");

const populateAdmin = (query) =>
  populateProgram(query.populate("applicant", "name email phone dateOfBirth"));

const loadAdminApplication = async (id) => {
  const app = await populateAdmin(SpesApplication.findById(id));
  return app;
};

const audit = (req, action, app, severity, metadata) =>
  logAuditEvent({
    req,
    actorId: getUserId(req),
    actorRole: req.user.role === "superadmin" ? "superadmin" : "admin",
    action,
    targetType: "spes_application",
    targetId: String(app._id),
    severity,
    metadata,
  });

// ---------------------------------------------------------------------------
// Applicant endpoints
// ---------------------------------------------------------------------------

// What stops this user from applying to this posting. Used by the postings list,
// the posting detail and the eligibility endpoint so they always agree. Codes are
// translated on the client. `ageDenial` is null for ages 15-30.
const eligibilityFor = async (posting, userDoc, existing) => {
  const blockers = [];
  const applyCode = applyBlockerCode(posting);
  if (applyCode) blockers.push(applyCode);
  const ageDenial = userDoc ? getAgeDenial(userDoc, "spesApply") : "DOB_REQUIRED";
  if (ageDenial) blockers.push(ageDenial);
  const nsrpComplete = userDoc?.hasCompletedOnboarding === true || userDoc?.onboardingComplete === true;
  if (!nsrpComplete) blockers.push("NSRP_INCOMPLETE");
  if (existing) blockers.push("SPES_ALREADY_APPLIED");
  const tier = userDoc ? getAgeTier(userDoc.dateOfBirth) : TIERS.UNKNOWN;
  return {
    canApply: blockers.length === 0,
    blockers,
    ageTier: tier,
    // 31 and older may read postings but never apply; the UI shows a notice instead of Apply.
    readOnly: ageDenial === "SPES_AGE_ABOVE_MAX",
    ageRange: { min: SPES_MIN_AGE, max: SPES_MAX_AGE },
    guardianRequired: isGuardianRequired(posting) && tier === TIERS.MINOR,
    applyState: getApplyState(posting),
  };
};

const USER_ELIGIBILITY_FIELDS = "role dateOfBirth ageReviewRequired hasCompletedOnboarding onboardingComplete";

exports.applyToSpes = async (req, res) => {
  try {
    const userId = getUserId(req);

    const posting = await resolvePosting(req.params.postingId);
    if (!posting) return fail(res, 404, "SPES_PROGRAM_NOT_FOUND", "SPES posting not found");
    const closed = applyBlockerCode(posting);
    if (closed) {
      return fail(
        res,
        closed === "SPES_PROGRAM_NOT_FOUND" ? 404 : 400,
        closed,
        closed === "SPES_DEADLINE_PASSED"
          ? "The application deadline for this SPES posting has passed."
          : closed === "SPES_PROGRAM_NOT_FOUND"
            ? "SPES posting not found"
            : "This SPES posting is not open for applications."
      );
    }

    const user = await User.findById(userId).select(
      "role name hasCompletedOnboarding onboardingComplete dateOfBirth ageReviewRequired"
    );
    if (!user) return fail(res, 404, "USER_NOT_FOUND", "User not found");
    if (!["jobseeker", "employee", "resident"].includes(user.role)) {
      return fail(res, 403, "SPES_JOBSEEKER_ONLY", "Only jobseeker accounts can apply for SPES.");
    }
    // Age is recomputed here from the stored date of birth (Asia/Manila), even
    // though the route already ran requireSpesAge.
    const ageDenial = getAgeDenial(user, "spesApply");
    if (ageDenial) return sendAgeDenial(res, ageDenial);

    const nsrpComplete = user.hasCompletedOnboarding === true || user.onboardingComplete === true;
    if (!nsrpComplete) {
      return fail(res, 400, "NSRP_INCOMPLETE", "Complete your NSRP profile before applying for SPES.");
    }

    const existing = await SpesApplication.findOne({ applicant: userId, ...applicationFilterFor(posting) });
    if (existing) {
      return fail(res, 409, "SPES_ALREADY_APPLIED", "You have already applied to this SPES posting.", {
        application: gateResult(existing),
      });
    }

    // ---- form ----
    const body = req.body || {};
    const applicantType = ["osy", "out_of_school_youth"].includes(String(body.applicantType || "").toLowerCase()) ||
      ["true", "1", "on"].includes(String(body.isOutOfSchoolYouth || "").toLowerCase())
      ? APPLICANT_TYPES.OSY
      : APPLICANT_TYPES.STUDENT;
    const isOsy = applicantType === APPLICANT_TYPES.OSY;

    const school = String(body.school || "").trim().slice(0, 160);
    const gradeLevel = String(body.gradeLevel || body.yearLevel || "").trim().slice(0, 60);
    if (!isOsy && (!school || !gradeLevel)) {
      return fail(res, 400, "SPES_STUDENT_FIELDS_REQUIRED", "School and year level are required for enrolled students.");
    }

    let gwa = null;
    let gwaScale = null;
    if (!isOsy) {
      gwaScale = String(body.gwaScale || "").trim();
      if (!GWA_SCALES[gwaScale]) {
        return fail(res, 400, "SPES_GWA_INVALID", "Choose a GWA scale and enter a valid GWA.");
      }
      const n = Number(body.gwa);
      const { min, max } = GWA_SCALES[gwaScale];
      if (body.gwa === undefined || body.gwa === "" || !Number.isFinite(n) || n < min || n > max) {
        return fail(res, 400, "SPES_GWA_INVALID", "Choose a GWA scale and enter a valid GWA.");
      }
      gwa = n;
    }

    const contactNumber = String(body.contactNumber || "").trim().slice(0, 40);
    if (contactNumber && !/^[0-9+\-\s()]{7,20}$/.test(contactNumber)) {
      return fail(res, 400, "SPES_CONTACT_INVALID", "Enter a valid contact number.");
    }

    const ageTier = getAgeTier(user.dateOfBirth);
    const guardianName = String(body.guardianName || "").trim().slice(0, 120);
    const guardianContact = String(body.guardianContact || "").trim().slice(0, 40);
    // The posting's own override wins; otherwise the global config flag.
    if (ageTier === TIERS.MINOR && isGuardianRequired(posting)) {
      if (!guardianName || !guardianContact) {
        return fail(res, 400, "SPES_GUARDIAN_REQUIRED", "A guardian name and contact number are required for applicants under 18.");
      }
    }
    if (guardianContact && !/^[0-9+\-\s()]{7,20}$/.test(guardianContact)) {
      return fail(res, 400, "SPES_CONTACT_INVALID", "Enter a valid contact number.");
    }

    // ---- documents: one typed file per required slot ----
    const required = requiredSlotsFor(posting, applicantType);
    const files = req.files && !Array.isArray(req.files) ? req.files : {};
    const documents = [];
    const missingSlots = [];
    for (const slot of ALL_SLOTS) {
      const file = Array.isArray(files[slot]) ? files[slot][0] : null;
      if (file && file.storedValue) {
        if (!required.includes(slot)) continue; // not part of this posting/applicant type
        documents.push({
          slot,
          label: file.originalname || slot,
          fileUrl: file.storedValue,
          mimeType: file.mimetype,
          size: file.size || 0,
          uploadedAt: new Date(),
          verification: { state: "pending" },
        });
      }
    }
    for (const slot of required) {
      if (!documents.some((d) => d.slot === slot)) missingSlots.push(slot);
    }
    if (missingSlots.length > 0) {
      return fail(res, 400, "SPES_DOCS_MISSING", "Upload every required document.", { missingSlots });
    }

    const application = await SpesApplication.create({
      applicant: userId,
      ...applicationRefsFor(posting),
      nsrpComplete: true,
      contactNumber,
      isOutOfSchoolYouth: isOsy,
      applicantType,
      school: isOsy ? "" : school,
      gradeLevel: isOsy ? "" : gradeLevel,
      gwa,
      gwaScale,
      guardianName,
      guardianContact,
      ageTierAtApplication: ageTier,
      documents,
      status: STATUS.SUBMITTED,
    });

    // The application references the uploaded documents; a later failure must
    // not let the upload cleanup delete them.
    req.uploadsCommitted = true;

    const io = req.app.get("io");

    // Saved; admin/applicant notifications and the audit write are best-effort.
    const postCommitCtx = { req, resourceType: "spes_application", resourceId: application._id };
    await runPostCommit("spes_apply.notify_admins", postCommitCtx, async () => {
      const admins = await User.find({ role: "admin" }).select("_id");
      if (admins.length > 0) {
        await notifyManyUsers({
          recipientIds: admins.map((a) => a._id),
          actorId: userId,
          type: "spes",
          title: "New SPES application",
          message: `${user.name || "An applicant"} applied to "${posting.title}".`,
          relatedEntityType: "spes_application",
          relatedEntityId: application._id,
          actionUrl: "/admin/spes/monitoring",
          io,
          preferenceKey: "notifySpesSubmission",
        });
      }
    });

    await runPostCommit("spes_apply.notify_applicant", postCommitCtx, () => createNotificationForUser({
      recipientId: userId,
      type: "spes",
      title: "SPES application received",
      message:
        "Your SPES application was received. PESO staff will check your documents; you can follow each step under My Applications.",
      relatedEntityType: "spes_application",
      relatedEntityId: application._id,
      actionUrl: "/spes/applications",
      io,
      preferenceKey: "notifyApplicationUpdate",
    }));

    await runPostCommit("spes_apply.audit", postCommitCtx, () => logAuditEvent({
      req,
      actorId: userId,
      actorRole: "jobseeker",
      action: "spes.application.submitted",
      targetType: "spes_application",
      targetId: String(application._id),
      severity: "info",
      metadata: { postingId: String(posting._id), ageTier },
    }));

    return res.status(201).json({ message: "Application submitted", application: gateResult(application) });
  } catch (error) {
    if (error.code === 11000) {
      return fail(res, 409, "SPES_ALREADY_APPLIED", "You have already applied to this SPES posting.");
    }
    return sendError(res, error, "Failed to submit SPES application");
  }
};

// Replace (or add) one document after staff asked for a resubmission.
exports.replaceMyDocument = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { slot } = req.params;
    if (!ALL_SLOTS.includes(slot)) return fail(res, 400, "SPES_SLOT_INVALID", "Unknown document type.");
    const file = req.file;
    if (!file || !file.storedValue) return fail(res, 400, "SPES_DOCS_MISSING", "Choose a file to upload.");

    const posting = await resolvePosting(req.params.postingId);
    if (!posting) return fail(res, 404, "SPES_PROGRAM_NOT_FOUND", "SPES posting not found");
    const app = await SpesApplication.findOne({ applicant: userId, ...applicationFilterFor(posting) });
    if (!app) return fail(res, 404, "SPES_APPLICATION_NOT_FOUND", "Application not found");

    const status = normalizeStatus(app.status);
    if (![STATUS.SUBMITTED, STATUS.DOCUMENTS_REVIEW, STATUS.NEEDS_RESUBMISSION].includes(status)) {
      return fail(res, 409, "SPES_DOCS_LOCKED", "Documents can no longer be changed for this application.");
    }

    const entry = {
      slot,
      label: file.originalname || slot,
      fileUrl: file.storedValue,
      mimeType: file.mimetype,
      size: file.size || 0,
      uploadedAt: new Date(),
      verification: { state: "pending", reason: "", by: null, at: null },
    };
    const index = app.documents.findIndex((d) => d.slot === slot);
    if (index >= 0) app.documents.set(index, entry);
    else app.documents.push(entry);

    let backToReview = false;
    if (status === STATUS.NEEDS_RESUBMISSION && !app.documents.some((d) => d.verification?.state === "needs_replacement")) {
      app.status = STATUS.DOCUMENTS_REVIEW;
      app.needsResubmission = { reason: "", requestedAt: null };
      backToReview = true;
    }
    await app.save();
    req.uploadsCommitted = true;

    const postCommitCtx = { req, resourceType: "spes_application", resourceId: app._id };
    if (backToReview) {
      await runPostCommit("spes_replace.notify_admins", postCommitCtx, async () => {
        const admins = await User.find({ role: "admin" }).select("_id");
        if (admins.length > 0) {
          await notifyManyUsers({
            recipientIds: admins.map((a) => a._id),
            actorId: userId,
            type: "spes",
            title: "SPES documents resubmitted",
            message: "An applicant replaced the documents you asked for.",
            relatedEntityType: "spes_application",
            relatedEntityId: app._id,
            actionUrl: "/admin/spes/monitoring",
            io: req.app.get("io"),
            preferenceKey: "notifySpesSubmission",
          });
        }
      });
    }
    await runPostCommit("spes_replace.audit", postCommitCtx, () => logAuditEvent({
      req,
      actorId: userId,
      actorRole: "jobseeker",
      action: "spes.document.replaced",
      targetType: "spes_application",
      targetId: String(app._id),
      severity: "info",
      metadata: { slot },
    }));

    return res.json({ message: "Document uploaded", application: gateResult(app) });
  } catch (error) {
    return sendError(res, error, "Failed to upload document");
  }
};

exports.withdrawMyApplication = async (req, res) => {
  try {
    const userId = getUserId(req);
    const posting = await resolvePosting(req.params.postingId);
    if (!posting) return fail(res, 404, "SPES_PROGRAM_NOT_FOUND", "SPES posting not found");
    const app = await populateProgram(SpesApplication.findOne({ applicant: userId, ...applicationFilterFor(posting) }));
    if (!app) return fail(res, 404, "SPES_APPLICATION_NOT_FOUND", "Application not found");
    if (!canWithdraw(app.status) || app.resultReleasedAt) {
      return fail(res, 409, "SPES_WITHDRAW_NOT_ALLOWED", "This application can no longer be withdrawn.");
    }

    app.status = STATUS.WITHDRAWN;
    app.withdrawnAt = new Date();
    await app.save();

    const postCommitCtx = { req, resourceType: "spes_application", resourceId: app._id };
    await runPostCommit("spes_withdraw.notify_admins", postCommitCtx, async () => {
      const admins = await User.find({ role: "admin" }).select("_id");
      if (admins.length > 0) {
        await notifyManyUsers({
          recipientIds: admins.map((a) => a._id),
          actorId: userId,
          type: "spes",
          title: "SPES application withdrawn",
          message: `An applicant withdrew from "${posting.title || "a SPES posting"}".`,
          relatedEntityType: "spes_application",
          relatedEntityId: app._id,
          actionUrl: "/admin/spes/monitoring",
          io: req.app.get("io"),
          preferenceKey: "notifySpesSubmission",
        });
      }
    });
    await runPostCommit("spes_withdraw.audit", postCommitCtx, () => logAuditEvent({
      req,
      actorId: userId,
      actorRole: "jobseeker",
      action: "spes.application.withdrawn",
      targetType: "spes_application",
      targetId: String(app._id),
      severity: "info",
    }));

    return res.json({ message: "Application withdrawn", application: gateResult(app) });
  } catch (error) {
    return sendError(res, error, "Failed to withdraw application");
  }
};

exports.getMySpesApplication = async (req, res) => {
  try {
    const userId = getUserId(req);
    const posting = await resolvePosting(req.params.postingId);
    if (!posting) return res.json({ application: null });
    const app = await populateProgram(SpesApplication.findOne({ applicant: userId, ...applicationFilterFor(posting) }));

    if (!app) return res.json({ application: null });
    return res.json({ application: gateResult(app) });
  } catch (error) {
    return sendError(res, error, "Failed to load application");
  }
};

exports.listMySpesApplications = async (req, res) => {
  try {
    const userId = getUserId(req);
    const apps = await populateProgram(SpesApplication.find({ applicant: userId })).sort({ createdAt: -1 });
    return res.json({ items: apps.map(gateResult) });
  } catch (error) {
    return sendError(res, error, "Failed to load applications");
  }
};

// All postings a jobseeker can see (15 and older; users 31+ see them read-only),
// each with the caller's own application and whether they can apply right now.
exports.listPostings = async (req, res) => {
  try {
    const userId = getUserId(req);
    const [postings, userDoc, mine] = await Promise.all([
      listPublishedPostings(),
      User.findById(userId).select(USER_ELIGIBILITY_FIELDS),
      SpesApplication.find({ applicant: userId }).select("posting announcement status"),
    ]);

    const appFor = (posting) =>
      mine.find((a) => {
        const byPosting = a.posting && String(a.posting) === String(posting._id);
        const byAnnouncement =
          a.announcement && [posting._id, posting.legacyAnnouncementId].filter(Boolean).some((id) => String(id) === String(a.announcement));
        return byPosting || byAnnouncement;
      });

    const items = [];
    for (const posting of postings) {
      const application = appFor(posting);
      const eligibility = await eligibilityFor(posting, userDoc, application);
      items.push({
        posting: presentPosting(posting),
        myApplication: application ? { _id: application._id, status: normalizeStatus(application.status) } : null,
        canApply: eligibility.canApply,
        readOnly: eligibility.readOnly,
        blockers: eligibility.blockers,
      });
    }
    return res.json({ items, ageTier: userDoc ? getAgeTier(userDoc.dateOfBirth) : TIERS.UNKNOWN });
  } catch (error) {
    return sendError(res, error, "Failed to load SPES postings");
  }
};

// One posting with the caller's eligibility. A draft or archived posting is only
// visible to someone who already applied to it.
exports.getPostingDetail = async (req, res) => {
  try {
    const userId = getUserId(req);
    const posting = await resolvePosting(req.params.postingId);
    if (!posting) return fail(res, 404, "SPES_PROGRAM_NOT_FOUND", "SPES posting not found");

    const [userDoc, application] = await Promise.all([
      User.findById(userId).select(USER_ELIGIBILITY_FIELDS),
      populateProgram(SpesApplication.findOne({ applicant: userId, ...applicationFilterFor(posting) })),
    ]);
    if (posting.status !== "published" && !application) {
      return fail(res, 404, "SPES_PROGRAM_NOT_FOUND", "SPES posting not found");
    }
    const eligibility = await eligibilityFor(posting, userDoc, application);
    return res.json({
      posting: presentPosting(posting),
      eligibility,
      application: application ? gateResult(application) : null,
    });
  } catch (error) {
    return sendError(res, error, "Failed to load SPES posting");
  }
};

exports.getSpesResultsRoster = async (req, res) => {
  try {
    const posting = await resolvePosting(req.params.postingId);
    if (!posting) return fail(res, 404, "SPES_PROGRAM_NOT_FOUND", "SPES posting not found");
    if (posting.results?.status !== "released" || !posting.results?.publishAcceptedList) {
      return res.json({ published: false, roster: [] });
    }

    const apps = await SpesApplication.find({
      ...applicationFilterFor(posting),
      "result.outcome": { $in: ["accepted", "waitlisted"] },
    })
      .populate("applicant", "name")
      .sort({ "result.rank": 1, createdAt: 1 });

    return res.json({
      published: true,
      summary: posting.results.summary || "",
      resultsUrl: posting.results.url || "",
      roster: apps.map((a) => ({
        name: a.applicant?.name || "Applicant",
        outcome: a.result.outcome,
        rank: a.result.rank || null,
      })),
    });
  } catch (error) {
    return sendError(res, error, "Failed to load results");
  }
};

// Eligibility summary for the apply flow: what the posting requires and whether the
// signed-in user can apply, without creating anything.
exports.getSpesEligibility = async (req, res) => {
  try {
    const posting = await resolvePosting(req.params.postingId);
    if (!posting || posting.status !== "published") {
      return fail(res, 404, "SPES_PROGRAM_NOT_FOUND", "SPES posting not found");
    }
    const userId = getUserId(req);
    const [user, existing] = await Promise.all([
      User.findById(userId).select(USER_ELIGIBILITY_FIELDS),
      SpesApplication.exists({ applicant: userId, ...applicationFilterFor(posting) }),
    ]);
    const eligibility = await eligibilityFor(posting, user, existing);
    return res.json({
      ...eligibility,
      applicationDeadline: posting.applicationDeadline || null,
      requiredSlots: {
        student: requiredSlotsFor(posting, APPLICANT_TYPES.STUDENT),
        osy: requiredSlotsFor(posting, APPLICANT_TYPES.OSY),
      },
    });
  } catch (error) {
    return sendError(res, error, "Failed to check eligibility");
  }
};

// ---------------------------------------------------------------------------
// Admin endpoints (monitoring: the application queue, review, evaluation)
// ---------------------------------------------------------------------------
exports.adminListSpesApplications = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const and = [];

    // `posting` is the filter; `announcement` stays accepted as an alias for old callers.
    // An id may be a native posting or a legacy announcement, so both fields are checked.
    const postingId = req.query.posting || req.query.announcement;
    if (postingId && /^[a-fA-F0-9]{24}$/.test(postingId)) {
      const posting = await resolvePosting(postingId);
      and.push(posting ? applicationFilterFor(posting) : { $or: [{ posting: postingId }, { announcement: postingId }] });
    }
    if (req.query.status) {
      const wanted = String(req.query.status);
      // Legacy values stay filterable and map onto the new lifecycle.
      const legacyAliases = {
        documents_review: ["documents_review", "under_review"],
        qualified: ["qualified", "for_exam", "for_interview"],
      };
      and.push({ status: legacyAliases[wanted] ? { $in: legacyAliases[wanted] } : wanted });
    }
    // Rows from before applicantType existed are told apart by isOutOfSchoolYouth.
    if (req.query.applicantType === "osy") {
      and.push({ $or: [{ applicantType: "osy" }, { isOutOfSchoolYouth: true }] });
    } else if (req.query.applicantType === "student") {
      and.push({ applicantType: { $ne: "osy" }, isOutOfSchoolYouth: { $ne: true } });
    }
    if (req.query.school) {
      and.push({ school: { $regex: escapeRegex(String(req.query.school).trim().slice(0, 80)), $options: "i" } });
    }
    if (req.query.ageTier && Object.values(TIERS).includes(req.query.ageTier)) {
      const range = dobRangeForTier(req.query.ageTier);
      if (range) {
        const ids = await User.find({ dateOfBirth: range }).distinct("_id");
        and.push({ applicant: { $in: ids } });
      }
    }
    const filter = and.length > 0 ? { $and: and } : {};

    const [total, items] = await Promise.all([
      SpesApplication.countDocuments(filter),
      populateAdmin(SpesApplication.find(filter))
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

    return res.json({
      items: items.map(adminView),
      total,
      currentPage: page,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (error) {
    return sendError(res, error, "Failed to load applications");
  }
};

exports.adminGetSpesApplication = async (req, res) => {
  try {
    const app = await loadAdminApplication(req.params.id);
    if (!app) return fail(res, 404, "SPES_APPLICATION_NOT_FOUND", "Application not found");
    return res.json({ application: adminView(app) });
  } catch (error) {
    return sendError(res, error, "Failed to load application");
  }
};

// Applies one admin status transition to a loaded application (not yet saved).
// Returns an error body or null. Notifications are returned for the caller to send.
const applyTransition = (app, target, { reason, adminId }) => {
  const from = normalizeStatus(app.status);
  const to = normalizeStatus(target);
  if (from === to) return { notify: null };
  if (!canAdminTransition(from, to)) {
    return { error: { status: 409, code: "SPES_TRANSITION_NOT_ALLOWED", message: "That status change is not allowed from the current status." } };
  }
  if (to === STATUS.DISQUALIFIED) {
    if (!reason) {
      return { error: { status: 400, code: "SPES_REASON_REQUIRED", message: "A reason is required to disqualify an application." } };
    }
    app.disqualification = { reason, by: adminId, at: new Date() };
    app.status = to;
    return { notify: "disqualified" };
  }
  if (to === STATUS.QUALIFIED) {
    const slotsNeedingReview = (app.documents || []).filter((d) => d.verification?.state !== "verified");
    if ((app.documents || []).length === 0 || slotsNeedingReview.length > 0) {
      return { error: { status: 409, code: "SPES_DOCS_NOT_VERIFIED", message: "Verify every submitted document first." } };
    }
    app.status = to;
    return { notify: "qualified" };
  }
  if (to === STATUS.NEEDS_RESUBMISSION) {
    const rejected = (app.documents || []).filter((d) => d.verification?.state === "needs_replacement");
    if (rejected.length === 0) {
      return { error: { status: 409, code: "SPES_NO_DOCS_REJECTED", message: "Mark at least one document as needing replacement first." } };
    }
    app.needsResubmission = {
      reason: reason || rejected.map((d) => d.verification.reason).filter(Boolean).join("; ").slice(0, 2000),
      requestedAt: new Date(),
    };
    app.status = to;
    return { notify: "needs_resubmission" };
  }
  app.status = to;
  return { notify: null };
};

const STATUS_NOTIFICATIONS = {
  disqualified: (app) => ({
    title: "SPES application update",
    message: `Your SPES application was not qualified. Reason: ${app.disqualification?.reason || "see My Applications"}.`,
  }),
  qualified: () => ({
    title: "SPES: you are qualified",
    message: "Your documents were verified. PESO will contact you about the exam and interview.",
  }),
  needs_resubmission: (app) => ({
    title: "SPES: documents need replacing",
    message: `Please replace the documents PESO flagged. ${app.needsResubmission?.reason || ""}`.trim(),
  }),
};

const notifyApplicantStatus = async (req, app, kind) => {
  const build = STATUS_NOTIFICATIONS[kind];
  if (!build) return;
  await runPostCommit(`spes_status.notify_${kind}`, { req, resourceType: "spes_application", resourceId: app._id }, () =>
    createNotificationForUser({
      recipientId: app.applicant?._id || app.applicant,
      actorId: getUserId(req),
      type: "spes",
      ...build(app),
      relatedEntityType: "spes_application",
      relatedEntityId: app._id,
      actionUrl: "/spes/applications",
      io: req.app.get("io"),
      preferenceKey: "notifyApplicationUpdate",
    })
  );
};

// Staff verify one document: verified, or needs replacement with a reason.
exports.adminVerifyDocument = async (req, res) => {
  try {
    const { state, reason } = req.body || {};
    if (!["verified", "needs_replacement", "pending"].includes(state)) {
      return fail(res, 400, "SPES_VERIFY_STATE_INVALID", "Choose Verified or Needs replacement.");
    }
    const trimmed = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
    if (state === "needs_replacement" && !trimmed) {
      return fail(res, 400, "SPES_REASON_REQUIRED", "A reason is required when a document needs replacement.");
    }

    const app = await loadAdminApplication(req.params.id);
    if (!app) return fail(res, 404, "SPES_APPLICATION_NOT_FOUND", "Application not found");
    const doc = app.documents.id(req.params.docId);
    if (!doc) return fail(res, 404, "SPES_DOCUMENT_NOT_FOUND", "Document not found");
    if (EXCLUDED_STATUSES.includes(normalizeStatus(app.status)) || app.resultReleasedAt) {
      return fail(res, 409, "SPES_DOCS_LOCKED", "Documents can no longer be reviewed for this application.");
    }

    doc.verification = {
      state,
      reason: state === "needs_replacement" ? trimmed : "",
      by: getUserId(req),
      at: new Date(),
    };
    if (normalizeStatus(app.status) === STATUS.SUBMITTED) app.status = STATUS.DOCUMENTS_REVIEW;
    await app.save();

    await audit(req, "spes.document.verified", app, state === "needs_replacement" ? "warning" : "info", {
      slot: doc.slot,
      state,
      reason: trimmed || undefined,
    });

    return res.json({ message: "Document updated", application: adminView(app) });
  } catch (error) {
    return sendError(res, error, "Failed to update document");
  }
};

// Records scores and/or the result, and optionally a status transition.
exports.adminRecordEvaluation = async (req, res) => {
  try {
    const { examScore, interviewScore, outcome, remarks, rank, status } = req.body || {};
    const app = await loadAdminApplication(req.params.id);
    if (!app) return fail(res, 404, "SPES_APPLICATION_NOT_FOUND", "Application not found");

    const trimmedRemarks = typeof remarks === "string" ? remarks.trim().slice(0, 2000) : "";
    const adminId = getUserId(req);
    const previousStatus = normalizeStatus(app.status);

    if (app.resultReleasedAt || previousStatus === STATUS.RESULTS_RELEASED) {
      return fail(res, 409, "SPES_ALREADY_RELEASED", "Results are already released. Use Amend result instead.");
    }

    const exam = parseScore(examScore);
    const interview = parseScore(interviewScore);
    if (exam.error || interview.error) {
      return fail(res, 400, "SPES_SCORE_INVALID", `Scores must be numbers from ${SCORE_MIN} to ${SCORE_MAX}.`);
    }

    // 1. An explicit status change (including disqualify / needs resubmission).
    let notify = null;
    const wantsStatus = typeof status === "string" && status && normalizeStatus(status) !== previousStatus;
    if (wantsStatus) {
      const t = applyTransition(app, status, { reason: trimmedRemarks, adminId });
      if (t.error) return fail(res, t.error.status, t.error.code, t.error.message);
      notify = t.notify;
    }

    // 2. Scores and results need an applicant who is in the evaluation stages.
    const wantsEvaluation = !exam.skip || !interview.skip || (outcome !== undefined && outcome !== "pending");
    const current = normalizeStatus(app.status);
    if (wantsEvaluation) {
      if (EXCLUDED_STATUSES.includes(current)) {
        return fail(res, 409, "SPES_EXCLUDED", "This applicant is withdrawn or disqualified.");
      }
      if (!CAN_RECORD_EVALUATION.includes(current)) {
        return fail(res, 409, "SPES_NOT_QUALIFIED", "Mark the applicant as qualified before recording scores or a result.");
      }
    }

    if (!exam.skip) {
      app.evaluation.examScore = exam.value;
      app.evaluation.examTakenAt = app.evaluation.examTakenAt || new Date();
    }
    if (!interview.skip) {
      app.evaluation.interviewScore = interview.value;
      app.evaluation.interviewAt = app.evaluation.interviewAt || new Date();
    }
    if (wantsEvaluation) app.evaluation.evaluatedBy = adminId;
    if ((!exam.skip || !interview.skip) && current === STATUS.QUALIFIED) app.status = STATUS.EVALUATED;

    if (outcome !== undefined) {
      if (!["pending", ...RELEASABLE_OUTCOMES].includes(outcome)) {
        return fail(res, 400, "SPES_OUTCOME_INVALID", "Choose a valid result.");
      }
      if (outcome !== "pending") {
        const hasScore = app.evaluation.examScore !== null || app.evaluation.interviewScore !== null;
        if (!hasScore) {
          return fail(res, 409, "SPES_SCORES_REQUIRED", "Record an exam or interview score before the result.");
        }
        if (outcome !== "not_accepted" && rank !== undefined && rank !== null && rank !== "") {
          const r = Number(rank);
          if (!Number.isInteger(r) || r < 1) {
            return fail(res, 400, "SPES_RANK_INVALID", "Rank must be a whole number of 1 or more.");
          }
        }
      }
      app.result.outcome = outcome;
      if (typeof remarks === "string") app.result.remarks = trimmedRemarks;
      if (rank !== undefined && rank !== null && rank !== "") app.result.rank = Number(rank);
      app.result.decidedBy = adminId;
      app.result.decidedAt = new Date();
      const now = normalizeStatus(app.status);
      if (outcome !== "pending" && [STATUS.EVALUATED, STATUS.QUALIFIED].includes(now)) {
        app.status = STATUS.RESULT_RECORDED;
      } else if (outcome === "pending" && now === STATUS.RESULT_RECORDED) {
        app.status = STATUS.EVALUATED;
      }
    }

    await app.save();

    if (notify) await notifyApplicantStatus(req, app, notify);

    const finalStatus = normalizeStatus(app.status);
    const isNewExclusion = previousStatus !== finalStatus && EXCLUDED_STATUSES.includes(finalStatus);
    let action = "spes.evaluation.recorded";
    if (finalStatus === STATUS.DISQUALIFIED && isNewExclusion) action = "spes.application.disqualified";
    else if (finalStatus === STATUS.RESULT_RECORDED && previousStatus !== finalStatus) action = "spes.result.recorded";
    else if (previousStatus !== finalStatus && wantsStatus) action = `spes.application.${finalStatus}`;

    await audit(req, action, app, isNewExclusion ? "warning" : "info", {
      status: finalStatus,
      outcome: app.result.outcome,
      remarks: trimmedRemarks || undefined,
    });

    return res.json({ message: "Evaluation saved", application: adminView(app) });
  } catch (error) {
    return sendError(res, error, "Failed to save evaluation");
  }
};

exports.adminAmendResult = async (req, res) => {
  try {
    const { outcome, remarks, rank } = req.body || {};
    if (!RELEASABLE_OUTCOMES.includes(outcome)) {
      return fail(res, 400, "SPES_OUTCOME_INVALID", "Invalid outcome");
    }

    const app = await populateAdmin(SpesApplication.findById(req.params.id));
    if (!app) return fail(res, 404, "SPES_APPLICATION_NOT_FOUND", "Application not found");

    const program = programOf(app.toObject ? app.toObject() : app);
    const alreadyReleased = Boolean(app.resultReleasedAt) || program?.results?.status === "released";
    if (!alreadyReleased) {
      return fail(res, 409, "SPES_NOT_RELEASED", "Results are not released yet. Record the result in the evaluation instead.");
    }
    const trimmedRemarks = typeof remarks === "string" ? remarks.trim().slice(0, 2000) : "";
    if (!trimmedRemarks) {
      return fail(res, 400, "SPES_REASON_REQUIRED", "A reason is required to amend a released result.");
    }
    if (rank !== undefined && rank !== null && rank !== "") {
      const r = Number(rank);
      if (!Number.isInteger(r) || r < 1) return fail(res, 400, "SPES_RANK_INVALID", "Rank must be a whole number of 1 or more.");
    }

    const previousOutcome = app.result.outcome;
    app.result.outcome = outcome;
    app.result.remarks = trimmedRemarks;
    if (rank !== undefined && rank !== null && rank !== "") app.result.rank = Number(rank);
    app.result.decidedBy = getUserId(req);
    app.result.decidedAt = new Date();
    await app.save();

    await createNotificationForUser({
      recipientId: app.applicant?._id || app.applicant,
      actorId: getUserId(req),
      type: "spes",
      title: "SPES result updated",
      message: `Your result for "${program?.title || "a SPES posting"}" was updated.`,
      relatedEntityType: "spes_application",
      relatedEntityId: app._id,
      actionUrl: "/spes/applications",
      io: req.app.get("io"),
      preferenceKey: "notifyApplicationUpdate",
    });

    await audit(req, "spes.result.amended", app, "warning", { outcome, previousOutcome, reason: trimmedRemarks });

    return res.json({ message: "Result updated", application: adminView(app) });
  } catch (error) {
    return sendError(res, error, "Failed to amend result");
  }
};

// Kept for tests and callers that want the shaping helpers next to SPES logic.
exports._internals = { gateResult, adminView, applyTransition, programOf, getAgeFromDate, APPLY_STATE };
