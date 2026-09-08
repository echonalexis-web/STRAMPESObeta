import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { authAPI } from "../services/api";
import "../styles/auth.css";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import pesoLogo from "../assets/images/peso-logo.png";
import provincialSeal from "../assets/images/provincial-seal.png";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const email = params.get("email") || "";
  const linkValid = useMemo(() => Boolean(token && email), [token, email]);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (password.length < 8) {
      setError("Your new password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await authAPI.resetPassword({ token, email, password });
      setDone(true);
    } catch (err) {
      setError(err?.response?.data?.message || "Could not reset your password. Please try again.");
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
          <h2>Set a new password</h2>

          {!linkValid ? (
            <>
              <div className="error-message" role="alert">
                This reset link is incomplete or malformed. Request a new one from the login page.
              </div>
              <p className="auth-link">
                <Link to="/forgot-password">Request a new link</Link>
              </p>
            </>
          ) : done ? (
            <>
              <div className="auth-notice" role="status" aria-live="polite">
                Your password has been reset. You can now sign in with your new password.
              </div>
              <button type="button" className="auth-button" onClick={() => navigate("/login")}>
                Go to login
              </button>
            </>
          ) : (
            <>
              <p className="auth-subtitle">
                Choose a new password for <strong>{email}</strong>.
              </p>

              {error && (
                <div className="error-message" role="alert" aria-live="polite">
                  {error}
                </div>
              )}

              <form className="auth-form" onSubmit={handleSubmit} noValidate>
                <div className="form-group">
                  <label htmlFor="password">New password</label>
                  <div className="password-container">
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                      disabled={loading}
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      disabled={loading}
                    >
                      {showPassword ? <FaEyeSlash /> : <FaEye />}
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="confirm">Confirm new password</label>
                  <input
                    id="confirm"
                    type={showPassword ? "text" : "password"}
                    placeholder="Re-enter your new password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="new-password"
                    required
                    disabled={loading}
                  />
                </div>

                <button type="submit" className="auth-button" disabled={loading}>
                  {loading ? "Resetting..." : "Reset password"}
                </button>
              </form>

              <p className="auth-link">
                <Link to="/login">Back to login</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
