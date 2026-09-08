import { useState } from "react";
import { Link } from "react-router-dom";
import { authAPI } from "../services/api";
import "../styles/auth.css";
import pesoLogo from "../assets/images/peso-logo.png";
import provincialSeal from "../assets/images/provincial-seal.png";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [devResetUrl, setDevResetUrl] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Please enter your email address.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const { data } = await authAPI.forgotPassword(trimmed);
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
            Enter the email address for your account and we&rsquo;ll send you a link to reset your password.
          </p>

          {error && (
            <div className="error-message" role="alert" aria-live="polite">
              {error}
            </div>
          )}

          {sent ? (
            <div className="auth-notice" role="status" aria-live="polite">
              <p>
                If <strong>{email.trim()}</strong> is registered, a password reset link is on its way.
                The link expires in 30 minutes.
              </p>
              {devResetUrl && (
                <p className="auth-notice__dev">
                  <strong>Dev:</strong> email isn&rsquo;t wired up yet &mdash;{" "}
                  <a href={devResetUrl}>open the reset link</a>.
                </p>
              )}
            </div>
          ) : (
            <form className="auth-form" onSubmit={handleSubmit} noValidate>
              <div className="form-group">
                <label htmlFor="email">Email Address</label>
                <input
                  id="email"
                  type="email"
                  name="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  disabled={loading}
                />
              </div>

              <button type="submit" className="auth-button" disabled={loading}>
                {loading ? "Sending..." : "Send reset link"}
              </button>
            </form>
          )}

          <p className="auth-link">
            Remembered it? <Link to="/login">Back to login</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
