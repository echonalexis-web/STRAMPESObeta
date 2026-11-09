import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Clock, Download, FileText, Sparkles } from "lucide-react";
import { spesAPI } from "../services/api";
import SecureFileLink from "../components/SecureFileLink";
import StateBlock from "../components/StateBlock";
import SpesDocChecklist from "../components/SpesDocChecklist";
import { useConfirm, useToast } from "../components/feedback/context";
import { translateErrorCode } from "../utils/apiErrors";
import { uploadErrorCode } from "../utils/spesUploadLimits";
import {
  SPES_STAGE_KEYS,
  canEditDocs,
  canWithdrawStatus,
  isOsyApplication,
  normalizeSpesStatus,
  requiredSlotsFor,
  spesStageIndex,
} from "../utils/spesSlots";
import "../styles/spes.css";

const TERMINAL = ["withdrawn", "disqualified"];

// A status the applicant should treat as "your move" gets the attention tone.
const needsAttention = (status) => status === "needs_resubmission";

function SpesStepper({ status, t }) {
  const activeIndex = spesStageIndex(status);
  return (
    <ol className="spes-stepper" aria-label={t("spes.tracker.label")}>
      {SPES_STAGE_KEYS.map((key, i) => {
        const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "upcoming";
        return (
          <li
            key={key}
            className={`spes-stepper__item spes-stepper__item--${state}`}
            aria-current={state === "active" ? "step" : undefined}
          >
            <span className="spes-stepper__dot">
              {state === "done" ? <CheckCircle2 size={16} aria-hidden="true" /> : state === "active" ? <Clock size={16} aria-hidden="true" /> : i + 1}
            </span>
            <span className="spes-stepper__label">{t(`spes.stage.${key}`)}</span>
          </li>
        );
      })}
    </ol>
  );
}

// Plain list of the files an application holds, with no per-slot to-do state.
function SpesFileList({ documents }) {
  const { t } = useTranslation();
  const files = Array.isArray(documents) ? documents : [];
  if (files.length === 0) return <p className="spes-note">{t("spes.docs.noneSubmitted")}</p>;
  return (
    <ul className="spes-doc-list">
      {files.map((doc, i) => (
        <li key={doc._id || i}>
          <span className="spes-doc-list__label">
            {doc.slot ? t(`spes.docs.slot.${doc.slot}`) : doc.label || t("spes.docs.otherItem", { n: i + 1 })}
          </span>
          <SecureFileLink className="spes-doc-list__link" value={doc.fileUrl}>
            <Download size={12} aria-hidden="true" /> {t("spes.docs.view")}
          </SecureFileLink>
        </li>
      ))}
    </ul>
  );
}

export default function MySpesApplications() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const formatDate = (value) => {
    if (!value) return "";
    const d = new Date(value);
    return Number.isNaN(d.getTime())
      ? ""
      : d.toLocaleDateString(i18n.language?.startsWith("fil") ? "fil-PH" : "en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await spesAPI.getMine();
        if (active) setItems(Array.isArray(data?.items) ? data.items : []);
      } catch (err) {
        if (active) setError(translateErrorCode(err?.response?.data?.code, t("applications.spesErrorBody")));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Responses for a single application do not populate the posting, so keep ours.
  const mergeApplication = (current, next) => ({ ...current, ...next, posting: current.posting });
  const replaceItem = (id, next) =>
    setItems((prev) => prev.map((it) => (it._id === id ? mergeApplication(it, next) : it)));

  const handleUpload = (app) => async (slot, file, config = {}) => {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await spesAPI.replaceDocument(app.posting?._id, slot, fd, config);
      replaceItem(app._id, data.application);
      toast.success(t("spes.docs.uploaded"));
      return null;
    } catch (err) {
      return uploadErrorCode(err);
    }
  };

  const handleWithdraw = async (app) => {
    const ok = await confirm({
      title: t("spes.withdraw.title"),
      message: t("spes.withdraw.body"),
      confirmLabel: t("spes.withdraw.confirm"),
      tone: "danger",
    });
    if (!ok) return;
    try {
      const { data } = await spesAPI.withdraw(app.posting?._id);
      replaceItem(app._id, data.application);
      toast.success(t("spes.withdraw.done"));
    } catch (err) {
      toast.error(translateErrorCode(err?.response?.data?.code, t("spes.withdraw.failed")));
    }
  };

  const mostRecent = items[0] || null;

  return (
    <main className="spes-page">
      <div className="spes-page__banner">
        <div>
          <h1>{t("spes.my.title")}</h1>
          <p className="spes-note">{t("spes.my.subtitle")}</p>
        </div>
        <div className="spes-summary-strip">
          <div className="spes-summary-stat">
            <strong>{items.length}</strong>
            <span>{t("spes.my.count", { count: items.length })}</span>
          </div>
          {mostRecent ? (
            <div className="spes-summary-stat spes-summary-stat--program">
              <span className="spes-summary-stat__label">{t("spes.my.mostRecent")}</span>
              <strong>{mostRecent.posting?.title || t("spes.my.programFallback")}</strong>
              <span className={`spes-chip spes-chip--${normalizeSpesStatus(mostRecent.status)}`}>
                {t(`spes.status.${normalizeSpesStatus(mostRecent.status)}`)}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {loading ? <StateBlock kind="loading" title={t("applications.spesLoading")} /> : null}
      {!loading && error ? (
        <StateBlock kind="error" title={t("applications.spesErrorTitle")} description={error} />
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <StateBlock
          kind="empty"
          title={t("applications.spesEmptyTitle")}
          description={t("applications.spesEmptyBody")}
          action={
            <Link to="/news" className="ds-btn ds-btn--primary">
              {t("applications.spesEmptyAction")}
            </Link>
          }
        />
      ) : null}

      {items.map((app) => {
        const status = normalizeSpesStatus(app.status);
        const released = status === "results_released" && app.result;
        const title = app.posting?.title || t("spes.my.programFallback");
        const slots = requiredSlotsFor(app.posting, isOsyApplication(app) ? "osy" : "student");
        const terminal = TERMINAL.includes(status);
        const disqualified = status === "disqualified";
        const nextKey = needsAttention(status) ? "needs_resubmission" : status;
        // The to-do checklist only makes sense while documents can still change.
        // Otherwise (closed, or filed before document types existed) just list the files.
        const hasTypedDocs = (app.documents || []).some((d) => d.slot);
        const showChecklist = !terminal && (canEditDocs(status) || hasTypedDocs);

        return (
          <article key={app._id} className="spes-card">
            <div className="spes-card__head">
              <div>
                <h2>{title}</h2>
                <p className="spes-card__meta">{t("spes.my.applied", { date: formatDate(app.createdAt) })}</p>
              </div>
              <span className={`spes-chip spes-chip--${status}`}>{t(`spes.status.${status}`)}</span>
            </div>

            {terminal ? (
              <div className={`spes-terminal spes-terminal--${status}`} role="status">
                {disqualified ? (
                  <>
                    <p className="spes-terminal__title">{t("spes.disqualified.title")}</p>
                    <p className="spes-terminal__reason">
                      <strong>{t("spes.disqualified.reasonLabel")}</strong>{" "}
                      {app.disqualification?.reason || t("spes.disqualified.noReason")}
                    </p>
                    <p className="spes-terminal__help">{t("spes.disqualified.help")}</p>
                  </>
                ) : (
                  <p className="spes-terminal__title">{t("spes.withdrawn.body")}</p>
                )}
              </div>
            ) : (
              <SpesStepper status={status} t={t} />
            )}

            {/* A closed application has nothing left to do: list the files that were
                submitted instead of a to-do checklist, and drop the Next step panel
                (the banner above already says what happened). Applications from before
                document types existed also just list their files. */}
            <div className={`spes-card__grid${showChecklist || !terminal ? "" : " spes-card__grid--single"}`}>
              <div className="spes-card__panel">
                <h3>
                  <FileText size={15} aria-hidden="true" />{" "}
                  {showChecklist ? t("spes.docs.title") : t("spes.docs.submittedTitle")}
                </h3>
                {showChecklist ? (
                  <SpesDocChecklist
                    slots={slots}
                    documents={app.documents}
                    canEdit={canEditDocs(status)}
                    onUpload={handleUpload(app)}
                  />
                ) : (
                  <SpesFileList documents={app.documents} />
                )}
              </div>

              {terminal ? null : (
              <div className="spes-card__panel spes-card__panel--highlight">
                <h3>
                  <Sparkles size={15} aria-hidden="true" /> {t("spes.nextStep.title")}
                </h3>
                <p>{t(`spes.nextStep.${nextKey}`, { defaultValue: t("spes.nextStep.default") })}</p>
                {needsAttention(status) && app.needsResubmission?.reason ? (
                  <p className="spes-slot__reason">
                    {t("spes.docs.reasonLabel")} {app.needsResubmission.reason}
                  </p>
                ) : null}

                {released ? (
                  <div className={`spes-result spes-result--${app.result.outcome}`}>
                    <strong>{t(`spes.outcome.${app.result.outcome}`)}</strong>
                    {app.result.rank ? <p>{t("spes.outcome.rank", { rank: app.result.rank })}</p> : null}
                    {app.result.remarks ? <p>{app.result.remarks}</p> : null}
                    {app.posting?.results?.summary ? <p>{app.posting.results.summary}</p> : null}
                    {app.posting?.results?.url ? (
                      <p>
                        <a href={app.posting.results.url} target="_blank" rel="noreferrer">
                          {t("spes.outcome.officialResults")}
                        </a>
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {canWithdrawStatus(status) ? (
                  <button type="button" className="spes-btn spes-btn--ghost spes-btn--small" onClick={() => handleWithdraw(app)}>
                    {t("spes.withdraw.button")}
                  </button>
                ) : null}
              </div>
              )}
            </div>
          </article>
        );
      })}
    </main>
  );
}
