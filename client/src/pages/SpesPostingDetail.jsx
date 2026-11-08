import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaArrowLeft, FaCalendarAlt, FaUsers, FaClipboardCheck, FaExternalLinkAlt } from "react-icons/fa";
import { resolveAssetUrl, spesAPI } from "../services/api";
import SpesApplyFlow from "../components/SpesApplyFlow";
import { translateErrorCode } from "../utils/apiErrors";
import { formatSpesDate, postingDocumentSlots } from "../utils/spesPostings";
import { normalizeSpesStatus, requiredSlotsFor } from "../utils/spesSlots";
import "../styles/news-feed.css";
import "../styles/spes.css";

// Blockers other than these are explained with the server's own translated message.
const HANDLED_BLOCKERS = ["NSRP_INCOMPLETE", "SPES_ALREADY_APPLIED", "SPES_AGE_ABOVE_MAX"];

// One SPES posting, laid out like a news article (hero, article body, side panel): what it
// is, who can apply, the documents it needs, and the action the signed-in user can take.
// 15-17 apply here; 31 and older see a notice where Apply would be.
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

  const back = (plain) => (
    <button type="button" className={plain ? "news-article-back--plain" : "news-article-back"} onClick={() => navigate("/spes/postings")}>
      <FaArrowLeft /> {t("spesPostings.backToList")}
    </button>
  );

  if (loading) {
    return (
      <main className="news-article-page" data-category="spes" aria-label={t("spesPostings.title")}>
        <div className="news-article-col">
          {back(true)}
          <div className="news-skeleton" role="status" aria-live="polite">
            <span className="ds-sr-only">{t("spesPostings.loading")}</span>
            <div aria-hidden="true">
              <span className="ds-skeleton news-sk-media news-sk-media--hero" />
              <span className="ds-skeleton news-sk-line news-sk-line--badge" />
              <span className="ds-skeleton news-sk-line news-sk-line--title" />
              <span className="ds-skeleton news-sk-line" />
              <span className="ds-skeleton news-sk-line news-sk-line--short" />
            </div>
          </div>
        </div>
      </main>
    );
  }
  if (notFound || error || !data) {
    return (
      <main className="news-article-page" data-category="spes" aria-label={t("spesPostings.title")}>
        <div className="news-article-col">
          {back(true)}
          <div className="ds-empty news-empty news-state-error" role="alert">
            <h2 className="ds-empty__title">{notFound ? t("spesPostings.notFoundTitle") : t("spesPostings.errorTitle")}</h2>
            <p>{notFound ? t("spesPostings.notFoundBody") : error}</p>
            {!notFound ? (
              <button type="button" className="ds-btn ds-btn--primary" onClick={load}>
                {t("spes.admin.retry")}
              </button>
            ) : null}
          </div>
        </div>
      </main>
    );
  }

  const { posting, eligibility, application } = data;
  const status = posting.displayStatus;
  const slots = postingDocumentSlots(requiredSlotsFor(posting, "student"), requiredSlotsFor(posting, "osy"));
  const otherBlockers = (eligibility?.blockers || []).filter((code) => !HANDLED_BLOCKERS.includes(code));
  const ageMin = eligibility?.ageRange?.min ?? 15;
  const ageMax = eligibility?.ageRange?.max ?? 30;

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
          {t("spesPostings.readOnlyNotice", { min: ageMin, max: ageMax })}
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
    <main className="news-article-page" data-category="spes" aria-label={t("spesPostings.title")}>
      <article>
        <header className={`news-hero${posting.coverImage ? "" : " news-hero--placeholder"}`}>
          <button type="button" className="news-article-back" onClick={() => navigate("/spes/postings")}>
            <FaArrowLeft /> {t("spesPostings.backToList")}
          </button>
          {posting.coverImage ? <img src={resolveAssetUrl(posting.coverImage)} alt="" /> : null}
          <div className="news-hero__caption">
            <span className="news-badge news-badge--onHero">{t(`spesPostings.status.${status}`)}</span>
            <h1>{posting.title}</h1>
          </div>
        </header>

        <div className="news-article-layout">
          <div className="news-article-main">
            <div className="news-article-meta">
              {posting.applicationDeadline ? (
                <span>
                  <FaCalendarAlt aria-hidden="true" />{" "}
                  {t("spes.panel.deadline", { date: formatSpesDate(posting.applicationDeadline, i18n.language) })}
                </span>
              ) : (
                <span>{t("spes.admin.noDeadline")}</span>
              )}
              {posting.slots ? (
                <>
                  <span className="dot" />
                  <span>
                    <FaUsers aria-hidden="true" /> {t("spes.panel.slots", { count: Number(posting.slots) })}
                  </span>
                </>
              ) : null}
            </div>

            {status !== "open" && posting.closedReason ? (
              <p className="spes-note">{t(`spes.admin.closedReason.${posting.closedReason}`)}</p>
            ) : null}

            <div className="news-article-body">
              {String(posting.description || "")
                .split("\n")
                .filter(Boolean)
                .map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
            </div>

            <div className="spes-reqs">
              <h2 className="spes-reqs__label">
                <FaClipboardCheck aria-hidden="true" /> {t("spes.panel.eligibilityTitle")}
              </h2>
              <ul>
                <li>{t("spes.panel.eligAge", { min: ageMin, max: ageMax })}</li>
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
          </div>

          <aside className="news-article-aside">
            <section className="spes-panel" aria-label={t("spes.panel.aria")}>
              <h2 className="spes-panel__title">{t("spes.panel.title")}</h2>
              <p className="spes-note">{t("spes.panel.howItWorks")}</p>
              {renderAction()}
            </section>
          </aside>
        </div>
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
