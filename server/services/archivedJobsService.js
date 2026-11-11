// Pure rules for the Employer Dashboard "Archived" tab. Every number, status and
// definition the tab shows is computed here; the client only renders.
//
// Definitions (ARCHIVED_JOBS_REMODEL_PLAN.md section 2):
//   duration      closedAt - createdAt in whole days (never archivedAt)
//   filled        hired >= slots (and at least one hire)
//   time to fill  first hire (earliest statusUpdatedAt of a hired application,
//                 else closedAt) - createdAt; averaged over FILLED jobs only
//   fill rate     filled jobs / archived jobs that had at least one applicant

const DAY_MS = 86400000;

const QUALIFIED_STATUSES = ["under_review", "reviewed", "shortlisted", "approved", "hired", "accepted"];
const SHORTLISTED_STATUSES = ["shortlisted", "approved", "hired", "accepted"];
const HIRED_STATUSES = ["hired", "accepted"];

const STATUSES = ["filled", "closed_manually", "expired", "auto_closed", "closed"];
const FILTERS = ["all", "filled", "closed_manually", "expired", "no_applicants"];
const SORTS = ["recent", "applicants"];

// Old archiveReason values map onto the new closeReason vocabulary.
const LEGACY_REASON_MAP = { manual_close: "manual", deadline_passed: "expired", quota_reached: "filled" };

const norm = (status) => String(status || "").trim().toLowerCase();
const time = (value) => {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(t) ? null : t;
};

// The stored closeReason, else the old archiveReason, else "expired" when the deadline
// had passed by the time the job closed, else null (a legacy job with no data).
const deriveCloseReason = (job) => {
  if (job?.closeReason) return job.closeReason;
  const legacy = job?.archiveReason || job?.archivedMetrics?.archiveReason;
  if (legacy && LEGACY_REASON_MAP[legacy]) return LEGACY_REASON_MAP[legacy];
  const deadline = time(job?.applicationDeadline);
  const closed = closedAtOf(job);
  if (deadline !== null && closed !== null && deadline <= closed) return "expired";
  return null;
};

function closedAtOf(job) {
  return time(job?.closedAt) ?? time(job?.archivedAt) ?? time(job?.archivedMetrics?.archivedAt);
}

const deriveClosedBy = (job, closeReason) => {
  if (job?.closedBy) return job.closedBy;
  if (closeReason === "expired" || closeReason === "inactivity") return "system";
  if (closeReason === "manual") return "employer";
  if (closeReason === "admin") return "admin";
  return null;
};

// filled wins over the way the job was closed. Multi-vacancy: filled only when all are filled.
const deriveStatus = ({ hired, slots, closeReason }) => {
  const vacancies = Math.max(1, Number(slots) || 1);
  if (hired > 0 && hired >= vacancies) return "filled";
  if (closeReason === "manual") return "closed_manually";
  if (closeReason === "expired") return "expired";
  if (closeReason === "inactivity") return "auto_closed";
  return "closed";
};

const durationDays = (createdAt, closedAt) => {
  const start = time(createdAt);
  const end = typeof closedAt === "number" ? closedAt : time(closedAt);
  if (start === null || end === null) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
};

// Funnel counts from one job's non-withdrawn applications.
const buildFunnel = (applications) => {
  const list = Array.isArray(applications) ? applications : [];
  const statuses = list.map((a) => norm(a.status));
  return {
    applicants: list.length,
    qualified: statuses.filter((s) => QUALIFIED_STATUSES.includes(s)).length,
    shortlisted: statuses.filter((s) => SHORTLISTED_STATUSES.includes(s)).length,
    hired: statuses.filter((s) => HIRED_STATUSES.includes(s)).length,
  };
};

// Days from posting to the first hire; falls back to the close time.
const timeToFillDays = (job, applications, closedAt) => {
  const created = time(job?.createdAt);
  if (created === null) return null;
  const hires = (applications || []).filter((a) => HIRED_STATUSES.includes(norm(a.status))).map((a) => time(a.statusUpdatedAt)).filter((t) => t !== null);
  const end = hires.length ? Math.min(...hires) : closedAt;
  if (end === null || end === undefined) return null;
  return Math.max(0, (end - created) / DAY_MS);
};

// A hired person as the employer sees them in the report: id, name and photo only.
// The photo follows the profile rule: a hidden profile shows it only when the applicant
// ticked "Include my photo" on this application. A missing account is "former".
const projectHiredCandidate = ({ user, application }) => {
  if (!user) return { id: String(application.applicant), former: true };
  const hidden = user.privacy?.profileVisibility === "hidden";
  const out = { id: String(user._id), name: user.name || "" };
  if (user.profileImage && (!hidden || application.includePhoto === true)) out.avatar = user.profileImage;
  return out;
};

// One archived job as the list returns it. `applications` are its non-withdrawn
// applications; `usersById` maps hired applicant ids to lean user documents.
const buildArchivedItem = (job, applications, usersById) => {
  const closedAt = closedAtOf(job);
  const funnel = buildFunnel(applications);
  const closeReason = deriveCloseReason(job);
  const vacancies = Math.max(1, Number(job.slots) || 1);
  const status = deriveStatus({ hired: funnel.hired, slots: vacancies, closeReason });
  const firstApplied = (applications || []).map((a) => time(a.appliedAt)).filter((t) => t !== null);
  const hiredCandidates = (applications || [])
    .filter((a) => HIRED_STATUSES.includes(norm(a.status)))
    .map((a) => projectHiredCandidate({ user: usersById.get(String(a.applicant)) || null, application: a }));
  return {
    _id: String(job._id),
    title: job.title,
    location: job.location,
    slots: vacancies,
    postedAt: job.createdAt || null,
    closedAt: closedAt === null ? null : new Date(closedAt),
    status,
    closeReason,
    closedBy: deriveClosedBy(job, closeReason),
    durationDays: durationDays(job.createdAt, closedAt),
    filled: Math.min(funnel.hired, vacancies),
    vacancies,
    funnel,
    firstApplicantAt: firstApplied.length ? new Date(Math.min(...firstApplied)) : null,
    hiredCandidates,
    // For the stats only; stripped before sending.
    _timeToFillDays: status === "filled" ? timeToFillDays(job, applications, closedAt) : null,
  };
};

const buildStats = (items) => {
  const filled = items.filter((i) => i.status === "filled");
  const withApplicants = items.filter((i) => i.funnel.applicants > 0);
  const ttf = filled.map((i) => i._timeToFillDays).filter((n) => typeof n === "number");
  return {
    archivedJobs: items.length,
    totalApplicants: items.reduce((sum, i) => sum + i.funnel.applicants, 0),
    hiredCandidates: items.reduce((sum, i) => sum + i.funnel.hired, 0),
    avgTimeToFillDays: ttf.length ? Math.round((ttf.reduce((a, b) => a + b, 0) / ttf.length) * 10) / 10 : null,
    fillRate: withApplicants.length ? Math.round((filled.length / withApplicants.length) * 100) : null,
    noApplicantJobs: items.filter((i) => i.funnel.applicants === 0).length,
  };
};

const matchesFilter = (item, filter) => {
  if (filter === "filled") return item.status === "filled";
  if (filter === "closed_manually") return item.status === "closed_manually";
  if (filter === "expired") return item.status === "expired";
  if (filter === "no_applicants") return item.funnel.applicants === 0;
  return true;
};

const filterCounts = (items) => Object.fromEntries(FILTERS.map((f) => [f, items.filter((i) => matchesFilter(i, f)).length]));

const applyListControls = (items, { filter = "all", sort = "recent", q = "" } = {}) => {
  const query = String(q || "").trim().toLowerCase();
  const kept = items.filter(
    (i) => matchesFilter(i, FILTERS.includes(filter) ? filter : "all") && (!query || `${i.title} ${i.location}`.toLowerCase().includes(query))
  );
  const closedTime = (i) => (i.closedAt ? new Date(i.closedAt).getTime() : 0);
  kept.sort((a, b) => (sort === "applicants" ? b.funnel.applicants - a.funnel.applicants || closedTime(b) - closedTime(a) : closedTime(b) - closedTime(a)));
  return kept;
};

const stripInternal = ({ _timeToFillDays, ...rest }) => rest;

module.exports = {
  STATUSES,
  FILTERS,
  SORTS,
  QUALIFIED_STATUSES,
  HIRED_STATUSES,
  deriveCloseReason,
  deriveClosedBy,
  deriveStatus,
  durationDays,
  buildFunnel,
  timeToFillDays,
  projectHiredCandidate,
  buildArchivedItem,
  buildStats,
  filterCounts,
  applyListControls,
  stripInternal,
};
