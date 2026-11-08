// Pure helpers for SPES postings: the derived apply state, the shape sent to the
// client, and the adapter that makes a legacy "announcement with a spes flag"
// look like a posting until it is migrated.

const APPLY_STATE = Object.freeze({
  UNPUBLISHED: "unpublished",
  NOT_OPEN: "not_open",
  OPEN: "open",
  CLOSED_DEADLINE: "closed_deadline",
  CLOSED_MANUAL: "closed_manual",
  RESULTS_RELEASED: "results_released",
});

const asDate = (value) => (value ? new Date(value) : null);

// Whether applications are being taken, and if not why.
const getApplyState = (posting, now = new Date()) => {
  if (!posting || posting.status !== "published") return APPLY_STATE.UNPUBLISHED;
  if (posting.results?.status === "released") return APPLY_STATE.RESULTS_RELEASED;
  const closedAt = asDate(posting.closedAt);
  if (closedAt && closedAt <= now) return APPLY_STATE.CLOSED_MANUAL;
  const opensAt = asDate(posting.opensAt);
  if (opensAt && opensAt > now) return APPLY_STATE.NOT_OPEN;
  const deadline = asDate(posting.applicationDeadline);
  if (deadline && deadline < now) return APPLY_STATE.CLOSED_DEADLINE;
  return APPLY_STATE.OPEN;
};

// The four labels people see: draft, open, closed, results_released (archived is
// kept out of normal lists). Derived, never stored.
const getDisplayStatus = (posting, now = new Date()) => {
  if (posting?.status === "archived") return "archived";
  const state = getApplyState(posting, now);
  if (state === APPLY_STATE.UNPUBLISHED) return "draft";
  if (state === APPLY_STATE.RESULTS_RELEASED) return "results_released";
  if (state === APPLY_STATE.OPEN) return "open";
  return "closed";
};

// Why a published posting is not taking applications; null while it is open.
const getClosedReason = (posting, now = new Date()) => {
  const state = getApplyState(posting, now);
  if (state === APPLY_STATE.CLOSED_DEADLINE) return "deadline";
  if (state === APPLY_STATE.CLOSED_MANUAL) return "manual";
  if (state === APPLY_STATE.NOT_OPEN) return "notYetOpen";
  if (state === APPLY_STATE.RESULTS_RELEASED) return "resultsReleased";
  return null;
};

// Error code for an apply attempt against a posting that is not open.
const applyBlockerCode = (posting, now = new Date()) => {
  switch (getApplyState(posting, now)) {
    case APPLY_STATE.OPEN:
      return null;
    case APPLY_STATE.UNPUBLISHED:
      return "SPES_PROGRAM_NOT_FOUND";
    case APPLY_STATE.CLOSED_DEADLINE:
      return "SPES_DEADLINE_PASSED";
    default:
      return "SPES_NOT_OPEN";
  }
};

const idOf = (value) => (value && value._id ? value._id : value);

// A plain object safe to send to a client. Works on a Mongoose document, a plain
// object, or the legacy adapter.
const presentPosting = (posting, now = new Date()) => {
  if (!posting) return null;
  const p = posting.toObject ? posting.toObject() : posting;
  return {
    _id: p._id,
    title: p.title,
    description: p.description || "",
    coverImage: p.coverImage || "",
    status: p.status,
    opensAt: p.opensAt || null,
    applicationDeadline: p.applicationDeadline || null,
    closedAt: p.closedAt || null,
    slots: p.slots ?? null,
    requiredSlots: Array.isArray(p.requiredSlots) ? p.requiredSlots : [],
    requirements: Array.isArray(p.requirements) ? p.requirements : [],
    results: {
      status: p.results?.status || "pending",
      releasedAt: p.results?.releasedAt || null,
      summary: p.results?.summary || "",
      url: p.results?.url || "",
      publishAcceptedList: Boolean(p.results?.publishAcceptedList),
      exposeScores: Boolean(p.results?.exposeScores),
    },
    guardianRequired: p.guardianRequired ?? null,
    publishedAt: p.publishedAt || null,
    newsAnnouncementId: idOf(p.newsAnnouncementId) || null,
    legacy: Boolean(p.legacy),
    applyState: getApplyState(p, now),
    displayStatus: getDisplayStatus(p, now),
    closedReason: getClosedReason(p, now),
  };
};

// Makes an Announcement (category "spes") look like a posting. Writes made through
// the returned object's save() go to the announcement's own `spes` subdocument, so
// until the migration there is exactly one place a legacy posting is stored.
const fromAnnouncement = (announcement) => {
  if (!announcement) return null;
  const a = announcement;
  const s = a.spes || {};
  const posting = {
    _id: a._id,
    legacy: true,
    title: a.title,
    description: a.content || "",
    coverImage: a.imageUrl || "",
    status: a.isActive === false ? "draft" : "published",
    opensAt: s.opensAt || null,
    applicationDeadline: s.applicationDeadline || null,
    closedAt: s.closedAt || null,
    slots: s.slots ?? null,
    requiredSlots: s.requiredSlots || [],
    requirements: s.requirements || [],
    results: {
      status: s.resultsStatus === "published" ? "released" : "pending",
      releasedAt: s.resultsPublishedAt || null,
      releasedBy: s.resultsPublishedBy || null,
      summary: s.resultsSummary || "",
      url: s.resultsUrl || "",
      publishAcceptedList: Boolean(s.publishAcceptedList),
      exposeScores: Boolean(s.exposeScores),
    },
    guardianRequired: null,
    publishedAt: a.publishedAt || null,
    legacyAnnouncementId: a._id,
    newsAnnouncementId: null,
  };
  posting.save = async () => {
    if (!a.spes) a.spes = {};
    a.spes.closedAt = posting.closedAt;
    a.spes.resultsStatus = posting.results.status === "released" ? "published" : "pending";
    a.spes.resultsPublishedAt = posting.results.releasedAt;
    a.spes.resultsPublishedBy = posting.results.releasedBy;
    if (typeof a.save === "function") await a.save();
    return posting;
  };
  return posting;
};

module.exports = {
  APPLY_STATE,
  getApplyState,
  getDisplayStatus,
  getClosedReason,
  applyBlockerCode,
  presentPosting,
  fromAnnouncement,
};
