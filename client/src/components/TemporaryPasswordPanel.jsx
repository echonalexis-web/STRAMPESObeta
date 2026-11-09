import { useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import "../styles/username-signup.css";

// Shows a one-time temporary password to PESO staff. It is held only in this
// component's props, shown once, and gone when staff press Done. Used by the
// office reset and by "complete in person" on a phone-contact recovery request.
export default function TemporaryPasswordPanel({ value, onDone }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="egate asum__unlock" role="region" aria-labelledby="temp-pw-title">
      <h3 className="apstep__title" id="temp-pw-title">{t("adminReset.tempTitle")}</h3>
      <p className="egate__ok" role="status">{t("adminReset.tempNote")}</p>
      <code className="temp-pw">{value}</code>
      <div className="egate__actions">
        <button type="button" className="egate__btn egate__btn--ghost" onClick={copy}>
          {copied ? t("adminReset.copied") : t("adminReset.copy")}
        </button>
        <button type="button" className="egate__btn egate__btn--primary" onClick={onDone}>
          {t("adminReset.done")}
        </button>
      </div>
    </section>
  );
}

TemporaryPasswordPanel.propTypes = { value: PropTypes.string.isRequired, onDone: PropTypes.func.isRequired };
