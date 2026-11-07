import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { authAPI } from "../services/api";
import "../styles/auth.css";
import pesoLogo from "../assets/images/peso-logo.png";
import provincialSeal from "../assets/images/provincial-seal.png";

// Unlike VerifyEmail (confirming a changed SIGN-IN email, which logs the
// user out so they re-authenticate with the new address), confirming a
// recovery email changes nothing about how this account signs in — so
// there's no session to drop here.
export default function VerifyRecoveryEmail() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const email = params.get("email") || "";
  const linkValid = Boolean(token && email);

  // "verifying" -> "done" | "error"
  const [status, setStatus] = useState(linkValid ? "verifying" : "invalid");
  const [message, setMessage] = useState("");
  const ranRef = useRef(false);

  useEffect(() => {
    if (!linkValid || ranRef.current) return;
    ranRef.current = true;

    (async () => {
      try {
        const { data } = await authAPI.confirmRecoveryEmail({ token, email });
        setMessage(data.message || "Your recovery email has been confirmed.");
        setStatus("done");
      } catch (err) {
        setMessage(
          err?.response?.data?.message ||
            "This confirmation link is invalid or has expired. Start again from Settings."
        );
        setStatus("error");
      }
    })();
  }, [linkValid, token, email]);

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
          <h2>Confirm recovery email</h2>

          {status === "invalid" && (
            <>
              <div className="error-message" role="alert">
                This confirmation link is incomplete or malformed.
              </div>
              <p className="auth-link">
                <Link to="/settings">Back to Settings</Link>
              </p>
            </>
          )}

          {status === "verifying" && (
            <p className="auth-subtitle">Confirming <strong>{email}</strong>…</p>
          )}

          {status === "done" && (
            <>
              <div className="auth-notice" role="status" aria-live="polite">
                {message} You can now sign in with <strong>{email}</strong> as a recovery
                address, or use it to receive a password reset link if you ever lose access
                to your regular sign-in email.
              </div>
              <p className="auth-link">
                <Link to="/settings">Back to Settings</Link>
              </p>
            </>
          )}

          {status === "error" && (
            <>
              <div className="error-message" role="alert">
                {message}
              </div>
              <p className="auth-link">
                <Link to="/settings">Back to Settings</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
