import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Circle, AlertTriangle, Clock, Download, Upload } from "lucide-react";
import SecureFileLink from "./SecureFileLink";
import { checkSpesFile } from "../utils/spesSlots";
import { translateErrorCode } from "../utils/apiErrors";
import "../styles/file-upload.css";

// One row per required document slot: its state (missing, pending review,
// verified, needs replacement with the staff reason) and an Upload / Replace
// action while the application is still open for document changes.
//
// onUpload(slot, file, { signal, onUploadProgress }) resolves to null on success or an
// error code string; a cancelled upload resolves to "UPLOAD_CANCELED" and shows no error.
export default function SpesDocChecklist({ slots, documents, canEdit, onUpload }) {
  const { t } = useTranslation();
  const [busySlot, setBusySlot] = useState("");
  const [rowError, setRowError] = useState({});
  const [progress, setProgress] = useState(0);
  const inputs = useRef({});
  const abortRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const docBySlot = new Map();
  (documents || []).forEach((doc) => {
    if (doc.slot) docBySlot.set(doc.slot, doc);
  });
  const others = (documents || []).filter((doc) => !doc.slot);

  const handlePick = async (slot, file) => {
    if (!file) return;
    const local = checkSpesFile(file);
    if (local) {
      setRowError((prev) => ({ ...prev, [slot]: local }));
      return;
    }
    setRowError((prev) => ({ ...prev, [slot]: "" }));
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress(0);
    setBusySlot(slot);
    try {
      const code = await onUpload(slot, file, {
        signal: controller.signal,
        onUploadProgress: (e) => {
          if (e.total) setProgress(Math.round((e.loaded / e.total) * 100));
        },
      });
      if (code && code !== "UPLOAD_CANCELED") setRowError((prev) => ({ ...prev, [slot]: code }));
    } finally {
      abortRef.current = null;
      setBusySlot("");
    }
  };

  const iconFor = (state) => {
    if (state === "verified") return <CheckCircle2 size={16} className="spes-slot__icon spes-slot__icon--ok" aria-hidden="true" />;
    if (state === "needs_replacement") return <AlertTriangle size={16} className="spes-slot__icon spes-slot__icon--warn" aria-hidden="true" />;
    if (state === "pending") return <Clock size={16} className="spes-slot__icon spes-slot__icon--wait" aria-hidden="true" />;
    return <Circle size={16} className="spes-slot__icon" aria-hidden="true" />;
  };

  return (
    <div className="spes-slots">
      <ul className="spes-slots__list">
        {slots.map((slot) => {
          const doc = docBySlot.get(slot);
          const state = doc ? doc.verification?.state || "pending" : "missing";
          const needsAction = state === "missing" || state === "needs_replacement";
          const showUpload = canEdit && (needsAction || state === "pending" || state === "verified");
          const errorCode = rowError[slot];
          return (
            <li key={slot} className={`spes-slot spes-slot--${state}`}>
              <div className="spes-slot__main">
                {iconFor(state)}
                <div className="spes-slot__text">
                  <span className="spes-slot__name" title={t(`spes.docs.slot.${slot}`)}>
                    {t(`spes.docs.slotShort.${slot}`)}
                  </span>
                  {state === "needs_replacement" && doc?.verification?.reason ? (
                    <span className="spes-slot__reason">
                      {t("spes.docs.reasonLabel")} {doc.verification.reason}
                    </span>
                  ) : null}
                  {busySlot === slot ? (
                    <span
                      className="fu__progress"
                      role="progressbar"
                      aria-label={t("upload.progressLabel", { name: t(`spes.docs.slot.${slot}`) })}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progress}
                    >
                      <span className="fu__progress-bar" style={{ width: `${progress}%` }} />
                    </span>
                  ) : null}
                  {errorCode ? (
                    <span className="spes-slot__error" role="alert">
                      {translateErrorCode(errorCode, t("spes.docs.uploadFailed"))}
                    </span>
                  ) : null}
                </div>
              </div>
              <span className={`spes-slot__chip spes-slot__chip--${state}`}>{t(`spes.docs.state.${state}`)}</span>
              <div className="spes-slot__actions">
                {doc ? (
                  <SecureFileLink
                    className="spes-icon-btn"
                    value={doc.fileUrl}
                    title={t("spes.docs.view")}
                    ariaLabel={`${t("spes.docs.view")}: ${t(`spes.docs.slotShort.${slot}`)}`}
                  >
                    <Download size={16} aria-hidden="true" />
                  </SecureFileLink>
                ) : null}
                {showUpload ? (
                  <>
                    <input
                      ref={(el) => {
                        inputs.current[slot] = el;
                      }}
                      type="file"
                      className="spes-slot__file"
                      accept=".pdf,image/jpeg,image/png"
                      aria-label={t("spes.docs.chooseFor", { name: t(`spes.docs.slot.${slot}`) })}
                      onChange={(e) => {
                        handlePick(slot, e.target.files?.[0]);
                        e.target.value = "";
                      }}
                      tabIndex={-1}
                    />
                    {busySlot === slot ? (
                      <button type="button" className="spes-btn spes-btn--small spes-btn--ghost" onClick={() => abortRef.current?.abort()}>
                        {t("upload.cancel")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={`spes-icon-btn${needsAction ? " spes-icon-btn--primary" : ""}`}
                      disabled={Boolean(busySlot)}
                      title={doc ? t("spes.docs.replace") : t("spes.docs.upload")}
                      aria-label={`${
                        busySlot === slot
                          ? `${t("spes.docs.uploading")} ${progress}%`
                          : doc
                            ? t("spes.docs.replace")
                            : t("spes.docs.upload")
                      }: ${t(`spes.docs.slotShort.${slot}`)}`}
                      onClick={() => inputs.current[slot]?.click()}
                    >
                      <Upload size={16} aria-hidden="true" />
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {others.length > 0 ? (
        <div className="spes-slots__other">
          <h4>{t("spes.docs.otherTitle")}</h4>
          <ul className="spes-doc-list">
            {others.map((doc, i) => (
              <li key={doc._id || i}>
                <span className="spes-doc-list__label">{doc.label || t("spes.docs.otherItem", { n: i + 1 })}</span>
                <SecureFileLink className="spes-doc-list__link" value={doc.fileUrl}>
                  <Download size={12} aria-hidden="true" /> {t("spes.docs.view")}
                </SecureFileLink>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
