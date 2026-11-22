import { useId } from "react";
import { useTranslation } from "react-i18next";
import JobFavoriteButton from "./JobFavoriteButton";
import EmployerAvatar from "./EmployerAvatar";
import ProfileLink from "./ProfileLink";
import { FaUsers, FaStar, FaHeart, FaCheck, FaTimes, FaChevronDown } from "react-icons/fa";
import { tierForPercent } from "../utils/qualifications";
import { compactCardModel, clampPercent } from "../utils/vacancyCompact";
import useMediaQuery from "../hooks/useMediaQuery";
import "../styles/vacancy-card.css";

// Phones: the compact layout is used below this width, and only when the
// page opts in with `compact` (Browse Jobs). 600px and up keep the full card.
const PHONE_QUERY = "(max-width: 599px)";

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
 *   canApply       false hides Apply (15-17 accounts: regular jobs are view-only)
 *   publicView     a posting listed on a company page: no match panel, no
 *                  requirement pills, no applicant count and no Apply button;
 *                  applying stays on the job detail page with its own rules
 *   compact        opt in to the phone-width compact card (under 600px);
 *                  wider screens and preview/publicView render the full card
 *   expanded       compact card: the match and apply area is open
 *   onToggle       compact card: open or close that area (the page keeps one open)
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
  canApply = true,
  publicView = false,
  // Signed-out visitor: no applicant count, no company page link, and "Log in to apply"
  // in place of Apply (onLogin sends them to login and back to this job).
  visitor = false,
  onLogin,
  compact = false,
  expanded = false,
  onToggle,
}) {
  const { t } = useTranslation();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const panelId = useId();
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
  // Company logo and name: hover card on pointer devices, link to the company page.
  // Clicks and keys stay off the card's own "open job" handlers.
  const employerId = !preview && !visitor ? job?.employer?._id || job?.employer?.id || null : null;
  const companyName = job?.employer?.companyName || job?.employer?.name || "Employer";
  const stop = (event) => event.stopPropagation();

  // First three Required qualifications, each flagged met/missing against
  // checklist.missingRequired (same type+value, folded "other"→skill) —
  // matches the server's own required/preferred split, not a re-score.
  const missingKeys = new Set((checklist?.missingRequired || []).map((q) => matchKey(q.type, q.value)));
  const requiredPreviewQuals = Array.isArray(job?.qualifications)
    ? job.qualifications.filter((q) => q?.value && q.optional !== true).slice(0, 3)
    : [];

  // Phone-width compact card (Browse Jobs only). Same data and the same
  // server-computed match values as the full card below; only the layout differs.
  if (compact && isPhone && !preview && !publicView) {
    const model = compactCardModel({ checklist, matchAvailable, tier, applied, canApply });
    const title = job?.title || "Job title";
    const bar = clampPercent(percent);
    const pillWord = model.hasChecklist ? checklist.tier : t("vacancy.compact.estimated");
    const summary = model.hasChecklist
      ? (model.total > 0
          ? t("vacancy.compact.matchSummary", { tier: checklist.tier, met: model.met, total: model.total })
          : t("vacancy.compact.matchSummaryNoCount", { tier: checklist.tier }))
      : t("vacancy.compact.estimatedFit");
    const toggleText = model.toggleKind === "mustHaves"
      ? t("vacancy.compact.mustHavesOf", { met: model.met, total: model.total })
      : model.toggleKind === "noMustHaves"
        ? t("vacancy.compact.noMustHaves")
        : t("vacancy.compact.moreDetails");

    return (
      <article
        className={`vac-card vac-card--compact ${preferred ? "is-preferred" : ""} ${followed ? "is-followed" : ""} ${expanded ? "is-expanded" : ""}`}
        role={clickable ? "link" : undefined}
        tabIndex={clickable ? 0 : undefined}
        aria-label={clickable ? title : undefined}
        onClick={clickable ? onOpen : undefined}
        onKeyDown={clickable ? (event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        } : undefined}
      >
        <div className="vac-c-top">
          {employerId ? (
            <span className="vac-profile-link" onClick={stop} onKeyDown={stop}>
              <ProfileLink userId={employerId} role="employer" decorative>
                <EmployerAvatar employer={job?.employer} className="vac-logo" />
              </ProfileLink>
            </span>
          ) : (
            <EmployerAvatar employer={job?.employer} className="vac-logo" />
          )}
          <div className="vac-c-text">
            <h3 className="vac-c-title">{title}</h3>
            <p className="vac-c-sub">
              {posted ? t("vacancy.compact.companyPosted", { company: companyName, posted }) : companyName}
            </p>
          </div>
          {model.showMatch && (
            <span className={`vac-c-pill tier-${tier}`}>
              {percent}% {pillWord}
            </span>
          )}
          <div className="vac-tools" onClick={stop}>
            <JobFavoriteButton jobId={job?._id} hideCount variant="heart" />
          </div>
        </div>

        <p className="vac-c-facts">{facts}</p>

        {model.blocked && (
          <div className="vac-c-flags">
            {model.blocked === "applied" ? (
              <span className="ds-badge vac-pill vac-pill--applied"><FaCheck aria-hidden="true" /> {t("vacancy.compact.applied")}</span>
            ) : (
              <span className="ds-badge vac-pill vac-pill--view-only">{t("vacancy.compact.viewOnlyShort")}</span>
            )}
          </div>
        )}

        <div className="vac-c-row3" onClick={stop}>
          <button
            type="button"
            className="vac-c-toggle"
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={`${expanded ? t("vacancy.compact.collapse", { title }) : t("vacancy.compact.expand", { title })}. ${toggleText}`}
            onClick={onToggle}
          >
            <span className="vac-c-toggle-text">{toggleText}</span>
            {model.showMatch && (
              <span className="vac-c-bar" aria-hidden="true">
                <span className={`vac-c-bar-fill tier-${tier}`} style={{ width: `${bar}%` }} />
              </span>
            )}
            <FaChevronDown className="vac-c-chev" aria-hidden="true" />
          </button>
          <button type="button" className="vac-c-details" onClick={onOpen} aria-label={t("vacancy.compact.viewDetailsFor", { title })}>
            {t("vacancy.compact.viewDetails")}
          </button>
        </div>

        <div id={panelId} className="vac-c-panel" hidden={!expanded} onClick={stop}>
          <p className="vac-c-summary">{model.showMatch ? summary : t("vacancy.compact.moreDetails")}</p>
          {model.missing.length > 0 && (
            <p className="vac-match-missing">
              {t("vacancy.compact.missing", { list: model.missing.map((q) => q.value).join(", ") })}
            </p>
          )}
          {requiredPreviewQuals.length > 0 && (
            <div className="vac-req-pills">
              {requiredPreviewQuals.map((q) => {
                const met = matchAvailable && !missingKeys.has(matchKey(q.type, q.value));
                return (
                  <span key={`${q.type}-${q.value}`} className={`vac-req-pill ${met ? "is-met" : "is-missing"}`}>
                    {met ? <FaCheck aria-hidden="true" /> : <FaTimes aria-hidden="true" />} <span className="ds-sr-only">{met ? "Met: " : "Missing: "}</span>{q.value}
                  </span>
                );
              })}
            </div>
          )}
          <div className="vac-meta">
            <span className="ds-badge vac-pill vac-pill--open">Open</span>
            {applied && <span className="ds-badge vac-pill vac-pill--applied"><FaCheck aria-hidden="true" /> {t("vacancy.compact.applied")}</span>}
            {followed && (
              <span className="ds-badge vac-pill vac-pill--follow">
                <FaHeart aria-hidden="true" /> Following
              </span>
            )}
            {preferred && (
              <span className="ds-badge vac-pill vac-pill--preferred">
                <FaStar aria-hidden="true" /> Preferred
              </span>
            )}
          </div>
          <p className="vac-c-counts">
            {visitor ? (
              posted ? t("vacancy.compact.postedAgo", { posted }) : null
            ) : (
              <>
                <FaUsers aria-hidden="true" /> {t("vacancy.compact.applicants", { count: applicantCount })}
                {posted ? ` · ${t("vacancy.compact.postedAgo", { posted })}` : ""}
              </>
            )}
          </p>
          {model.blocked === "age" && <p className="vac-c-note">{t("vacancy.compact.viewOnlyAge")}</p>}
          {model.blocked === "applied" ? (
            <button type="button" className="ds-btn ds-btn--primary btn-vac btn-vac--primary vac-c-apply" disabled>
              {t("vacancy.compact.applied")}
            </button>
          ) : visitor ? (
            <button type="button" className="ds-btn ds-btn--primary btn-vac btn-vac--primary vac-c-apply" onClick={onLogin}>
              {t("publicJobs.loginToApply")}
            </button>
          ) : canApply ? (
            <button type="button" className="ds-btn ds-btn--primary btn-vac btn-vac--primary vac-c-apply" onClick={onApply}>
              Apply now
            </button>
          ) : null}
        </div>
      </article>
    );
  }

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
          {employerId ? (
            <span className="vac-profile-link" onClick={stop} onKeyDown={stop}>
              <ProfileLink userId={employerId} role="employer" decorative>
                <EmployerAvatar employer={job?.employer} className="vac-logo" />
              </ProfileLink>
            </span>
          ) : (
            <EmployerAvatar employer={job?.employer} className="vac-logo" />
          )}
          <div className="vac-brand-text">
            {employerId ? (
              <span className="vac-profile-link vac-profile-link--text" onClick={stop} onKeyDown={stop}>
                <ProfileLink userId={employerId} role="employer" className="vac-company vac-company--link">
                  {companyName}
                </ProfileLink>
              </span>
            ) : (
              <span className="vac-company">{companyName}</span>
            )}
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
        <span className="ds-badge vac-pill vac-pill--open">Open</span>
        {applied && <span className="ds-badge vac-pill vac-pill--applied"><FaCheck aria-hidden="true" /> Applied</span>}
        {followed && (
          <span className="ds-badge vac-pill vac-pill--follow" title="From an employer you follow">
            <FaHeart aria-hidden="true" /> Following
          </span>
        )}
        {preferred && (
          <span className="ds-badge vac-pill vac-pill--preferred" title="Matches your preferred industry">
            <FaStar aria-hidden="true" /> Preferred
          </span>
        )}
      </div>

      {!preview && !publicView && tier !== "na" && (
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

      {!preview && !publicView && requiredPreviewQuals.length > 0 && (
        <div className="vac-req-pills">
          {requiredPreviewQuals.map((q) => {
            const met = matchAvailable && !missingKeys.has(matchKey(q.type, q.value));
            return (
              <span key={`${q.type}-${q.value}`} className={`vac-req-pill ${met ? "is-met" : "is-missing"}`}>
                {met ? <FaCheck aria-hidden="true" /> : <FaTimes aria-hidden="true" />} <span className="ds-sr-only">{met ? "Met: " : "Missing: "}</span>{q.value}
              </span>
            );
          })}
        </div>
      )}

      <div className="vac-footer">
        <span className="vac-footer-meta">
          {publicView || visitor ? (posted ? `Posted ${posted}` : null) : (<><FaUsers aria-hidden="true" /> {applicantCount} applied{posted ? ` · posted ${posted}` : ""}</>)}
        </span>
        {!preview && (
          <div className="vac-actions" onClick={(event) => event.stopPropagation()}>
            <button className="ds-btn ds-btn--secondary btn-vac btn-vac--outline" onClick={onOpen}>
              View details
            </button>
            {publicView ? null : visitor ? (
              <button className="ds-btn ds-btn--primary btn-vac btn-vac--primary" onClick={onLogin}>
                {t("publicJobs.loginToApply")}
              </button>
            ) : applied ? (
              <button className="ds-btn ds-btn--primary btn-vac btn-vac--primary" disabled title="You have already applied to this job">
                Applied
              </button>
            ) : canApply ? (
              <button className="ds-btn ds-btn--primary btn-vac btn-vac--primary" onClick={onApply}>
                Apply now
              </button>
            ) : null}
          </div>
        )}
      </div>
    </article>
  );
}
