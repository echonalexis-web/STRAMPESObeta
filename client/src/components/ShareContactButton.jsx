import { formatPhoneDisplay } from "../utils/phoneIntl";
import { useCallback, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FaAddressCard } from "react-icons/fa";
import AppModal from "./AppModal";
import { useToast } from "./feedback/context";
import { AuthContext } from "../context/AuthContext";
import { messageAPI } from "../services/api";
import { apiErrorMessage } from "../utils/apiErrors";
import "../styles/cover.css";

const JOBSEEKER_ROLES = ["jobseeker", "employee", "resident"];

// "Share my contact details" (COVER_PHOTO_PLAN.md 3.6 and 4.2): a jobseeker's
// explicit, revocable choice to share phone and/or email with the employer in THIS
// conversation. The dialog shows exactly which values will be shared, and a share
// can be stopped at any time. A reply never shares anything.
// Renders nothing unless a jobseeker is talking to an employer; the server decides
// for real (adults only).
export default function ShareContactButton({ conversationId, participantRole }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { user } = useContext(AuthContext) || {};
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ status: "loading", data: null });
  const [choice, setChoice] = useState({ phone: true, email: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 15 to 17 year olds never get the button (employers cannot contact them in the portal).
  const eligible =
    JOBSEEKER_ROLES.includes(user?.role) &&
    participantRole === "employer" &&
    Boolean(conversationId) &&
    user?.ageTier !== "minor15to17" &&
    user?.ageTier !== "under15";

  const load = useCallback(() => {
    setState({ status: "loading", data: null });
    messageAPI
      .getContactShare(conversationId)
      .then((res) => {
        const data = res.data;
        setState({ status: "ready", data });
        setChoice({ phone: Boolean(data.values?.phone), email: Boolean(data.values?.email) });
      })
      .catch((err) => {
        const code = err?.response?.data?.code;
        setState({ status: code === "CONTACT_SHARE_NOT_ALLOWED" ? "denied" : "error", data: null });
      });
  }, [conversationId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  if (!eligible) return null;
  if (state.status === "denied" && !open) return null;

  const data = state.data;
  const share = data?.share;
  const hasPhone = Boolean(data?.values?.phone);
  const hasEmail = Boolean(data?.values?.email);
  const picked = [choice.phone && hasPhone ? "phone" : null, choice.email && hasEmail ? "email" : null].filter(Boolean);

  const doShare = async () => {
    setBusy(true);
    setError("");
    try {
      const { data: result } = await messageAPI.shareContact(conversationId, picked);
      setState((prev) => ({ ...prev, data: { ...prev.data, share: result.share } }));
      toast.success(t("contactShare.sharedToast"));
    } catch (err) {
      setError(apiErrorMessage(err, t("contactShare.error")));
    } finally {
      setBusy(false);
    }
  };

  const doRevoke = async () => {
    setBusy(true);
    setError("");
    try {
      const { data: result } = await messageAPI.revokeContactShare(conversationId);
      setState((prev) => ({ ...prev, data: { ...prev.data, share: result.share } }));
      toast.success(t("contactShare.revokedToast"));
    } catch (err) {
      setError(apiErrorMessage(err, t("contactShare.error")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="share-contact-btn" onClick={() => setOpen(true)} aria-label={t("contactShare.button")} title={t("contactShare.button")}>
        <FaAddressCard aria-hidden="true" />
        <span className="share-contact-btn__label">{t("contactShare.button")}</span>
      </button>

      <AppModal isOpen={open} onClose={() => setOpen(false)} title={t("contactShare.title")} closeLabel={t("contactShare.close")} panelClassName="share-contact">
        <h2 className="cover-picker__title">{t("contactShare.title")}</h2>

        {state.status === "loading" ? <p className="cover-picker__note">{t("contactShare.loading")}</p> : null}
        {state.status === "error" || state.status === "denied" ? (
          <p className="cover-picker__error" role="alert">
            {state.status === "denied" ? t("contactShare.notAvailable") : t("contactShare.error")}
          </p>
        ) : null}

        {state.status === "ready" && data ? (
          <div className="share-contact__body">
            {share?.active ? (
              <>
                <p>{t("contactShare.sharedWith", { name: data.employerName })}</p>
                <ul className="share-contact__list">
                  {share.fields.phone ? <li>{t("contactShare.phoneLabel")}: {formatPhoneDisplay(data.values.phone) || "—"}</li> : null}
                  {share.fields.email ? <li>{t("contactShare.emailLabel")}: {data.values.email || "—"}</li> : null}
                </ul>
                <p className="cover-picker__note">{t("contactShare.revokeNote")}</p>
              </>
            ) : (
              <>
                <p>{t("contactShare.explain", { name: data.employerName })}</p>
                {!hasPhone && !hasEmail ? <p className="cover-picker__error">{t("contactShare.noContact")}</p> : null}
                <fieldset className="share-contact__fields" disabled={busy}>
                  <legend className="ds-sr-only">{t("contactShare.legend")}</legend>
                  {hasPhone ? (
                    <label className="share-contact__field">
                      <input type="checkbox" checked={choice.phone} onChange={(e) => setChoice((c) => ({ ...c, phone: e.target.checked }))} />
                      <span>
                        {t("contactShare.phoneLabel")}: <strong>{formatPhoneDisplay(data.values.phone)}</strong>
                      </span>
                    </label>
                  ) : null}
                  {hasEmail ? (
                    <label className="share-contact__field">
                      <input type="checkbox" checked={choice.email} onChange={(e) => setChoice((c) => ({ ...c, email: e.target.checked }))} />
                      <span>
                        {t("contactShare.emailLabel")}: <strong>{data.values.email}</strong>
                      </span>
                    </label>
                  ) : null}
                </fieldset>
                <p className="cover-picker__note">{t("contactShare.consent")}</p>
              </>
            )}
            {error ? (
              <p className="cover-picker__error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="cover-picker__actions">
              <span className="cover-picker__spacer" />
              <button type="button" className="cover-picker__ghost" onClick={() => setOpen(false)} disabled={busy}>
                {t("contactShare.close")}
              </button>
              {share?.active ? (
                <button type="button" className="cover-picker__primary" onClick={doRevoke} disabled={busy}>
                  {t("contactShare.revoke")}
                </button>
              ) : (
                <button type="button" className="cover-picker__primary" onClick={doShare} disabled={busy || picked.length === 0}>
                  {t("contactShare.share")}
                </button>
              )}
            </div>
          </div>
        ) : null}
      </AppModal>
    </>
  );
}
