import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaCalendarAlt, FaUsers, FaClipboardCheck, FaExternalLinkAlt } from "react-icons/fa";
import { spesAPI } from "../services/api";
import StateBlock from "../components/StateBlock";
import SpesApplyFlow from "../components/SpesApplyFlow";
import { translateErrorCode } from "../utils/apiErrors";
import { formatSpesDate, postingDocumentSlots } from "../utils/spesPostings";
import { normalizeSpesStatus, requiredSlotsFor } from "../utils/spesSlots";
import "../styles/spes.css";

// Blockers other than these are explained with the server's own translated message.
const HANDLED_BLOCKERS = ["NSRP_INCOMPLETE", "SPES_ALREADY_APPLIED", "SPES_AGE_ABOVE_MAX"];

// One SPES posting: what it is, who can apply, the documents it needs, and the
// action the signed-in user can take. 15-17 apply here; 31 and older see a notice
// where Apply would be.
export default function SpesPostingDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setNotFound(false);
    try {
      const { data: res } = await spesAPI.getPosting(id);
      setData(res);
    } catch (err) {
      if (err?.response?.status === 404) setNotFound(true);
      else setError(translateErrorCode(err?.response?.data?.code, t("spesPostings.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <main className="spes-page">
        <StateBlock kind="loading" title={t("spesPostings.loading")} />
      </main>
    );
  }
  if (notFound) {
    return (
      <main className="spes-page">
        <StateBlock
          kind="empty"
          title={t("spesPostings.notFoundTitle")}
          description={t("spesPostings.notFoundBody")}
          action={<Link to="/spes/postings" className="spes-btn spes-btn--small">{t("spesPostings.backToList")}</Link>}
        />
      </main>
    );
  }
  if (error || !data) {
    return (
      <main className="spes-page">
        <StateBlock
          kind="error"
          title={t("spesPostings.errorTitle")}
          description={error}
          action={<button type="button" className="spes-btn spes-btn--small" onClick={load}>{t("spes.admin.retry")}</button>}
        />
      </main>
    );
  }

  const { posting, eligibility, application } = data;
  const status = posting.displayStatus;
  const studentSlots = requiredSlotsFor(posting, "student");
  const osySlots = requiredSlotsFor(posting, "osy");
  const slots = postingDocumentSlots(studentSlots, osySlots);
  const otherBlockers = (eligibility?.blockers || []).filter((code) => !HANDLED_BLOCKERS.includes(code));

  const renderAction = () => {
    if (application) {
      const appStatus = normalizeSpesStatus(application.status);
      return (
        <div className="spes-status-box">
          <span className={`spes-chip spes-chip--${appStatus}`}>{t(`spes.status.${appStatus}`)}</span>
          <Link to="/spes/applications" className="spes-btn spes-btn--ghost">
            {t("spesPostings.viewApplication")}
          </Link>
        </div>
      );
    }
    if (eligibility?.readOnly) {
      return (
        <p className="spes-notice spes-notice--info" role="note">
          {t("spesPostings.readOnlyNotice", { min: eligibility.ageRange?.min ?? 15, max: eligibility.ageRange?.max ?? 30 })}
        </p>
      );
    }
    if (otherBlockers.length > 0) {
      return <p className="spes-note">{translateErrorCode(otherBlockers[0], t("spes.panel.notEligible"))}</p>;
    }
    if (eligibility?.blockers?.includes("NSRP_INCOMPLETE")) {
      return (
        <button type="button" className="spes-btn" onClick={() => navigate("/onboarding")}>
          {t("spes.panel.completeNsrp")}
        </button>
      );
    }
    if (eligibility?.canApply) {
      return (
        <button type="button" className="spes-btn" onClick={() => setApplyOpen(true)}>
          {t("spes.panel.apply")}
        </button>
      );
    }
    return null;
  };

  return (
    <main className="spes-page spes-detail">
      <Link to="/spes/postings" className="spes-backlink">
        {t("spesPostings.backToList")}
      </Link>

      <article className="spes-card">
        <div className="spes-card__head">
          <div>
            <h1 className="spes-detail__title">{posting.title}</h1>
            <ul className="spes-meta">
              {posting.applicationDeadline ? (
                <li>
                  <FaCalendarAlt aria-hidden="true" />{" "}
                  {t("spes.panel.deadline", { date: formatSpesDate(posting.applicationDeadline, i18n.language) })}
                </li>
              ) : null}
              {posting.slots ? (
                <li>
                  <FaUsers aria-hidden="true" /> {t("spes.panel.slots", { count: Number(posting.slots) })}
                </li>
              ) : null}
            </ul>
          </div>
          <span className={`spes-chip spes-chip--posting-${status}`}>{t(`spesPostings.status.${status}`)}</span>
        </div>

        {status !== "open" && posting.closedReason ? (
          <p className="spes-note">{t(`spes.admin.closedReason.${posting.closedReason}`)}</p>
        ) : null}

        {posting.description ? <p className="spes-detail__text">{posting.description}</p> : null}

        <div className="spes-reqs">
          <h2 className="spes-reqs__label">
            <FaClipboardCheck aria-hidden="true" /> {t("spes.panel.eligibilityTitle")}
          </h2>
          <ul>
            <li>{t("spes.panel.eligAge", { min: eligibility?.ageRange?.min ?? 15, max: eligibility?.ageRange?.max ?? 30 })}</li>
            <li>{t("spes.panel.eligNsrp")}</li>
            <li>{t("spes.panel.eligStatus")}</li>
          </ul>
        </div>

        <div className="spes-reqs">
          <h2 className="spes-reqs__label">
            <FaClipboardCheck aria-hidden="true" /> {t("spes.panel.documentsTitle")}
          </h2>
          <ul>
            {slots.map((slot) => (
              <li key={slot}>{t(`spes.docs.slot.${slot}`)}</li>
            ))}
            {(posting.requirements || []).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        {posting.results?.status === "released" && posting.results.summary ? (
          <div className="spes-result spes-result--waitlisted">
            <strong>{t("spesPostings.resultsTitle")}</strong>
            <p>{posting.results.summary}</p>
            {posting.results.url ? (
              <p>
                <a href={posting.results.url} target="_blank" rel="noreferrer">
                  {t("spes.outcome.officialResults")} <FaExternalLinkAlt aria-hidden="true" />
                </a>
              </p>
            ) : null}
          </div>
        ) : null}

        <p className="spes-note">{t("spes.panel.howItWorks")}</p>

        {renderAction()}
      </article>

      {applyOpen ? (
        <SpesApplyFlow
          isOpen
          posting={posting}
          guardianRequired={Boolean(eligibility?.guardianRequired)}
          onClose={() => setApplyOpen(false)}
          onApplied={() => {
            setApplyOpen(false);
            navigate("/spes/applications");
          }}
        />
      ) : null}
    </main>
  );
}
