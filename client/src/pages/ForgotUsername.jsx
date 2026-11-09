import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { authAPI } from "../services/api";
import { translateErrorCode } from "../utils/apiErrors";
import "../styles/auth.css";
import "../styles/username-signup.css";
import pesoLogo from "../assets/images/peso-logo.png";
import provincialSeal from "../assets/images/provincial-seal.png";

// Neutral by design: the page never says whether the email belongs to an
// account, and never shows a username. If the email is on a verified account,
// the username is mailed to it (server side).
export default function ForgotUsername() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setError(t("forgotUsername.required"));
      return;
    }
    setError("");
    setLoading(true);
    try {
      await authAPI.forgotUsername(trimmed);
      setSent(true);
    } catch (err) {
      setError(translateErrorCode(err?.response?.data?.code, "") || t("errors.codes.GENERIC"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-panel">
        <div className="auth-branding">
          <div className="auth-branding-content">
            <img src={pesoLogo} alt="PESO Marinduque Logo" className="auth-branding-logo" />
            <h1 className="auth-branding-title">TRABAHO MANDIN!</h1>
            <p className="auth-branding-tagline">Trabaho para sa Marinduqueño</p>
            <img src={provincialSeal} alt="Provincial Seal of Marinduque" className="auth-branding-seal" />
            <div className="auth-branding-footer">
              PUBLIC EMPLOYMENT SERVICE OFFICE<br />
              Lalawigan ng Marinduque
            </div>
          </div>
        </div>

        <div className="auth-card">
          <h2>{t("forgotUsername.title")}</h2>
          <p className="auth-subtitle">{t("forgotUsername.intro")}</p>

          {error && (
            <div className="error-message" role="alert" aria-live="polite">
              {error}
            </div>
          )}

          {sent ? (
            <div className="auth-notice" role="status" aria-live="polite">
              <p>{t("forgotUsername.neutralMessage")}</p>
            </div>
          ) : (
            <form className="auth-form" onSubmit={handleSubmit} noValidate>
              <div className="form-group">
                <label htmlFor="fu-email">{t("forgotUsername.emailLabel")}</label>
                <input
                  id="fu-email"
                  type="email"
                  name="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  disabled={loading}
                />
              </div>
              <button type="submit" className="auth-button" disabled={loading}>
                {loading ? t("forgotUsername.sending") : t("forgotUsername.send")}
              </button>
            </form>
          )}

          <p className="su-hint">{t("forgotUsername.noEmailNote")}</p>
          <p className="auth-link">
            <Link to="/login">{t("forgotUsername.back")}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
