import { useContext, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { authAPI } from "../services/api";
import "../styles/auth.css";
import pesoLogo from "../assets/images/peso-logo.png";
import provincialSeal from "../assets/images/provincial-seal.png";

export default function VerifyEmail() {
  const navigate = useNavigate();
  const { logout } = useContext(AuthContext);
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
        const { data } = await authAPI.confirmEmailChange({ token, email });
        // The sign-in email just changed — drop the current session so the user
        // re-authenticates with the new address.
        logout();
        setMessage(data.message || "Your email address has been updated.");
        setStatus("done");
      } catch (err) {
        setMessage(
          err?.response?.data?.message ||
            "This confirmation link is invalid or has expired. Start the change again from Edit Profile."
        );
        setStatus("error");
      }
    })();
  }, [linkValid, token, email, logout]);

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
          <h2>Confirm email change</h2>

          {status === "invalid" && (
            <>
              <div className="error-message" role="alert">
                This confirmation link is incomplete or malformed.
              </div>
              <p className="auth-link">
                <Link to="/profile/edit">Back to Edit Profile</Link>
              </p>
            </>
          )}

          {status === "verifying" && (
            <p className="auth-subtitle">Confirming <strong>{email}</strong>…</p>
          )}

          {status === "done" && (
            <>
              <div className="auth-notice" role="status" aria-live="polite">
                {message} You can now sign in with <strong>{email}</strong>.
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
                <Link to="/profile/edit">Back to Edit Profile</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
