import { useContext, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { AuthContext } from "../context/AuthContext";
import { authAPI } from "../services/api";
import { mapServerError, phoneErrorEntry } from "../utils/formErrors";
import { parsePhone } from "../utils/phoneIntl";
import PhoneInput from "./PhoneInput";
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
  // { key, params } for the phone field, or { message } for a failure that is not about the field.
  const [error, setError] = useState(null);

  const save = async (event) => {
    event.preventDefault();
    if (busy || disabled) return;
    // The apply rule needs a plausible number; a landline is still accepted here
    // because older accounts may hold one. The server decides.
    const parsed = parsePhone(phone, { allowLandline: true });
    if (!parsed.ok) {
      setError(phoneErrorEntry(parsed.code, parsed.params));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("phone", parsed.e164);
      await authAPI.updateProfile(body);
      if (user) setUser({ ...user, phone: parsed.e164 });
      onSaved();
    } catch (err) {
      const mapped = mapServerError(err);
      setError(mapped.key ? { key: mapped.key, params: mapped.params, message: mapped.message } : { message: t("applyStep.saveError") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="apstep" onSubmit={save} noValidate>
      <h3 className="apstep__title">{t("applyStep.phoneTitle")}</h3>
      <p className="egate__text">{t("applyStep.phoneBody")}</p>
      <PhoneInput
        id="apstep-phone"
        name="phone"
        label={t("applyStep.phoneLabel")}
        value={phone}
        onChange={(value) => {
          setPhone(value);
          if (error) setError(null);
        }}
        error={error}
        required
        allowLandline
        autoFocus
        disabled={busy || disabled}
      />
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
