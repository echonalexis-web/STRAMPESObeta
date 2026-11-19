import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";
import AppModal from "./AppModal";
import { adminAPI } from "../services/api";
import { DELETE_REASONS, canConfirmDelete, confirmationTarget } from "../utils/userStatus";
import "../styles/user-management.css";

// Two-step, guarded delete for a deactivated employer or jobseeker. The server
// re-checks everything (role, deactivated, typed confirmation, reason); this
// only keeps the destructive button locked until the admin has typed the
// account's username or email and chosen a reason. Focus opens on the close
// button (first focusable in AppModal), never on the destructive button.
export default function DeleteUserModal({ user, onClose, onDeleted }) {
  const { t } = useTranslation();
  const uid = useId();
  const [preview, setPreview] = useState({ state: "loading", data: null });
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [typed, setTyped] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    adminAPI
      .getDeletePreview(user._id)
      .then(({ data }) => {
        if (!cancelled) setPreview({ state: "ready", data });
      })
      .catch((err) => {
        if (cancelled) return;
        // A guard failure (already deleted, not deactivated, staff) is final.
        setPreview({ state: "error", data: null });
        if (err.response?.status && err.response.status !== 500) {
          setError(err.response?.data?.message || "");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user._id]);

  const target = confirmationTarget(user);
  const canDelete = canConfirmDelete({ user, reason, typed }) && !submitting;
  const summary = preview.data?.summary;
  const graceDays = preview.data?.graceDays ?? 30;

  const submit = async (event) => {
    event.preventDefault();
    if (!canDelete) return;
    setSubmitting(true);
    setError("");
    try {
      const { data } = await adminAPI.deleteUser(user._id, { reason, note: note.trim(), confirm: typed.trim() });
      onDeleted(user, data);
    } catch (err) {
      setError(err.response?.data?.message || t("superadmin.users.delete.error"));
      setSubmitting(false);
    }
  };

  const titleId = `${uid}-title`;
  const introId = `${uid}-intro`;

  return (
    <AppModal
      isOpen
      onClose={submitting ? () => {} : onClose}
      title={t("superadmin.users.delete.title", { name: user.name })}
      titleId={titleId}
      describedBy={introId}
      panelClassName="um-delete-modal"
      closeLabel={t("common.close", { defaultValue: "Close" })}
    >
      <form onSubmit={submit} className="um-delete" noValidate>
        <p id={introId} className="um-delete__intro">
          <TriangleAlert size={18} aria-hidden="true" /> {t("superadmin.users.delete.intro")}
        </p>

        <section aria-labelledby={`${uid}-effects`} className="um-delete__effects">
          <h4 id={`${uid}-effects`}>{t("superadmin.users.delete.effectsHeading")}</h4>
          <ul>
            <li>{t("superadmin.users.delete.effectLogin")}</li>
            <li>{t("superadmin.users.delete.effectGrace", { days: graceDays })}</li>
            <li>{t("superadmin.users.delete.effectKept")}</li>
            {preview.state === "loading" && <li>{t("superadmin.users.delete.previewLoading")}</li>}
            {preview.state === "error" && <li>{t("superadmin.users.delete.previewError")}</li>}
            {summary && (
              <li>
                {summary.role === "employer"
                  ? t("superadmin.users.delete.summaryEmployer", {
                      postings: summary.postings,
                      open: summary.openPostings,
                      received: summary.applicationsReceived,
                      inProgress: summary.applicationsInProgress,
                      hires: summary.hires,
                    })
                  : t("superadmin.users.delete.summaryJobseeker", {
                      applications: summary.applications,
                      inProgress: summary.applicationsInProgress,
                      hires: summary.hires,
                    })}
              </li>
            )}
            {summary?.applicationsInProgress > 0 && (
              <li className="um-delete__warn">{t("superadmin.users.delete.inProgressWarning")}</li>
            )}
          </ul>
        </section>

        <div className="um-field">
          <label htmlFor={`${uid}-reason`}>{t("superadmin.users.delete.reasonLabel")}</label>
          <select id={`${uid}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} required>
            <option value="">{t("superadmin.users.delete.reasonPlaceholder")}</option>
            {DELETE_REASONS.map((key) => (
              <option key={key} value={key}>{t(`superadmin.users.delete.reasons.${key}`)}</option>
            ))}
          </select>
        </div>

        <div className="um-field">
          <label htmlFor={`${uid}-note`}>{t("superadmin.users.delete.noteLabel")}</label>
          <textarea
            id={`${uid}-note`}
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-describedby={`${uid}-note-hint`}
          />
          <small id={`${uid}-note-hint`}>{t("superadmin.users.delete.noteHint")}</small>
        </div>

        <div className="um-field">
          <label htmlFor={`${uid}-confirm`}>
            {t("superadmin.users.delete.confirmLabel", { target })}
          </label>
          <input
            id={`${uid}-confirm`}
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-describedby={`${uid}-confirm-hint`}
          />
          <small id={`${uid}-confirm-hint`}>{t("superadmin.users.delete.confirmHint")}</small>
        </div>

        {error && <p className="um-delete__error" role="alert">{error}</p>}

        <div className="um-delete__actions">
          <button type="button" className="um-btn um-btn--ghost" onClick={onClose} disabled={submitting}>
            {t("superadmin.users.delete.cancel")}
          </button>
          <button type="submit" className="um-btn um-btn--danger" disabled={!canDelete}>
            {submitting ? t("superadmin.users.delete.deleting") : t("superadmin.users.delete.confirm")}
          </button>
        </div>
      </form>
    </AppModal>
  );
}
