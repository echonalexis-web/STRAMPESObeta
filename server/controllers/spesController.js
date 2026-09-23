const SpesApplication = require("../models/SpesApplication");
const Announcement = require("../models/Announcement");
const User = require("../models/User");
const { createNotificationForUser, notifyManyUsers } = require("../services/notificationService");
const { logAuditEvent } = require("../services/auditService");

const getUserId = (req) => req.user.id || req.user._id;

const RELEASABLE_OUTCOMES = ["accepted", "waitlisted", "not_accepted"];
const EXCLUDED_FROM_GATE = ["withdrawn", "disqualified"];

// Strip admin-only fields from an application unless results have been released
// for its program.
const gateResult = (appDoc) => {
  const obj = appDoc.toObject ? appDoc.toObject() : { ...appDoc };
  const spes = obj.announcement && typeof obj.announcement === "object" ? obj.announcement.spes : null;
  const published = obj.resultReleasedAt || spes?.resultsStatus === "published";

  if (!published) {
    delete obj.result;
    delete obj.evaluation;
    return obj;
  }
  if (spes && spes.exposeScores === false && obj.evaluation) {
    delete obj.evaluation.examScore;
    delete obj.evaluation.interviewScore;
  }
  return obj;
};

// ---------------------------------------------------------------------------
// Applicant endpoints
// ---------------------------------------------------------------------------
exports.applyToSpes = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { announcementId } = req.params;

    const announcement = await Announcement.findOne({ _id: announcementId, isActive: true });
    if (!announcement || announcement.category !== "spes") {
      return res.status(404).json({ message: "SPES program not found" });
    }
    if (
      announcement.spes?.applicationDeadline &&
      new Date(announcement.spes.applicationDeadline) < new Date()
    ) {
      return res.status(400).json({ message: "The application deadline for this SPES program has passed." });
    }

    const user = await User.findById(userId).select("role name hasCompletedOnboarding onboardingComplete");
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!["jobseeker", "employee", "resident"].includes(user.role)) {
      return res.status(403).json({ message: "Only jobseeker accounts can apply for SPES." });
    }

    const nsrpComplete = user.hasCompletedOnboarding === true || user.onboardingComplete === true;
    if (!nsrpComplete) {
      return res.status(400).json({
        code: "NSRP_INCOMPLETE",
        message: "Complete your NSRP profile before applying for SPES.",
      });
    }

    const existing = await SpesApplication.findOne({ applicant: userId, announcement: announcementId });
    if (existing) {
      return res
        .status(409)
        .json({ message: "You have already applied to this SPES program.", application: existing });
    }

    const isOutOfSchoolYouth = ["true", "1", "on"].includes(String(req.body.isOutOfSchoolYouth || "").toLowerCase());
    const school = String(req.body.school || "").trim().slice(0, 160);
    if (!isOutOfSchoolYouth && !school) {
      return res.status(400).json({ message: "School is required unless you are applying as an out-of-school youth." });
    }

    const documents = (req.files || [])
      .filter((f) => f.storedValue)
      .map((f, i) => ({ label: f.originalname || `Document ${i + 1}`, fileUrl: f.storedValue }));

    const application = await SpesApplication.create({
      applicant: userId,
      announcement: announcementId,
      nsrpComplete: true,
      contactNumber: String(req.body.contactNumber || "").trim().slice(0, 40),
      isOutOfSchoolYouth,
      school: isOutOfSchoolYouth ? "" : school,
      gradeLevel: isOutOfSchoolYouth ? "" : String(req.body.gradeLevel || "").trim().slice(0, 60),
      guardianName: String(req.body.guardianName || "").trim().slice(0, 120),
      documents,
      status: "submitted",
    });

    const io = req.app.get("io");

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

    await createNotificationForUser({
      recipientId: userId,
      type: "spes",
      title: "SPES application received",
      message:
        "Your SPES application was received. You'll be scheduled for an exam and interview; results will be posted here on the platform.",
      relatedEntityType: "spes_application",
      relatedEntityId: application._id,
      actionUrl: "/spes/applications",
      io,
      preferenceKey: "notifyApplicationUpdate",
    });

    await logAuditEvent({
      req,
      actorId: userId,
      actorRole: "jobseeker",
      action: "spes.application.submitted",
      targetType: "spes_application",
      targetId: String(application._id),
      severity: "info",
      metadata: { announcementId },
    });

    return res.status(201).json({ message: "Application submitted", application });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "You have already applied to this SPES program." });
    }
    return res.status(500).json({ message: error.message || "Failed to submit SPES application" });
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
    return res.status(500).json({ message: error.message || "Failed to load application" });
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
    return res.status(500).json({ message: error.message || "Failed to load applications" });
  }
};

exports.getSpesResultsRoster = async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.announcementId).select("title spes category");
    if (!announcement || announcement.category !== "spes") {
      return res.status(404).json({ message: "SPES program not found" });
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
    return res.status(500).json({ message: error.message || "Failed to load results" });
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
    if (req.query.status) filter.status = req.query.status;

    const [total, items] = await Promise.all([
      SpesApplication.countDocuments(filter),
      SpesApplication.find(filter)
        .populate("applicant", "name email")
        .populate("announcement", "title spes")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

    return res.json({
      items,
      total,
      currentPage: page,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to load applications" });
  }
};

exports.adminGetSpesApplication = async (req, res) => {
  try {
    const app = await SpesApplication.findById(req.params.id)
      .populate("applicant", "name email phone")
      .populate("announcement", "title spes");
    if (!app) return res.status(404).json({ message: "Application not found" });
    return res.json({ application: app });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to load application" });
  }
};

exports.adminRecordEvaluation = async (req, res) => {
  try {
    const { examScore, interviewScore, outcome, remarks, rank, status } = req.body;
    const app = await SpesApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ message: "Application not found" });

    const trimmedRemarks = typeof remarks === "string" ? remarks.trim().slice(0, 2000) : "";

    // Explicitly excluding an applicant (they withdrew, or were disqualified)
    // always needs a recorded reason — this is the only way to pull a
    // neglected/stuck applicant out of a program's results-release gate,
    // so it should never happen silently.
    if ((status === "withdrawn" || status === "disqualified") && !trimmedRemarks) {
      return res.status(400).json({
        message: `A reason in Remarks is required to mark an application as ${status}.`,
      });
    }

    if (examScore !== undefined && examScore !== null && examScore !== "") {
      app.evaluation.examScore = Number(examScore);
      app.evaluation.examTakenAt = app.evaluation.examTakenAt || new Date();
    }
    if (interviewScore !== undefined && interviewScore !== null && interviewScore !== "") {
      app.evaluation.interviewScore = Number(interviewScore);
      app.evaluation.interviewAt = app.evaluation.interviewAt || new Date();
    }
    app.evaluation.evaluatedBy = getUserId(req);

    if (outcome !== undefined && ["pending", ...RELEASABLE_OUTCOMES].includes(outcome)) {
      app.result.outcome = outcome;
      app.result.remarks = typeof remarks === "string" ? trimmedRemarks : app.result.remarks;
      if (rank !== undefined && rank !== null && rank !== "") app.result.rank = Number(rank);
      app.result.decidedBy = getUserId(req);
      app.result.decidedAt = new Date();
    }

    const previousStatus = app.status;
    const validStages = ["under_review", "for_exam", "for_interview", "evaluated", "withdrawn", "disqualified"];
    if (status && validStages.includes(status)) {
      app.status = status;
    } else if (app.result.outcome !== "pending" && app.status !== "results_released") {
      app.status = "evaluated";
    }

    await app.save();

    const isNewExclusion =
      previousStatus !== app.status && ["withdrawn", "disqualified"].includes(app.status);

    await logAuditEvent({
      req,
      actorId: getUserId(req),
      actorRole: "admin",
      action: isNewExclusion ? `spes.application.${app.status}` : "spes.evaluation.recorded",
      targetType: "spes_application",
      targetId: String(app._id),
      severity: isNewExclusion ? "warning" : "info",
      metadata: { outcome: app.result.outcome, status: app.status, remarks: trimmedRemarks || undefined },
    });

    return res.json({ message: "Evaluation saved", application: app });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to save evaluation" });
  }
};

exports.adminReleaseResults = async (req, res) => {
  try {
    const { announcementId } = req.params;
    const announcement = await Announcement.findById(announcementId);
    if (!announcement || announcement.category !== "spes") {
      return res.status(404).json({ message: "SPES program not found" });
    }
    if (announcement.spes?.resultsStatus === "published") {
      return res.status(400).json({ message: "Results for this program have already been released." });
    }

    const apps = await SpesApplication.find({ announcement: announcementId });
    const decidable = apps.filter((a) => !EXCLUDED_FROM_GATE.includes(a.status));
    if (decidable.length === 0) {
      return res.status(400).json({ message: "There are no applications to release results for." });
    }
    const undecided = decidable.filter((a) => a.result.outcome === "pending");
    if (undecided.length > 0) {
      return res.status(400).json({
        message: `${undecided.length} of ${decidable.length} applications still have no decided outcome.`,
      });
    }

    const now = new Date();
    const userId = getUserId(req);

    announcement.spes.resultsStatus = "published";
    announcement.spes.resultsPublishedAt = now;
    announcement.spes.resultsPublishedBy = userId;
    await announcement.save();

    await SpesApplication.updateMany(
      { announcement: announcementId, status: { $nin: EXCLUDED_FROM_GATE } },
      { $set: { status: "results_released", resultReleasedAt: now } }
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
    return res.status(500).json({ message: error.message || "Failed to release results" });
  }
};

exports.adminAmendResult = async (req, res) => {
  try {
    const { outcome, remarks, rank } = req.body;
    if (!RELEASABLE_OUTCOMES.includes(outcome)) {
      return res.status(400).json({ message: "Invalid outcome" });
    }

    const app = await SpesApplication.findById(req.params.id).populate("announcement", "title spes");
    if (!app) return res.status(404).json({ message: "Application not found" });

    app.result.outcome = outcome;
    if (typeof remarks === "string") app.result.remarks = remarks.trim().slice(0, 2000);
    if (rank !== undefined && rank !== null && rank !== "") app.result.rank = Number(rank);
    app.result.decidedBy = getUserId(req);
    app.result.decidedAt = new Date();
    await app.save();

    const alreadyReleased = Boolean(app.resultReleasedAt) || app.announcement?.spes?.resultsStatus === "published";
    if (alreadyReleased) {
      await createNotificationForUser({
        recipientId: app.applicant,
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
    }

    await logAuditEvent({
      req,
      actorId: getUserId(req),
      actorRole: "admin",
      action: "spes.result.amended",
      targetType: "spes_application",
      targetId: String(app._id),
      severity: "warning",
      metadata: { outcome },
    });

    return res.json({ message: "Result updated", application: app });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to amend result" });
  }
};
