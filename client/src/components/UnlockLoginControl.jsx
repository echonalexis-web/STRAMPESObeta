import { useState } from "react";
import { useTranslation } from "react-i18next";
import { adminAPI } from "../services/api";
import { translateErrorCode } from "../utils/apiErrors";
import "../styles/username-signup.css";

// Admin: unlock a locked-out jobseeker's sign-in. A reason is required and is
// written to the audit log by the server.
export default function UnlockLoginControl({ userId, onUnlocked }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { data } = await adminAPI.unlockLogin(userId, reason.trim());
      setMessage(data?.unlocked ? t("admin.accounts.unlocked") : t("admin.accounts.nothingToUnlock"));
      setReason("");
      if (onUnlocked) onUnlocked();
    } catch (err) {
      setError(translateErrorCode(err?.response?.data?.code, "") || t("admin.accounts.unlockError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="egate asum__unlock" onSubmit={submit}>
      <p className="egate__text">{t("admin.accounts.unlockConfirm")}</p>
      <div className="egate__field">
        <label className="egate__label" htmlFor={`unlock-reason-${userId}`}>
          {t("admin.accounts.unlockReason")}
        </label>
        <input
          id={`unlock-reason-${userId}`}
          className="egate__input"
          type="text"
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("admin.accounts.unlockReasonPlaceholder")}
          disabled={busy}
        />
      </div>
      {error && (
        <p className="egate__error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="egate__ok" role="status">
          {message}
        </p>
      )}
      <button type="submit" className="egate__btn egate__btn--primary" disabled={busy || reason.trim().length < 5}>
        {t("admin.accounts.unlock")}
      </button>
    </form>
  );
}
