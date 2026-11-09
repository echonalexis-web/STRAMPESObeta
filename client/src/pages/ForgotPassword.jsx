import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { authAPI } from "../services/api";
import "../styles/auth.css";
import "../styles/username-signup.css";
import { isUsernameSignupEnabled } from "../utils/usernameSignup";
import pesoLogo from "../assets/images/peso-logo.png";
import provincialSeal from "../assets/images/provincial-seal.png";

export default function ForgotPassword() {
  const { t } = useTranslation();
  // With username sign-up on, the page takes an email OR a username and gives
  // the same neutral answer either way.
  const usernameFeature = isUsernameSignupEnabled();
  const [email, setEmail] = useState("");
  const [useRecoveryEmail, setUseRecoveryEmail] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [devResetUrl, setDevResetUrl] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setError(usernameFeature ? t("forgot.required") : "Please enter your email address.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      // Safe to always pass: the server only actually honors this when the
      // account has a VERIFIED recovery email on file, and silently falls
      // back to this primary address otherwise — the response here never
      // reveals which happened.
      const { data } = await authAPI.forgotPassword(trimmed, useRecoveryEmail);
      setSent(true);
      if (data?.devResetUrl) setDevResetUrl(data.devResetUrl);
    } catch (err) {
      setError(err?.response?.data?.message || "Something went wrong. Please try again.");
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
            <p className="auth-branding-desc">
              Marinduque, the Heart of the Philippines. Connect with local employers,
              discover livelihood opportunities, and build your future right here at home.
            </p>
            <img src={provincialSeal} alt="Provincial Seal of Marinduque" className="auth-branding-seal" />
            <div className="auth-branding-footer">
              PUBLIC EMPLOYMENT SERVICE OFFICE<br />
              Lalawigan ng Marinduque
            </div>
          </div>
        </div>

        <div className="auth-card">
          <h2>Forgot your password?</h2>
          <p className="auth-subtitle">
            {usernameFeature
              ? t("forgot.intro")
              : "Enter the email address for your account and we\u2019ll send you a link to reset your password."}
          </p>

          {error && (
            <div className="error-message" role="alert" aria-live="polite">
              {error}
            </div>
          )}

          {sent ? (
            <div className="auth-notice" role="status" aria-live="polite">
              {usernameFeature ? (
                <p>{t("forgot.neutralMessage")}</p>
              ) : (
                <p>
                  If <strong>{email.trim()}</strong> is registered, a password reset link is on its way.
                  The link expires in 30 minutes.
                </p>
              )}
              <p>
                Signed in with &ldquo;Continue with Google&rdquo; before? This link still works —
                opening it lets you set a password for this account, which you can use from now on
                even if you ever lose access to that Google account.
              </p>
              {devResetUrl && (
                <p className="auth-notice__dev">
                  <strong>Dev:</strong> email isn&rsquo;t wired up yet &mdash;{" "}
                  <a href={devResetUrl}>open the reset link</a>.
                </p>
              )}
            </div>
          ) : (
            <>
              <form className="auth-form" onSubmit={handleSubmit} noValidate>
                <div className="form-group">
                  <label htmlFor="email">{usernameFeature ? t("forgot.identifierLabel") : "Email Address"}</label>
                  <input
                    id="email"
                    type={usernameFeature ? "text" : "email"}
                    name="email"
                    placeholder={usernameFeature ? t("forgot.identifierPlaceholder") : "Enter your email"}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete={usernameFeature ? "username" : "email"}
                    required
                    disabled={loading}
                  />
                </div>

                {/* Shown to everyone, regardless of whether this account
                    actually has one configured — checking it just tries the
                    recovery-email path server-side, falling back to this
                    primary address silently if there isn't one, so showing
                    the option itself leaks nothing. */}
                <label className="auth-checkbox-row">
                  <input
                    type="checkbox"
                    checked={useRecoveryEmail}
                    onChange={(e) => setUseRecoveryEmail(e.target.checked)}
                    disabled={loading}
                  />
                  I can&rsquo;t access this email — try my recovery email instead
                </label>

                <button type="submit" className="auth-button" disabled={loading}>
                  {loading ? "Sending..." : "Send reset link"}
                </button>
              </form>

              {/* Deliberately generic — this page can't say whether any given
                  email belongs to a Google-linked account without leaking
                  which emails have accounts at all. The note below holds
                  regardless of how this account signs in. */}
              <p className="auth-help">
                Usually sign in with &ldquo;Continue with Google&rdquo;? This still works for you —
                the link goes wherever you chose above, and opening it lets you set a password.
                If you can&rsquo;t access either inbox,{" "}
                <Link to="/account-recovery">recover your account with a backup code</Link>, or
                visit or call the <Link to="/about">PESO office</Link> for help.
              </p>
            </>
          )}

          {usernameFeature && (
            <div className="su-note" role="note">
              <strong>{t("forgot.noEmailTitle")}</strong>
              <br />
              {t("forgot.noEmailBody")}{" "}
              <Link to="/account-recovery">{t("forgot.useBackupCode")}</Link>
              {" · "}
              <Link to="/about">{t("forgot.askPeso")}</Link>
              {" · "}
              <Link to="/forgot-username">{t("forgot.forgotUsername")}</Link>
            </div>
          )}

          <p className="auth-link"><Link to="/staff-account-recovery">{t("staffRecovery.requestLink")}</Link></p>
          <p className="auth-link">
            Remembered it? <Link to="/login">Back to login</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
