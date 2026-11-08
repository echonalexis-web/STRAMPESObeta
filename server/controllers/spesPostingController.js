// Staff-side management of SPES postings: create, edit, publish, close and reopen,
// archive, delete (drafts only), and release results (per posting).
const SpesPosting = require("../models/SpesPosting");
const SpesApplication = require("../models/SpesApplication");
const { notifyManyUsers } = require("../services/notificationService");
const { logAuditEvent } = require("../services/auditService");
const { runPostCommit } = require("../utils/postCommit");
const { sendError } = require("../utils/sendError");
const { ALL_SLOTS } = require("../utils/spesDocuments");
const { EXCLUDED_STATUSES, normalizeStatus, STATUS } = require("../utils/spesLifecycle");
const { presentPosting, getApplyState, APPLY_STATE } = require("../utils/spesPosting");
const {
  resolvePosting,
  applicationFilterFor,
  listAllPostings,
  announcePosting,
} = require("../services/spesPostingService");

const getUserId = (req) => req.user.id || req.user._id;
const fail = (res, status, code, message, extra = {}) => res.status(status).json({ code, message, ...extra });

const toBool = (value, fallback) => {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === "on") return true;
  if (value === "false" || value === "0" || value === "off") return false;
  return fallback;
};

const parseDate = (value) => {
  if (value === undefined) return { skip: true };
  if (value === null || value === "") return { value: null };
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? { error: true } : { value: d };
};

// Validates the editable fields of a posting. With `partial`, only the fields that
// are present are checked and returned. Returns { error: {code,message} } or { value }.
const normalizePostingInput = (body = {}, { partial = false, now = new Date() } = {}) => {
  const out = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;

  if (has("title") || !partial) {
    const title = String(body.title || "").trim();
    if (!title) return { error: { code: "SPES_TITLE_REQUIRED", message: "Enter a title." } };
    out.title = title.slice(0, 180);
  }
  if (has("description")) out.description = String(body.description || "").trim().slice(0, 8000);

  for (const key of ["opensAt", "applicationDeadline"]) {
    if (has(key)) {
      const d = parseDate(body[key]);
      if (d.error) return { error: { code: "SPES_DATE_INVALID", message: "Enter a valid date." } };
      out[key] = d.value;
    }
  }

  if (has("slots")) {
    if (body.slots === null || body.slots === "") out.slots = null;
    else {
      const n = Number(body.slots);
      if (!Number.isInteger(n) || n < 0) {
        return { error: { code: "SPES_SLOTS_INVALID", message: "Slots must be a whole number of 0 or more." } };
      }
      out.slots = n;
    }
  }

  if (has("requiredSlots")) {
    const list = Array.isArray(body.requiredSlots) ? body.requiredSlots : [];
    if (list.some((s) => !ALL_SLOTS.includes(s))) {
      return { error: { code: "SPES_SLOT_TYPES_INVALID", message: "Unknown document type." } };
    }
    out.requiredSlots = [...new Set(list)];
  }

  if (has("requirements")) {
    const list = Array.isArray(body.requirements) ? body.requirements : [];
    out.requirements = list.map((r) => String(r).trim().slice(0, 200)).filter(Boolean).slice(0, 30);
  }

  // Results options; the results STATE (pending / released) is never editable here.
  const results = body.results && typeof body.results === "object" ? body.results : null;
  if (results) {
    if (results.summary !== undefined) out["results.summary"] = String(results.summary || "").trim().slice(0, 4000);
    if (results.url !== undefined) out["results.url"] = String(results.url || "").trim().slice(0, 500);
    if (results.publishAcceptedList !== undefined) out["results.publishAcceptedList"] = toBool(results.publishAcceptedList, false);
    if (results.exposeScores !== undefined) out["results.exposeScores"] = toBool(results.exposeScores, false);
  }

  // true / false overrides the global guardian flag; null or "inherit" uses it.
  if (has("guardianRequired")) {
    const v = body.guardianRequired;
    out.guardianRequired = v === null || v === "" || v === "inherit" ? null : toBool(v, null);
  }

  const opens = out.opensAt;
  const deadline = out.applicationDeadline;
  if (opens && deadline && opens >= deadline) {
    return { error: { code: "SPES_PERIOD_INVALID", message: "The application period must end after it opens." } };
  }
  return { value: out, now };
};

const audit = (req, action, posting, severity = "info", metadata) =>
  logAuditEvent({
    req,
    actorId: getUserId(req),
    actorRole: req.user.role === "superadmin" ? "superadmin" : "admin",
    action,
    targetType: "spes_posting",
    targetId: String(posting._id),
    severity,
    metadata,
  });

// Per-posting application counts, from both references (an application that still
// carries only the old announcement id belongs to that announcement's posting).
const countsByPosting = async (postings) => {
  const rows = await SpesApplication.aggregate([
    {
      $group: {
        _id: { posting: "$posting", announcement: "$announcement", status: "$status", outcome: "$result.outcome" },
        n: { $sum: 1 },
      },
    },
  ]);
  const byKey = new Map();
  const bucket = (key) => {
    if (!byKey.has(key)) byKey.set(key, { total: 0, byStatus: {}, byOutcome: {} });
    return byKey.get(key);
  };
  for (const row of rows) {
    const key = String(row._id.posting || row._id.announcement || "");
    if (!key) continue;
    const b = bucket(key);
    const status = normalizeStatus(row._id.status);
    b.byStatus[status] = (b.byStatus[status] || 0) + row.n;
    if (row._id.outcome) b.byOutcome[row._id.outcome] = (b.byOutcome[row._id.outcome] || 0) + row.n;
    b.total += row.n;
  }
  const empty = () => ({ total: 0, byStatus: {}, byOutcome: {} });
  const merge = (a, b) => {
    const m = { total: a.total + b.total, byStatus: { ...a.byStatus }, byOutcome: { ...a.byOutcome } };
    for (const [k, v] of Object.entries(b.byStatus)) m.byStatus[k] = (m.byStatus[k] || 0) + v;
    for (const [k, v] of Object.entries(b.byOutcome)) m.byOutcome[k] = (m.byOutcome[k] || 0) + v;
    return m;
  };
  const result = new Map();
  for (const p of postings) {
    let counts = byKey.get(String(p._id)) || empty();
    if (p.legacyAnnouncementId && !p.legacy) counts = merge(counts, byKey.get(String(p.legacyAnnouncementId)) || empty());
    result.set(String(p._id), counts);
  }
  return result;
};

exports.adminListPostings = async (req, res) => {
  try {
    const postings = await listAllPostings();
    const counts = await countsByPosting(postings);
    const wanted = String(req.query.status || "");
    const items = postings
      .map((p) => ({ ...presentPosting(p), counts: counts.get(String(p._id)) }))
      .filter((p) => (wanted ? p.displayStatus === wanted : p.displayStatus !== "archived"));
    return res.json({ items });
  } catch (error) {
    return sendError(res, error, "Failed to load postings");
  }
};

exports.adminGetPosting = async (req, res) => {
  try {
    const posting = await resolvePosting(req.params.postingId);
    if (!posting) return fail(res, 404, "SPES_PROGRAM_NOT_FOUND", "SPES posting not found");
    const counts = await countsByPosting([posting]);
    return res.json({ posting: { ...presentPosting(posting), counts: counts.get(String(posting._id)) } });
  } catch (error) {
    return sendError(res, error, "Failed to load posting");
  }
};

// Marks a posting published, records when, and sends the optional news card and the
// jobseeker notice (best effort; the posting is already saved).
const publish = async (req, posting, alsoPostToNews) => {
  const first = !posting.publishedAt;
  posting.status = "published";
  if (first) posting.publishedAt = new Date();
  await posting.save();
  await audit(req, "spes.posting.published", posting, "info", { alsoPostToNews: Boolean(alsoPostToNews) });
  if (first || (alsoPostToNews && !posting.newsAnnouncementId)) {
    await runPostCommit("spes_posting.announce", { req, resourceType: "spes_posting", resourceId: posting._id }, () =>
      announcePosting({ posting, authorId: getUserId(req), alsoPostToNews, io: req.app.get("io") })
    );
  }
};

exports.createPosting = async (req, res) => {
  try {
    const parsed = normalizePostingInput(req.body, { partial: false });
    if (parsed.error) return fail(res, 400, parsed.error.code, parsed.error.message);

    const wantsPublish = req.body?.status === "published";
    if (wantsPublish && parsed.value.applicationDeadline && parsed.value.applicationDeadline < new Date()) {
      return fail(res, 400, "SPES_DEADLINE_IN_PAST", "The deadline cannot be in the past when publishing.");
    }

    const { value } = parsed;
    const posting = await SpesPosting.create({
      title: value.title,
      description: value.description || "",
      opensAt: value.opensAt ?? null,
      applicationDeadline: value.applicationDeadline ?? null,
      slots: value.slots ?? null,
      requiredSlots: value.requiredSlots || [],
      requirements: value.requirements || [],
      results: {
        summary: value["results.summary"] || "",
        url: value["results.url"] || "",
        publishAcceptedList: value["results.publishAcceptedList"] || false,
        exposeScores: value["results.exposeScores"] || false,
      },
      guardianRequired: value.guardianRequired ?? null,
      status: "draft",
      createdBy: getUserId(req),
    });
    await audit(req, "spes.posting.created", posting);

    if (wantsPublish) await publish(req, posting, toBool(req.body?.alsoPostToNews, true));

    return res.status(201).json({ message: "Posting created", posting: presentPosting(posting) });
  } catch (error) {
    return sendError(res, error, "Failed to create posting");
  }
};

exports.updatePosting = async (req, res) => {
  try {
    const posting = await resolvePosting(req.params.postingId);
    if (!posting) return fail(res, 404, "SPES_PROGRAM_NOT_FOUND", "SPES posting not found");
    if (posting.legacy) {
      return fail(res, 409, "SPES_POSTING_LEGACY", "This posting was created as an announcement. Edit it there until it is migrated.");
    }
    const parsed = normalizePostingInput(req.body, { partial: true });
    if (parsed.error) return fail(res, 400, parsed.error.code, parsed.error.message);

    const { value } = parsed;
    if (posting.status === "published" && value.applicationDeadline && value.applicationDeadline < new Date()) {
      return fail(res, 400, "SPES_DEADLINE_IN_PAST", "The deadline cannot be in the past on a published posting. Close it instead.");
    }
    const opens = value.opensAt !== undefined ? value.opensAt : posting.opensAt;
    const deadline = value.applicationDeadline !== undefined ? value.applicationDeadline : posting.applicationDeadline;
    if (opens && deadline && new Date(opens) >= new Date(deadline)) {
      return fail(res, 400, "SPES_PERIOD_INVALID", "The application period must end after it opens.");
    }

    for (const [key, v] of Object.entries(value)) {
      if (key.startsWith("results.")) posting.results[key.slice("results.".length)] = v;
      else posting[key] = v;
    }
    await posting.save();
    await audit(req, "spes.posting.updated", posting, "info", { fields: Object.keys(value) });
    return res.json({ message: "Posting updated", posting: presentPosting(posting) });
  } catch (error) {
    return sendError(res, error, "Failed to update posting");
  }
};

exports.setPostingStatus = async (req, res) => {
  try {
    const target = String(req.body?.status || "");
    if (!["draft", "published", "archived"].includes(target)) {
      return fail(res, 400, "SPES_STATUS_INVALID", "Choose draft, published or archived.");
    }
    const posting = await resolvePosting(req.params.postingId);
    if (!posting) return fail(res, 404, "SPES_PROGRAM_NOT_FOUND", "SPES posting not found");
    if (posting.legacy) {
      return fail(res, 409, "SPES_POSTING_LEGACY", "This posting was created as an announcement. Manage it there until it is migrated.");
    }
    if (posting.status === target) return res.json({ posting: presentPosting(posting) });

    if (target === "draft") {
      const applications = await SpesApplication.countDocuments(applicationFilterFor(posting));
      if (applications > 0) {
        return fail(res, 409, "SPES_HAS_APPLICATIONS", "A posting with applications cannot go back to draft. Close or archive it instead.");
      }
    }
    if (target === "published") {
      if (posting.applicationDeadline && posting.applicationDeadline < new Date() && posting.results?.status !== "released") {
        return fail(res, 400, "SPES_DEADLINE_IN_PAST", "The deadline cannot be in the past when publishing.");
      }
      await publish(req, posting, toBool(req.body?.alsoPostToNews, true));
    } else {
      posting.status = target;
      await posting.save();
      await audit(req, target === "archived" ? "spes.posting.archived" : "spes.posting.unpublished", posting);
    }
    return res.json({ message: "Status updated", posting: presentPosting(posting) });
  } catch (error) {
    return sendError(res, error, "Failed to update posting status");
  }
};

exports.deletePosting = async (req, res) => {
  try {
    const posting = await resolvePosting(req.params.postingId);
    if (!posting) return fail(res, 404, "SPES_PROGRAM_NOT_FOUND", "SPES posting not found");
    if (posting.legacy) {
      return fail(res, 409, "SPES_POSTING_LEGACY", "This posting was created as an announcement and cannot be deleted here.");
    }
    if (posting.status !== "draft") {
      return fail(res, 409, "SPES_DELETE_NOT_ALLOWED", "Only draft postings can be deleted. Archive this one instead.");
    }
    const applications = await SpesApplication.countDocuments(applicationFilterFor(posting));
    if (applications > 0) {
      return fail(res, 409, "SPES_HAS_APPLICATIONS", "A posting with applications cannot be deleted. Archive it instead.");
    }
    await SpesPosting.deleteOne({ _id: posting._id });
    await audit(req, "spes.posting.deleted", posting, "warning");
    return res.json({ message: "Posting deleted" });
  } catch (error) {
    return sendError(res, error, "Failed to delete posting");
  }
};

// Open or close a posting's applications manually (works on a legacy posting too).
exports.setPostingClosed = async (req, res) => {
  try {
    const posting = await resolvePosting(req.params.postingId);
    if (!posting) return fail(res, 404, "SPES_PROGRAM_NOT_FOUND", "SPES posting not found");
    const closed = req.body?.closed === true || req.body?.closed === "true";
    posting.closedAt = closed ? new Date() : null;
    await posting.save();
    await audit(req, closed ? "spes.posting.closed" : "spes.posting.reopened", posting);
    return res.json({ message: closed ? "Posting closed" : "Posting reopened", closedAt: posting.closedAt });
  } catch (error) {
    return sendError(res, error, "Failed to update posting");
  }
};

// What a release would do, for the confirmation dialog. Writes nothing.
exports.releaseSummary = async (req, res) => {
  try {
    const posting = await resolvePosting(req.params.postingId);
    if (!posting) return fail(res, 404, "SPES_PROGRAM_NOT_FOUND", "SPES posting not found");
    const apps = await SpesApplication.find(applicationFilterFor(posting)).select("status result.outcome");
    const excluded = apps.filter((a) => EXCLUDED_STATUSES.includes(normalizeStatus(a.status)));
    const decidable = apps.filter((a) => !EXCLUDED_STATUSES.includes(normalizeStatus(a.status)));
    const byOutcome = { accepted: 0, waitlisted: 0, not_accepted: 0, pending: 0 };
    decidable.forEach((a) => {
      byOutcome[a.result?.outcome || "pending"] += 1;
    });
    const released = posting.results?.status === "released";
    return res.json({
      alreadyReleased: released,
      total: apps.length,
      toNotify: decidable.length,
      excluded: excluded.length,
      byOutcome,
      undecided: byOutcome.pending,
      canRelease: decidable.length > 0 && byOutcome.pending === 0 && !released,
    });
  } catch (error) {
    return sendError(res, error, "Failed to load release summary");
  }
};

exports.releaseResults = async (req, res) => {
  try {
    const posting = await resolvePosting(req.params.postingId);
    if (!posting) return fail(res, 404, "SPES_PROGRAM_NOT_FOUND", "SPES posting not found");
    if (posting.results?.status === "released") {
      return fail(res, 400, "SPES_ALREADY_RELEASED", "Results for this posting have already been released.");
    }

    const apps = await SpesApplication.find(applicationFilterFor(posting));
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

    posting.results.status = "released";
    posting.results.releasedAt = now;
    posting.results.releasedBy = userId;
    await posting.save();

    await SpesApplication.updateMany(
      { ...applicationFilterFor(posting), status: { $nin: EXCLUDED_STATUSES } },
      { $set: { status: STATUS.RESULTS_RELEASED, resultReleasedAt: now } }
    );

    await notifyManyUsers({
      recipientIds: decidable.map((a) => a.applicant),
      actorId: userId,
      type: "spes",
      title: "SPES results available",
      message: `Results for "${posting.title}" have been released. View your outcome now.`,
      relatedEntityType: "spes_posting",
      relatedEntityId: posting._id,
      actionUrl: "/spes/applications",
      io: req.app.get("io"),
      preferenceKey: "notifyApplicationUpdate",
    });

    await audit(req, "spes.results.released", posting, "warning", { releasedCount: decidable.length });

    return res.json({
      message: `Results released to ${decidable.length} applicant${decidable.length === 1 ? "" : "s"}.`,
      posting: presentPosting(posting),
    });
  } catch (error) {
    return sendError(res, error, "Failed to release results");
  }
};

exports._internals = { normalizePostingInput, countsByPosting, getApplyState, APPLY_STATE };
