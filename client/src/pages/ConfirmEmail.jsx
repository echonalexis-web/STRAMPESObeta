import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { authAPI } from "../services/api";
import "../styles/auth.css";
import pesoLogo from "../assets/images/peso-logo.png";
import provincialSeal from "../assets/images/provincial-seal.png";

// Confirms a NEW account's registration email (the link sent by
// register()/registerEmployer()). Deliberately separate from VerifyEmail.jsx,
// which confirms a change to an EXISTING account's email — different tokens,
// different backend flow, different page so neither can regress the other.
export default function ConfirmEmail() {
  const navigate = useNavigate();
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
        const { data } = await authAPI.confirmEmailVerification({ token, email });
        setMessage(data.message || "Your email has been verified.");
        setStatus("done");
      } catch (err) {
        setMessage(
          err?.response?.data?.message ||
            "This verification link is invalid or has expired. Request a new one from the login page."
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
          <h2>Verify your email</h2>

          {status === "invalid" && (
            <>
              <div className="error-message" role="alert">
                This verification link is incomplete or malformed.
              </div>
              <p className="auth-link">
                <Link to="/login">Back to login</Link>
              </p>
            </>
          )}

          {status === "verifying" && (
            <p className="auth-subtitle">Verifying <strong>{email}</strong>…</p>
          )}

          {status === "done" && (
            <>
              <div className="auth-notice" role="status" aria-live="polite">
                {message}
              </div>
              <button type="button" className="auth-button" onClick={() => navigate("/login")}>
                Go to login
              </button>
            </>
          )}

          {status === "error" && (
            <>
              <div className="error-message" role="alert">
                {message}
              </div>
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
