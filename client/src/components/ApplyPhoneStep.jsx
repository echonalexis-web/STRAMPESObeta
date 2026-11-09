import { useContext, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { AuthContext } from "../context/AuthContext";
import { authAPI } from "../services/api";
import { translateErrorCode } from "../utils/apiErrors";
import { phoneProblem } from "../utils/phone";
import "../styles/username-signup.css";

// Inline step inside the apply screen: the server wants a phone number before a
// job application. The person adds it here and the application continues, with
// no detour to another page. FORMAT check only (no SMS). The phone is saved with
// the ordinary text-only profile update.
export default function ApplyPhoneStep({ initialPhone = "", onSaved, disabled = false }) {
  const { t } = useTranslation();
  const { user, setUser } = useContext(AuthContext);
  const [phone, setPhone] = useState(initialPhone || user?.phone || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (event) => {
    event.preventDefault();
    if (busy || disabled) return;
    const problem = phoneProblem(phone);
    if (problem) {
      setError(t(`errors.codes.${problem}`));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("phone", phone.trim());
      await authAPI.updateProfile(body);
      if (user) setUser({ ...user, phone: phone.trim() });
      onSaved();
    } catch (err) {
      setError(translateErrorCode(err?.response?.data?.code, "") || t("applyStep.saveError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="apstep" onSubmit={save} noValidate>
      <h3 className="apstep__title">{t("applyStep.phoneTitle")}</h3>
      <p className="egate__text">{t("applyStep.phoneBody")}</p>
      <div className="egate__field">
        <label className="egate__label" htmlFor="apstep-phone">{t("applyStep.phoneLabel")}</label>
        <input
          id="apstep-phone"
          className="egate__input"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          autoFocus
          placeholder={t("applyStep.phonePlaceholder")}
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            if (error) setError("");
          }}
          disabled={busy || disabled}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? "apstep-error" : undefined}
        />
      </div>
      {error && (
        <p className="egate__error" role="alert" id="apstep-error">
          {error}
        </p>
      )}
      <button type="submit" className="egate__btn egate__btn--primary" disabled={busy || disabled}>
        {busy ? t("applyStep.saving") : t("applyStep.save")}
      </button>
    </form>
  );
}

ApplyPhoneStep.propTypes = {
  initialPhone: PropTypes.string,
  onSaved: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
};
