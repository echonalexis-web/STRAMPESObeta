import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Archive, ChevronDown, MapPin } from "lucide-react";
import Avatar from "./Avatar";
import { candidateLink, canExpand, durationParts, percentOf, showFunnelBars, statusKey, statusTone } from "../utils/archivedJobs";

// One archived posting. Everything shown comes from the server (status, close reason,
// funnel, duration, hired people); nothing here decides a rule.
//   - a posting nobody applied to is a compact, muted, non-expandable row
//   - any other is a row with a "View report" button that opens the report below it

const FUNNEL = ["applicants", "qualified", "shortlisted", "hired"];

function useDateFormat() {
  const { i18n } = useTranslation();
  return (value) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString(i18n.language === "fil" ? "fil-PH" : "en-US", { month: "short", day: "numeric", year: "numeric" });
  };
}

function Duration({ days }) {
  const { t } = useTranslation();
  const parts = durationParts(days);
  if (!parts) return null;
  return <>{parts.key === "lessThanDay" ? t("employerDashboard.archived.lessThanDay") : t("employerDashboard.archived.daysOpen", { count: parts.count })}</>;
}

function StatusChip({ status }) {
  const { t } = useTranslation();
  return <span className={`ed-arch-chip ed-arch-chip--${statusTone(status)}`}>{t(`employerDashboard.archived.status.${statusKey(status)}`)}</span>;
}

function Facts({ item }) {
  const { t } = useTranslation();
  const fmt = useDateFormat();
  return (
    <>
      <span className="ed-arch-fact">
        {fmt(item.postedAt)} <span aria-hidden="true">→</span> {fmt(item.closedAt)}
        {durationParts(item.durationDays) ? (
          <>
            {" · "}
            <Duration days={item.durationDays} />
          </>
        ) : null}
      </span>
      {item.vacancies > 0 && canExpand(item) ? (
        <span className="ed-arch-fact">{t("employerDashboard.archived.filledOf", { filled: item.filled, vacancies: item.vacancies })}</span>
      ) : null}
    </>
  );
}

function Report({ item, id, onViewApplicants }) {
  const { t } = useTranslation();
  const fmt = useDateFormat();
  const total = item.funnel.applicants;
  const bars = showFunnelBars(item.funnel);
  return (
    <div id={id} className="ed-arch-report">
      <section className="ed-arch-report__block" aria-labelledby={`${id}-outcome`}>
        <h4 id={`${id}-outcome`}>{t("employerDashboard.archived.outcome")}</h4>
        <dl className="ed-arch-dl">
          <div>
            <dt>{t("employerDashboard.archived.closeReason")}</dt>
            <dd>{t(`employerDashboard.archived.reason.${item.closeReason || "unknown"}`)}</dd>
          </div>
          <div>
            <dt>{t("employerDashboard.archived.closedOnLabel")}</dt>
            <dd>{fmt(item.closedAt)}</dd>
          </div>
          <div>
            <dt>{t("employerDashboard.archived.closedByLabel")}</dt>
            <dd>{item.closedBy ? t(`employerDashboard.archived.closedBy.${item.closedBy}`) : "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="ed-arch-report__block" aria-labelledby={`${id}-funnel`}>
        <h4 id={`${id}-funnel`}>{t("employerDashboard.archived.funnelTitle")}</h4>
        <ul className="ed-arch-funnel">
          {FUNNEL.map((key) => {
            const count = item.funnel[key];
            const pct = key === "applicants" ? null : percentOf(count, total);
            return (
              <li key={key}>
                <span className="ed-arch-funnel__label">{t(`employerDashboard.archived.funnel.${key}`)}</span>
                <strong className="ed-arch-funnel__value">{count}</strong>
                {pct !== null ? <span className="ed-arch-funnel__pct">{t("employerDashboard.archived.funnelPct", { count, total, pct })}</span> : null}
                {bars && pct !== null ? (
                  <span className="ed-arch-funnel__bar" aria-hidden="true">
                    <span style={{ width: `${pct}%` }} />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="ed-arch-report__block" aria-labelledby={`${id}-hired`}>
        <h4 id={`${id}-hired`}>{t("employerDashboard.archived.hiredCandidates")}</h4>
        {item.hiredCandidates.length === 0 ? (
          <p className="ed-arch-muted">{t("employerDashboard.archived.noneHired")}</p>
        ) : (
          <ul className="ed-arch-hired">
            {item.hiredCandidates.map((person) => {
              const to = candidateLink(person);
              const name = person.former ? t("employerDashboard.archived.formerUser") : person.name || t("employerDashboard.archived.formerUser");
              const inner = (
                <>
                  <span className="ed-arch-hired__avatar">
                    <Avatar size={36} name={name} photo={person.avatar} />
                  </span>
                  <span className="ed-arch-hired__name">{name}</span>
                </>
              );
              return <li key={person.id}>{to ? <Link to={to} className="ed-arch-hired__link">{inner}</Link> : <span className="ed-arch-hired__link is-static">{inner}</span>}</li>;
            })}
          </ul>
        )}
      </section>

      <section className="ed-arch-report__block" aria-labelledby={`${id}-timeline`}>
        <h4 id={`${id}-timeline`}>{t("employerDashboard.archived.timelineTitle")}</h4>
        <ol className="ed-arch-timeline">
          <li><span>{t("employerDashboard.archived.timeline.posted")}</span><strong>{fmt(item.postedAt)}</strong></li>
          <li><span>{t("employerDashboard.archived.timeline.firstApplicant")}</span><strong>{fmt(item.firstApplicantAt)}</strong></li>
          <li><span>{t("employerDashboard.archived.timeline.closed")}</span><strong>{fmt(item.closedAt)}</strong></li>
        </ol>
      </section>

      {onViewApplicants ? (
        <div className="ed-arch-report__actions">
          <button type="button" className="ds-btn ds-btn--secondary" onClick={() => onViewApplicants(item._id)}>
            {t("employerDashboard.archived.viewApplicants")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function ArchivedJobRow({ item, onViewApplicants }) {
  const { t } = useTranslation();
  const fmt = useDateFormat();
  const [open, setOpen] = useState(false);
  const reportId = useId();
  const expandable = canExpand(item);

  if (!expandable) {
    return (
      <li className="ed-arch-item ed-arch-item--quiet">
        <div className="ed-arch-row">
          <span className="ed-arch-tile" aria-hidden="true"><Archive size={16} /></span>
          <div className="ed-arch-main">
            <span className="ed-arch-title">{item.title}</span>
            <span className="ed-arch-sub">
              <MapPin size={13} aria-hidden="true" /> {item.location}
              <span aria-hidden="true"> · </span>
              {t("employerDashboard.archived.closedOn", { date: fmt(item.closedAt) })}
              {durationParts(item.durationDays) ? (
                <>
                  <span aria-hidden="true"> · </span>
                  <Duration days={item.durationDays} />
                </>
              ) : null}
            </span>
          </div>
          <StatusChip status={item.status} />
          <span className="ed-arch-none">{t("employerDashboard.archived.noApplicants")}</span>
        </div>
      </li>
    );
  }

  return (
    <li className={`ed-arch-item ${open ? "is-open" : ""}`}>
      <div className="ed-arch-row">
        <span className="ed-arch-tile" aria-hidden="true"><Archive size={18} /></span>
        <div className="ed-arch-main">
          <span className="ed-arch-title">{item.title}</span>
          <span className="ed-arch-sub">
            <MapPin size={13} aria-hidden="true" /> {item.location}
          </span>
          <span className="ed-arch-facts">
            <Facts item={item} />
          </span>
          <span className="ed-arch-funnel-line">
            {FUNNEL.map((key, i) => (
              <span key={key}>
                {i > 0 ? <span aria-hidden="true"> · </span> : null}
                {t(`employerDashboard.archived.funnel.${key}`)} <strong>{item.funnel[key]}</strong>
              </span>
            ))}
          </span>
        </div>
        <StatusChip status={item.status} />
        <button
          type="button"
          className="ed-arch-toggle"
          aria-expanded={open}
          aria-controls={reportId}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? t("employerDashboard.archived.hideReport") : t("employerDashboard.archived.viewReport")}
          <ChevronDown size={16} className={`ed-arch__chev ${open ? "is-open" : ""}`} aria-hidden="true" />
        </button>
      </div>
      {open ? <Report item={item} id={reportId} onViewApplicants={onViewApplicants} /> : null}
    </li>
  );
}
