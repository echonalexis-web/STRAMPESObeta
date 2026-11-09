import { useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { adminAPI } from "../services/api";
import { translateErrorCode } from "../utils/apiErrors";
import { GOVERNMENT_ID_TYPES } from "../constants/governmentIdTypes";
import TemporaryPasswordPanel from "./TemporaryPasswordPanel";
import "../styles/username-signup.css";

// PESO staff: reset a jobseeker's password at the counter, only after checking a
// government ID in person. Needs the staff member's own password, a reason and
// the ID type shown. The temporary password is returned ONCE and shown here once.
export default function ResetPasswordControl({ userId }) {
  const { t } = useTranslation();
  const [idType, setIdType] = useState("");
  const [idChecked, setIdChecked] = useState(false);
  const [reason, setReason] = useState("");
  const [staffPassword, setStaffPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");

  const ready = idChecked && idType && reason.trim().length >= 10 && staffPassword;

  const submit = async (event) => {
    event.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await adminAPI.resetUserPassword(userId, {
        reason: reason.trim(),
        idChecked: true,
        idTypePresented: idType,
        staffPassword,
      });
      setTemporaryPassword(data.temporaryPassword);
      setStaffPassword("");
      setReason("");
      setIdChecked(false);
      setIdType("");
    } catch (err) {
      setStaffPassword("");
      setError(translateErrorCode(err?.response?.data?.code, "") || t("adminReset.error"));
    } finally {
      setBusy(false);
    }
  };

  if (temporaryPassword) {
    return <TemporaryPasswordPanel value={temporaryPassword} onDone={() => setTemporaryPassword("")} />;
  }

  return (
    <form className="egate asum__unlock" onSubmit={submit}>
      <h3 className="apstep__title">{t("adminReset.title")}</h3>
      <p className="egate__text">{t("adminReset.intro")}</p>

      <div className="egate__field">
        <label className="egate__label" htmlFor={`reset-id-${userId}`}>{t("adminReset.idTypeLabel")}</label>
        <select id={`reset-id-${userId}`} className="egate__input" value={idType} onChange={(e) => setIdType(e.target.value)} disabled={busy}>
          <option value="">{t("adminReset.idTypePlaceholder")}</option>
          {GOVERNMENT_ID_TYPES.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
      </div>

      <label className="bcs__confirm">
        <input type="checkbox" checked={idChecked} onChange={(e) => setIdChecked(e.target.checked)} disabled={busy} />
        <span>{t("adminReset.idChecked")}</span>
      </label>

      <div className="egate__field">
        <label className="egate__label" htmlFor={`reset-reason-${userId}`}>{t("adminReset.reasonLabel")}</label>
        <input
          id={`reset-reason-${userId}`}
          className="egate__input"
          type="text"
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("adminReset.reasonPlaceholder")}
          disabled={busy}
        />
      </div>

      <div className="egate__field">
        <label className="egate__label" htmlFor={`reset-pw-${userId}`}>{t("adminReset.staffPasswordLabel")}</label>
        <input
          id={`reset-pw-${userId}`}
          className="egate__input"
          type="password"
          autoComplete="current-password"
          value={staffPassword}
          onChange={(e) => setStaffPassword(e.target.value)}
          disabled={busy}
        />
      </div>

      {error && <p className="egate__error" role="alert">{error}</p>}

      <button type="submit" className="egate__btn egate__btn--primary" disabled={busy || !ready}>
        {busy ? t("adminReset.working") : t("adminReset.confirm")}
      </button>
    </form>
  );
}

ResetPasswordControl.propTypes = { userId: PropTypes.string.isRequired };
