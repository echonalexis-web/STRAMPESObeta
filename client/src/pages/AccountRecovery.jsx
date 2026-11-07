import { useContext, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthContext } from "../context/AuthContext";
import { authAPI } from "../services/api";
import "../styles/auth.css";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import pesoLogo from "../assets/images/peso-logo.png";
import provincialSeal from "../assets/images/provincial-seal.png";

const normalizeRole = (role) => (role === "employee" || role === "resident" ? "jobseeker" : role);

const getDefaultRouteByRole = (role) => {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === "superadmin") return "/superadmin";
  if (normalizedRole === "admin") return "/admin";
  if (normalizedRole === "employer") return "/employer-dashboard";
  return "/dashboard";
};

// Kept in sessionStorage (not React state alone) so an accidental page
// refresh right after redeeming a code doesn't strand the user on a dead
// form — the code itself is already single-use and spent server-side the
// moment it was redeemed, so losing this token without persistence would
// mean burning a second code just to get back to the same step. Cleared on
// tab close (unlike localStorage) since this token is short-lived (15 min)
// and single-purpose.
const RECOVERY_TOKEN_KEY = "recoveryToken";

// Self-service "I have neither my password nor Google access" recovery —
// the one path that needs neither (see
// markdowns/NOTIF_EMAIL_ID_OCR_AND_ACCOUNT_RECOVERY_PLAN.md §4.4). Two
// steps: redeem a backup code for a short-lived recovery token, then use it
// once to set a new password.
export default function AccountRecovery() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login } = useContext(AuthContext);

  const storedToken = sessionStorage.getItem(RECOVERY_TOKEN_KEY) || "";
  const [step, setStep] = useState(storedToken ? "password" : "code");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [recoveryToken, setRecoveryToken] = useState(storedToken);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleRedeem = async (event) => {
    event.preventDefault();
    if (!identifier.trim() || !code.trim()) {
      setError("Enter your email or username, and a backup code.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const { data } = await authAPI.redeemBackupCode(identifier.trim(), code.trim());
      sessionStorage.setItem(RECOVERY_TOKEN_KEY, data.recoveryToken);
      setRecoveryToken(data.recoveryToken);
      setStep("password");
    } catch (err) {
      setError(
        err?.response?.data?.message || "That code didn't work. Check it and try again, or contact the PESO office."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSetPassword = async (event) => {
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
      const { data } = await authAPI.recoverSetPassword(recoveryToken, password);
      sessionStorage.removeItem(RECOVERY_TOKEN_KEY);
      const mergedUser = await login(data.token, {});
      navigate(getDefaultRouteByRole(mergedUser?.role), { replace: true });
    } catch (err) {
      setError(err?.response?.data?.message || "Could not set your new password. Please try again.");
      // A 403 here means the recovery token itself no longer works (it
      // expired, or was already used) — send back to redeem a fresh code
      // instead of leaving the form stuck with no way forward.
      if (err?.response?.status === 403) {
        sessionStorage.removeItem(RECOVERY_TOKEN_KEY);
        setRecoveryToken("");
        setStep("code");
      }
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
          <h2>Recover your account</h2>

          {error && (
            <div className="error-message" role="alert" aria-live="polite">
              {error}
            </div>
          )}

          {step === "code" && (
            <>
              <p className="auth-subtitle">
                For when you can't sign in with your password or Google, and can't access your
                email either. Enter your email or username and one of your backup codes — each
                one works only once.
              </p>
              <form className="auth-form" onSubmit={handleRedeem} noValidate>
                <div className="form-group">
                  <label htmlFor="identifier">Email or username</label>
                  <input
                    id="identifier"
                    type="text"
                    placeholder="Email or username"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    autoComplete="username"
                    required
                    disabled={loading}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="code">Backup code</label>
                  <input
                    id="code"
                    type="text"
                    placeholder="XXXX-XXXX"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoComplete="one-time-code"
                    required
                    disabled={loading}
                  />
                </div>
                <button type="submit" className="auth-button" disabled={loading}>
                  {loading ? "Checking..." : "Continue"}
                </button>
              </form>
            </>
          )}

          {step === "password" && (
            <>
              <p className="auth-subtitle">Code accepted. Choose a new password to finish recovering your account.</p>
              <form className="auth-form" onSubmit={handleSetPassword} noValidate>
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
                  {loading ? "Setting..." : "Set new password & sign in"}
                </button>
              </form>
            </>
          )}

          <p className="auth-link"><Link to="/staff-account-recovery">{t("staffRecovery.requestLink")}</Link></p>
          <p className="auth-link">
            <Link to="/login">Back to login</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
