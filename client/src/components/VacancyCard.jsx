import JobFavoriteButton from "./JobFavoriteButton";
import EmployerAvatar from "./EmployerAvatar";
import { FaUsers, FaStar, FaHeart } from "react-icons/fa";
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

const matchTier = (percent) => {
  if (percent >= 60) return "high";
  if (percent >= 30) return "mid";
  return "low";
};

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
  const percent = Math.round((job?.relevanceScore || 0) * 100);
  const tier = matchAvailable ? matchTier(percent) : "na";
  const applicantCount = Number(job?.applicationCount || 0);
  const posted = timeAgo(job?.createdAt);
  const openings = Number(job?.slots || 0);

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

      <div className="vac-metaline">
        <span className="vac-metaline-count">
          <FaUsers /> {applicantCount} applied{posted ? ` · posted ${posted}` : ""}
        </span>
        {!preview && (
          <span className={`vac-match-chip tier-${tier}`} title="How well this job matches your profile">
            {tier === "na" ? "—" : `${percent}%`}<span className="lbl"> match</span>
          </span>
        )}
      </div>

      {!preview && (
        <div className="vac-actions" onClick={(event) => event.stopPropagation()}>
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
    </article>
  );
}
