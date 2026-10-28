import JobFavoriteButton from "./JobFavoriteButton";
import EmployerAvatar from "./EmployerAvatar";
import { FaUsers, FaStar, FaHeart, FaCheck, FaTimes } from "react-icons/fa";
import { tierForPercent } from "../utils/qualifications";
import "../styles/vacancy-card.css";

// A single line for the card. Drop the hyper-local barangay / zone prefix
// when a city + province follow it — that prefix is the least useful part
// and would otherwise be all that fits before the ellipsis.
const formatLocationLine = (address) => {
  if (!address) return "Location not specified";
  const parts = String(address).split(", ").filter(Boolean);
  return parts.length > 2 ? parts.slice(1).join(", ") : address;
};

const timeAgo = (date) => {
  if (!date) return null;
  const then = new Date(date).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
};

const matchKey = (type, value) => `${String(type || "skill").toLowerCase()}::${String(value).trim().toLowerCase()}`;

/**
 * The job card shown to jobseekers on the Job Board and Dashboard, and — in
 * `preview` mode — to employers while they draft a posting, so the two stay
 * in sync by construction.
 *
 * props:
 *   job            job-shaped object
 *   applied        the current user already applied
 *   followed       from an employer the user follows
 *   preferred      matches one of the user's preferred industries
 *   matchAvailable the user has skills on file (so the % means something)
 *   preview        employer draft preview: no favourite, no navigation, no apply
 *   onOpen         open the job detail page
 *   onApply        go to the apply screen
 */
export default function VacancyCard({
  job,
  applied = false,
  followed = false,
  preferred = false,
  matchAvailable = true,
  preview = false,
  onOpen,
  onApply,
}) {
  const checklist = job?.checklistMatch || null;
  const hasChecklist = matchAvailable && Boolean(checklist);
  // Falls back to the plain relevance percent when the job states no
  // scoreable requirements at all (checklist is null) — same percent the
  // card always showed, just without the must-haves breakdown below it.
  const percent = hasChecklist ? checklist.percent : Math.round((job?.relevanceScore || 0) * 100);
  const scoreTier = tierForPercent(percent);
  const tier = !matchAvailable ? "na" : scoreTier.cls;
  // The checklist percent and the fuzzy relevanceScore percent are different
  // metrics on the same 0-100 scale — the badge must never let one look like
  // the other. A checklist match gets its own literal tier wording ("Good
  // match"); without one, the badge says so explicitly rather than guessing
  // a tier label from the relevance score.
  const tierLabel = hasChecklist ? `${checklist.tier} match` : "Estimated fit";
  const applicantCount = Number(job?.applicationCount || 0);
  const posted = timeAgo(job?.createdAt);
  const openings = Number(job?.remainingSlots ?? job?.slots ?? 0);

  const salaryText = job?.salary
    ? (/^\s*(₱|php)/i.test(String(job.salary)) ? String(job.salary) : `₱${job.salary}`)
    : "Salary negotiable";
  const facts = [
    formatLocationLine(job?.location),
    salaryText,
    job?.jobType || "Full-time",
    openings > 0 ? `${openings} opening${openings === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join("  ·  ");

  const clickable = !preview && typeof onOpen === "function";

  // First three Required qualifications, each flagged met/missing against
  // checklist.missingRequired (same type+value, folded "other"→skill) —
  // matches the server's own required/preferred split, not a re-score.
  const missingKeys = new Set((checklist?.missingRequired || []).map((q) => matchKey(q.type, q.value)));
  const requiredPreviewQuals = Array.isArray(job?.qualifications)
    ? job.qualifications.filter((q) => q?.value && q.optional !== true).slice(0, 3)
    : [];

  return (
    <article
      className={`vac-card ${preferred ? "is-preferred" : ""} ${followed ? "is-followed" : ""} ${preview ? "is-preview" : ""}`}
      role={clickable ? "link" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onOpen : undefined}
      onKeyDown={clickable ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      } : undefined}
    >
      <div className="vac-card-top">
        <div className="vac-brand">
          <EmployerAvatar employer={job?.employer} className="vac-logo" />
          <div className="vac-brand-text">
            <span className="vac-company">{job?.employer?.companyName || job?.employer?.name || "Employer"}</span>
            <h3 className="vac-title">{job?.title || "Job title"}</h3>
          </div>
        </div>
        {!preview && (
          <div className="vac-tools" onClick={(event) => event.stopPropagation()}>
            <JobFavoriteButton jobId={job?._id} hideCount variant="heart" />
          </div>
        )}
      </div>

      <p className="vac-facts">{facts}</p>

      <div className="vac-meta">
        <span className="vac-pill vac-pill--open">Open</span>
        {applied && <span className="vac-pill vac-pill--applied">Applied</span>}
        {followed && (
          <span className="vac-pill vac-pill--follow" title="From an employer you follow">
            <FaHeart /> Following
          </span>
        )}
        {preferred && (
          <span className="vac-pill vac-pill--preferred" title="Matches your preferred industry">
            <FaStar /> Preferred
          </span>
        )}
      </div>

      {!preview && tier !== "na" && (
        <div className="vac-match-panel">
          <div className="vac-match-head">
            <span className={`vac-match-tier tier-${tier}`}>{tierLabel}</span>
            <span className="vac-match-percent">{percent}%</span>
          </div>
          <div className="vac-match-bar">
            <div className={`vac-match-bar-fill tier-${tier}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
          </div>
          {hasChecklist && checklist.totalMustHaves > 0 && (
            <p className="vac-match-musthaves">
              You meet {checklist.metMustHaves} of {checklist.totalMustHaves} must-haves
            </p>
          )}
          {hasChecklist && checklist.missingRequired?.length > 0 && (
            <p className="vac-match-missing">
              Missing: {checklist.missingRequired.map((q) => q.value).join(", ")}
            </p>
          )}
        </div>
      )}

      {!preview && requiredPreviewQuals.length > 0 && (
        <div className="vac-req-pills">
          {requiredPreviewQuals.map((q) => {
            const met = matchAvailable && !missingKeys.has(matchKey(q.type, q.value));
            return (
              <span key={`${q.type}-${q.value}`} className={`vac-req-pill ${met ? "is-met" : "is-missing"}`}>
                {met ? <FaCheck /> : <FaTimes />} {q.value}
              </span>
            );
          })}
        </div>
      )}

      <div className="vac-footer">
        <span className="vac-footer-meta">
          <FaUsers /> {applicantCount} applied{posted ? ` · posted ${posted}` : ""}
        </span>
        {!preview && (
          <div className="vac-actions" onClick={(event) => event.stopPropagation()}>
            <button className="btn-vac btn-vac--outline" onClick={onOpen}>
              View details
            </button>
            {applied ? (
              <button className="btn-vac btn-vac--primary" disabled title="You have already applied to this job">
                Applied
              </button>
            ) : (
              <button className="btn-vac btn-vac--primary" onClick={onApply}>
                Apply now
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
