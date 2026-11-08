const SpesApplication = require("../models/SpesApplication");
const Announcement = require("../models/Announcement");
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
const spesConfig = require("../config/spes");

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

const isProgramOpen = (announcement, now = new Date()) => {
  const spes = announcement.spes || {};
  if (spes.closedAt && new Date(spes.closedAt) <= now) return "SPES_NOT_OPEN";
  if (spes.opensAt && new Date(spes.opensAt) > now) return "SPES_NOT_OPEN";
  if (spes.applicationDeadline && new Date(spes.applicationDeadline) < now) return "SPES_DEADLINE_PASSED";
  return null;
};

const parseScore = (value) => {
  if (value === undefined || value === null || value === "") return { skip: true };
  const n = Number(value);
  if (!Number.isFinite(n) || n < SCORE_MIN || n > SCORE_MAX) return { error: true };
  return { value: n };
};

// What an applicant may see of their own application. Admin-only working data
// (scores, result, internal note) is stripped until results are released.
// Disqualification and resubmission reasons are visible straight away.
const gateResult = (appDoc) => {
  const obj = appDoc.toObject ? appDoc.toObject() : { ...appDoc };
  const spes = obj.announcement && typeof obj.announcement === "object" ? obj.announcement.spes : null;
  const published = obj.resultReleasedAt || spes?.resultsStatus === "published";

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
  if (spes && spes.exposeScores === false && obj.evaluation) {
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
  const applicant = obj.applicant && typeof obj.applicant === "object" ? obj.applicant : null;
  if (applicant) {
    obj.applicantAgeTier = getAgeTier(applicant.dateOfBirth);
    delete applicant.dateOfBirth;
  }
  obj.applicantMissingProfile = !applicant || !String(applicant.name || "").trim();
  return obj;
};

const populateAdmin = (query) =>
  query
    .populate("applicant", "name email phone dateOfBirth")
    .populate("announcement", "title spes");

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
exports.applyToSpes = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { announcementId } = req.params;

    const announcement = await Announcement.findOne({ _id: announcementId, isActive: true });
    if (!announcement || announcement.category !== "spes") {
      return fail(res, 404, "SPES_PROGRAM_NOT_FOUND", "SPES program not found");
    }
    const closed = isProgramOpen(announcement);
    if (closed) {
      return fail(
        res,
        400,
        closed,
        closed === "SPES_DEADLINE_PASSED"
          ? "The application deadline for this SPES program has passed."
          : "This SPES program is not open for applications."
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

    const existing = await SpesApplication.findOne({ applicant: userId, announcement: announcementId });
    if (existing) {
      return fail(res, 409, "SPES_ALREADY_APPLIED", "You have already applied to this SPES program.", {
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
    if (ageTier === TIERS.MINOR && spesConfig.guardianRequiredForMinors) {
      if (!guardianName || !guardianContact) {
        return fail(res, 400, "SPES_GUARDIAN_REQUIRED", "A guardian name and contact number are required for applicants under 18.");
      }
    }
    if (guardianContact && !/^[0-9+\-\s()]{7,20}$/.test(guardianContact)) {
      return fail(res, 400, "SPES_CONTACT_INVALID", "Enter a valid contact number.");
    }

    // ---- documents: one typed file per required slot ----
    const required = requiredSlotsFor(announcement, applicantType);
    const files = req.files && !Array.isArray(req.files) ? req.files : {};
    const documents = [];
    const missingSlots = [];
    for (const slot of ALL_SLOTS) {
      const file = Array.isArray(files[slot]) ? files[slot][0] : null;
      if (file && file.storedValue) {
        if (!required.includes(slot)) continue; // not part of this program/applicant type
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
      announcement: announcementId,
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
          message: `${user.name || "An applicant"} applied to "${announcement.title}".`,
          relatedEntityType: "spes_application",
          relatedEntityId: application._id,
          actionUrl: "/admin/spes",
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
        "Your SPES application was received. PESO staff will check your documents; you can follow each step under My SPES.",
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
      metadata: { announcementId, ageTier },
    }));

    return res.status(201).json({ message: "Application submitted", application: gateResult(application) });
  } catch (error) {
    if (error.code === 11000) {
      return fail(res, 409, "SPES_ALREADY_APPLIED", "You have already applied to this SPES program.");
    }
    return sendError(res, error, "Failed to submit SPES application");
  }
};

// Replace (or add) one document after staff asked for a resubmission.
exports.replaceMyDocument = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { announcementId, slot } = req.params;
    if (!ALL_SLOTS.includes(slot)) return fail(res, 400, "SPES_SLOT_INVALID", "Unknown document type.");
    const file = req.file;
    if (!file || !file.storedValue) return fail(res, 400, "SPES_DOCS_MISSING", "Choose a file to upload.");

    const app = await SpesApplication.findOne({ applicant: userId, announcement: announcementId });
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
            actionUrl: "/admin/spes",
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
    const app = await SpesApplication.findOne({
      applicant: userId,
      announcement: req.params.announcementId,
    }).populate("announcement", "title spes");
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
          message: `An applicant withdrew from "${app.announcement?.title || "a SPES program"}".`,
          relatedEntityType: "spes_application",
          relatedEntityId: app._id,
          actionUrl: "/admin/spes",
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
    const app = await SpesApplication.findOne({
      applicant: userId,
      announcement: req.params.announcementId,
    }).populate("announcement", "title spes category");

    if (!app) return res.json({ application: null });
    return res.json({ application: gateResult(app) });
  } catch (error) {
    return sendError(res, error, "Failed to load application");
  }
};

exports.listMySpesApplications = async (req, res) => {
  try {
    const userId = getUserId(req);
    const apps = await SpesApplication.find({ applicant: userId })
      .populate("announcement", "title spes category")
      .sort({ createdAt: -1 });
    return res.json({ items: apps.map(gateResult) });
  } catch (error) {
    return sendError(res, error, "Failed to load applications");
  }
};

exports.getSpesResultsRoster = async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.announcementId).select("title spes category");
    if (!announcement || announcement.category !== "spes") {
      return fail(res, 404, "SPES_PROGRAM_NOT_FOUND", "SPES program not found");
    }
    if (announcement.spes?.resultsStatus !== "published" || !announcement.spes?.publishAcceptedList) {
      return res.json({ published: false, roster: [] });
    }

    const apps = await SpesApplication.find({
      announcement: announcement._id,
      "result.outcome": { $in: ["accepted", "waitlisted"] },
    })
      .populate("applicant", "name")
      .sort({ "result.rank": 1, createdAt: 1 });

    return res.json({
      published: true,
      summary: announcement.spes.resultsSummary || "",
      resultsUrl: announcement.spes.resultsUrl || "",
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

// Eligibility summary for the apply flow: what the program requires and
// whether the signed-in user can apply, without creating anything.
exports.getSpesEligibility = async (req, res) => {
  try {
    const announcement = await Announcement.findOne({ _id: req.params.announcementId, isActive: true }).select(
      "title category spes"
    );
    if (!announcement || announcement.category !== "spes") {
      return fail(res, 404, "SPES_PROGRAM_NOT_FOUND", "SPES program not found");
    }
    const user = await User.findById(getUserId(req)).select(
      "role dateOfBirth ageReviewRequired hasCompletedOnboarding onboardingComplete"
    );
    const programClosed = isProgramOpen(announcement);
    const ageDenial = user ? getAgeDenial(user, "spesApply") : "DOB_REQUIRED";
    const nsrpComplete = user?.hasCompletedOnboarding === true || user?.onboardingComplete === true;
    const existing = await SpesApplication.exists({ applicant: getUserId(req), announcement: announcement._id });
    const blockers = [];
    if (programClosed) blockers.push(programClosed);
    if (ageDenial) blockers.push(ageDenial);
    if (!nsrpComplete) blockers.push("NSRP_INCOMPLETE");
    if (existing) blockers.push("SPES_ALREADY_APPLIED");

    return res.json({
      canApply: blockers.length === 0,
      blockers,
      ageTier: user ? getAgeTier(user.dateOfBirth) : TIERS.UNKNOWN,
      ageRange: { min: SPES_MIN_AGE, max: SPES_MAX_AGE },
      guardianRequired: spesConfig.guardianRequiredForMinors && getAgeTier(user?.dateOfBirth) === TIERS.MINOR,
      applicationDeadline: announcement.spes?.applicationDeadline || null,
      requiredSlots: {
        student: requiredSlotsFor(announcement, APPLICANT_TYPES.STUDENT),
        osy: requiredSlotsFor(announcement, APPLICANT_TYPES.OSY),
      },
    });
  } catch (error) {
    return sendError(res, error, "Failed to check eligibility");
  }
};

// ---------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------
exports.adminListSpesApplications = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const filter = {};
    if (req.query.announcement && /^[a-fA-F0-9]{24}$/.test(req.query.announcement)) {
      filter.announcement = req.query.announcement;
    }
    if (req.query.status) {
      const wanted = String(req.query.status);
      // Legacy values stay filterable and map onto the new lifecycle.
      const legacyAliases = {
        documents_review: ["documents_review", "under_review"],
        qualified: ["qualified", "for_exam", "for_interview"],
      };
      filter.status = legacyAliases[wanted] ? { $in: legacyAliases[wanted] } : wanted;
    }
    // Rows from before applicantType existed are told apart by isOutOfSchoolYouth.
    if (req.query.applicantType === "osy") {
      filter.$or = [{ applicantType: "osy" }, { isOutOfSchoolYouth: true }];
    } else if (req.query.applicantType === "student") {
      filter.applicantType = { $ne: "osy" };
      filter.isOutOfSchoolYouth = { $ne: true };
    }
    if (req.query.school) {
      filter.school = { $regex: escapeRegex(String(req.query.school).trim().slice(0, 80)), $options: "i" };
    }
    if (req.query.ageTier && Object.values(TIERS).includes(req.query.ageTier)) {
      const range = dobRangeForTier(req.query.ageTier);
      if (range) {
        const ids = await User.find({ dateOfBirth: range }).distinct("_id");
        filter.applicant = { $in: ids };
      }
    }

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
    message: `Your SPES application was not qualified. Reason: ${app.disqualification?.reason || "see My SPES"}.`,
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

    // 2. Scores and result need an applicant who is in the evaluation stages.
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

// Staff-only list of SPES programs with per-status counts.
exports.adminListPrograms = async (req, res) => {
  try {
    const programs = await Announcement.find({ category: "spes" })
      .select("title isActive spes publishedAt createdAt")
      .sort({ createdAt: -1 })
      .limit(100);
    const ids = programs.map((p) => p._id);
    const counts = await SpesApplication.aggregate([
      { $match: { announcement: { $in: ids } } },
      { $group: { _id: { announcement: "$announcement", status: "$status", outcome: "$result.outcome" }, n: { $sum: 1 } } },
    ]);
    const byProgram = new Map();
    for (const row of counts) {
      const key = String(row._id.announcement);
      const entry = byProgram.get(key) || { byStatus: {}, byOutcome: {}, total: 0 };
      const status = normalizeStatus(row._id.status);
      entry.byStatus[status] = (entry.byStatus[status] || 0) + row.n;
      if (row._id.outcome) entry.byOutcome[row._id.outcome] = (entry.byOutcome[row._id.outcome] || 0) + row.n;
      entry.total += row.n;
      byProgram.set(key, entry);
    }
    const now = new Date();
    return res.json({
      items: programs.map((p) => {
        const entry = byProgram.get(String(p._id)) || { byStatus: {}, byOutcome: {}, total: 0 };
        return {
          _id: p._id,
          title: p.title,
          isActive: p.isActive,
          applicationDeadline: p.spes?.applicationDeadline || null,
          slots: p.spes?.slots ?? null,
          closedAt: p.spes?.closedAt || null,
          resultsStatus: p.spes?.resultsStatus || "pending",
          open: !isProgramOpen(p, now) && p.isActive !== false,
          counts: entry,
        };
      }),
    });
  } catch (error) {
    return sendError(res, error, "Failed to load programs");
  }
};

// Open or close a program's applications manually.
exports.adminSetProgramClosed = async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.announcementId);
    if (!announcement || announcement.category !== "spes") {
      return fail(res, 404, "SPES_PROGRAM_NOT_FOUND", "SPES program not found");
    }
    const closed = req.body?.closed === true || req.body?.closed === "true";
    announcement.spes.closedAt = closed ? new Date() : null;
    await announcement.save();
    await logAuditEvent({
      req,
      actorId: getUserId(req),
      actorRole: "admin",
      action: closed ? "spes.program.closed" : "spes.program.reopened",
      targetType: "announcement",
      targetId: String(announcement._id),
      severity: "info",
    });
    return res.json({ message: closed ? "Program closed" : "Program reopened", closedAt: announcement.spes.closedAt });
  } catch (error) {
    return sendError(res, error, "Failed to update program");
  }
};

// What a release would do, for the confirmation dialog. Writes nothing.
exports.adminReleaseSummary = async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.announcementId).select("title category spes");
    if (!announcement || announcement.category !== "spes") {
      return fail(res, 404, "SPES_PROGRAM_NOT_FOUND", "SPES program not found");
    }
    const apps = await SpesApplication.find({ announcement: announcement._id }).select("status result.outcome");
    const excluded = apps.filter((a) => EXCLUDED_STATUSES.includes(normalizeStatus(a.status)));
    const decidable = apps.filter((a) => !EXCLUDED_STATUSES.includes(normalizeStatus(a.status)));
    const byOutcome = { accepted: 0, waitlisted: 0, not_accepted: 0, pending: 0 };
    decidable.forEach((a) => {
      byOutcome[a.result?.outcome || "pending"] += 1;
    });
    return res.json({
      alreadyReleased: announcement.spes?.resultsStatus === "published",
      total: apps.length,
      toNotify: decidable.length,
      excluded: excluded.length,
      byOutcome,
      undecided: byOutcome.pending,
      canRelease: decidable.length > 0 && byOutcome.pending === 0 && announcement.spes?.resultsStatus !== "published",
    });
  } catch (error) {
    return sendError(res, error, "Failed to load release summary");
  }
};

exports.adminReleaseResults = async (req, res) => {
  try {
    const { announcementId } = req.params;
    const announcement = await Announcement.findById(announcementId);
    if (!announcement || announcement.category !== "spes") {
      return fail(res, 404, "SPES_PROGRAM_NOT_FOUND", "SPES program not found");
    }
    if (announcement.spes?.resultsStatus === "published") {
      return fail(res, 400, "SPES_ALREADY_RELEASED", "Results for this program have already been released.");
    }

    const apps = await SpesApplication.find({ announcement: announcementId });
    const decidable = apps.filter((a) => !EXCLUDED_STATUSES.includes(normalizeStatus(a.status)));
    if (decidable.length === 0) {
      return fail(res, 400, "SPES_NO_APPLICATIONS", "There are no applications to release results for.");
    }
    const undecided = decidable.filter((a) => a.result.outcome === "pending");
    if (undecided.length > 0) {
      return fail(
        res,
        400,
        "SPES_UNDECIDED_REMAIN",
        `${undecided.length} of ${decidable.length} applications still have no decided outcome.`,
        { undecided: undecided.length, total: decidable.length }
      );
    }

    const now = new Date();
    const userId = getUserId(req);

    announcement.spes.resultsStatus = "published";
    announcement.spes.resultsPublishedAt = now;
    announcement.spes.resultsPublishedBy = userId;
    await announcement.save();

    await SpesApplication.updateMany(
      { announcement: announcementId, status: { $nin: EXCLUDED_STATUSES } },
      { $set: { status: STATUS.RESULTS_RELEASED, resultReleasedAt: now } }
    );

    const io = req.app.get("io");
    await notifyManyUsers({
      recipientIds: decidable.map((a) => a.applicant),
      actorId: userId,
      type: "spes",
      title: "SPES results available",
      message: `Results for "${announcement.title}" have been released. View your outcome now.`,
      relatedEntityType: "announcement",
      relatedEntityId: announcement._id,
      actionUrl: "/spes/applications",
      io,
      preferenceKey: "notifyApplicationUpdate",
    });

    await logAuditEvent({
      req,
      actorId: userId,
      actorRole: "admin",
      action: "spes.results.released",
      targetType: "announcement",
      targetId: String(announcement._id),
      severity: "warning",
      metadata: { releasedCount: decidable.length },
    });

    return res.json({
      message: `Results released to ${decidable.length} applicant${decidable.length === 1 ? "" : "s"}.`,
      announcement,
    });
  } catch (error) {
    return sendError(res, error, "Failed to release results");
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

    const alreadyReleased = Boolean(app.resultReleasedAt) || app.announcement?.spes?.resultsStatus === "published";
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
      message: `Your result for "${app.announcement?.title || "a SPES program"}" was updated.`,
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

// Kept for tests and callers that want the tier/age helpers next to SPES logic.
exports._internals = { gateResult, adminView, applyTransition, isProgramOpen, getAgeFromDate };
