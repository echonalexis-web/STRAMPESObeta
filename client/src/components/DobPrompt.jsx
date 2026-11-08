import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import AppModal from "./AppModal";
import { checkDobInput, getManilaTodayISO } from "../utils/age";
import "../styles/age-gate.css";

// Asks for a date of birth in a dialog. Used for the Google first-time sign-in
// step and for legacy accounts that have no date of birth yet. The server is
// the authority: this only pre-checks the format and the 15-year minimum so a
// rejected under-15 date is never even sent.
//
// onSubmit(dateOfBirth) must resolve to null on success, or an error code string.
export default function DobPrompt({ isOpen, onSubmit, onCancel, title, description, submitLabel }) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const errorId = `${inputId}-error`;

  const handleSubmit = async (event) => {
    event.preventDefault();
    const local = checkDobInput(value);
    if (local) {
      setErrorCode(local);
      return;
    }
    setBusy(true);
    setErrorCode("");
    try {
      const code = await onSubmit(value);
      if (code) setErrorCode(code);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppModal
      isOpen={isOpen}
      onClose={onCancel || (() => {})}
      hideClose={!onCancel}
      title={title || t("ageGate.dobTitle")}
      closeLabel={t("common.close", { defaultValue: "Close" })}
      panelClassName="dob-prompt"
    >
      <form className="dob-prompt__form" onSubmit={handleSubmit} noValidate>
        <p className="dob-prompt__text">{description || t("ageGate.dobDescription")}</p>
        <label className="dob-prompt__label" htmlFor={inputId}>
          {t("ageGate.dobLabel")}
        </label>
        <input
          id={inputId}
          className="dob-prompt__input"
          type="date"
          value={value}
          max={getManilaTodayISO()}
          min="1900-01-01"
          onChange={(e) => {
            setValue(e.target.value);
            setErrorCode("");
          }}
          aria-invalid={Boolean(errorCode)}
          aria-describedby={errorCode ? errorId : undefined}
          autoComplete="bday"
          required
        />
        <p className="dob-prompt__hint">{t("ageGate.dobLockedHint")}</p>
        {errorCode ? (
          <p className="dob-prompt__error" id={errorId} role="alert">
            {t(`errors.codes.${errorCode}`, { defaultValue: t("ageGate.genericError") })}
          </p>
        ) : null}
        <div className="dob-prompt__actions">
          {onCancel ? (
            <button type="button" className="dob-prompt__btn dob-prompt__btn--ghost" onClick={onCancel} disabled={busy}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </button>
          ) : null}
          <button type="submit" className="dob-prompt__btn" disabled={busy}>
            {busy ? t("ageGate.saving") : submitLabel || t("ageGate.continue")}
          </button>
        </div>
      </form>
    </AppModal>
  );
}
