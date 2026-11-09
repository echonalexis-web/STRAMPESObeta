import { useTranslation } from "react-i18next";
import { Ban, Download, FileText, Sparkles, UserMinus } from "lucide-react";
import SecureFileLink from "../SecureFileLink";
import SpesDocChecklist from "../SpesDocChecklist";
import { StepperProgress } from "./StepperProgress";
import { canEditDocs, canWithdrawStatus, isOsyApplication, requiredSlotsFor } from "../../utils/spesSlots";

const TERMINAL = ["withdrawn", "disqualified"];

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

// What an expanded application shows: the tracker, then documents and next step side by side.
// A withdrawn or disqualified application gets one compact notice instead, with its files
// tucked into a "Submitted files" disclosure.
export default function ApplicationDetails({ app, status, onUpload, onWithdraw }) {
  const { t } = useTranslation();
  const released = status === "results_released" && app.result;
  const terminal = TERMINAL.includes(status);
  const disqualified = status === "disqualified";
  const needsAction = status === "needs_resubmission";
  const slots = requiredSlotsFor(app.posting, isOsyApplication(app) ? "osy" : "student");
  const hasTypedDocs = (app.documents || []).some((d) => d.slot);
  // The to-do checklist only makes sense while documents can still change.
  const showChecklist = !terminal && (canEditDocs(status) || hasTypedDocs);
  const nextKey = needsAction ? "needs_resubmission" : status;

  if (terminal) {
    const Icon = disqualified ? Ban : UserMinus;
    return (
      <div className="spes-details">
        <div className={`spes-notice-card spes-notice-card--${status}`} role="status">
          <Icon size={20} aria-hidden="true" className="spes-notice-card__icon" />
          <div className="spes-notice-card__body">
            {disqualified ? (
              <>
                <p className="spes-notice-card__title">{t("spes.disqualified.title")}</p>
                <p>
                  <strong>{t("spes.disqualified.reasonLabel")}</strong>{" "}
                  {app.disqualification?.reason || t("spes.disqualified.noReason")}
                </p>
                <p className="spes-notice-card__help">{t("spes.disqualified.help")}</p>
              </>
            ) : (
              <p className="spes-notice-card__title">{t("spes.withdrawn.body")}</p>
            )}
          </div>
        </div>

        {(app.documents || []).length > 0 ? (
          <details className="spes-files">
            <summary>
              <FileText size={16} aria-hidden="true" /> {t("spes.my.submittedFiles")}
            </summary>
            <div className="spes-files__body">
              {hasTypedDocs ? (
                <SpesDocChecklist slots={slots} documents={app.documents} canEdit={false} onUpload={onUpload} />
              ) : (
                <SpesFileList documents={app.documents} />
              )}
            </div>
          </details>
        ) : null}
      </div>
    );
  }

  return (
    <div className="spes-details">
      <StepperProgress status={status} />

      <div className="spes-details__grid">
        <section className="spes-panel-lite" aria-labelledby={`docs-${app._id}`}>
          <h3 id={`docs-${app._id}`}>
            <FileText size={16} aria-hidden="true" /> {showChecklist ? t("spes.docs.title") : t("spes.docs.submittedTitle")}
          </h3>
          {showChecklist ? (
            <SpesDocChecklist slots={slots} documents={app.documents} canEdit={canEditDocs(status)} onUpload={onUpload} />
          ) : (
            <SpesFileList documents={app.documents} />
          )}
        </section>

        <section className="spes-panel-lite spes-panel-lite--next" aria-labelledby={`next-${app._id}`}>
          <h3 id={`next-${app._id}`}>
            <Sparkles size={16} aria-hidden="true" /> {t("spes.nextStep.title")}
          </h3>
          <p>{t(`spes.nextStep.${nextKey}`, { defaultValue: t("spes.nextStep.default") })}</p>
          {needsAction && app.needsResubmission?.reason ? (
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
            <button type="button" className="spes-withdraw" onClick={() => onWithdraw(app)}>
              {t("spes.withdraw.button")}
            </button>
          ) : null}
        </section>
      </div>
    </div>
  );
}
