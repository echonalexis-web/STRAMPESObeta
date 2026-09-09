import { useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { authAPI } from "../services/api";
import "../styles/auth.css";
import { FaEye, FaEyeSlash } from "react-icons/fa";

const normalizeRole = (role) => (role === "employee" || role === "jobseeker" ? "resident" : role);

const routeForRole = (role) => {
  const r = normalizeRole(role);
  if (r === "superadmin") return "/superadmin";
  if (r === "admin") return "/admin";
  if (r === "employer") return "/employer-dashboard";
  return "/dashboard";
};

export default function ChangePassword() {
  const { user, setUser } = useContext(AuthContext);
  const navigate = useNavigate();

  const forced = user?.mustChangePassword === true;

  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onChange = (e) => {
    if (error) setError("");
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.currentPassword || !form.newPassword) {
      setError("Fill in your current and new password.");
      return;
    }
    if (form.newPassword.length < 8) {
      setError("Your new password must be at least 8 characters.");
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setError("The new password and its confirmation don't match.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await authAPI.changePassword({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      setUser((prev) => (prev ? { ...prev, mustChangePassword: false } : prev));
      navigate(routeForRole(user?.role), { replace: true });
    } catch (err) {
      setError(err?.response?.data?.message || "Could not change your password. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-panel">
        <div className="auth-card" style={{ margin: "0 auto" }}>
          <h2>{forced ? "Set your password" : "Change password"}</h2>
          <p className="auth-subtitle">
            {forced
              ? "Your account was created with a temporary password. Choose your own to continue."
              : "Update the password you use to sign in."}
          </p>

          {error && (
            <div className="error-message" role="alert" aria-live="polite">
              {error}
            </div>
          )}

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label htmlFor="currentPassword">
                {forced ? "Temporary password" : "Current password"}
              </label>
              <input
                id="currentPassword"
                type={show ? "text" : "password"}
                name="currentPassword"
                value={form.currentPassword}
                onChange={onChange}
                autoComplete="current-password"
                disabled={submitting}
              />
            </div>

            <div className="form-group">
              <label htmlFor="newPassword">New password</label>
              <div className="password-container">
                <input
                  id="newPassword"
                  type={show ? "text" : "password"}
                  name="newPassword"
                  value={form.newPassword}
                  onChange={onChange}
                  autoComplete="new-password"
                  disabled={submitting}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? "Hide passwords" : "Show passwords"}
                  disabled={submitting}
                >
                  {show ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm new password</label>
              <input
                id="confirmPassword"
                type={show ? "text" : "password"}
                name="confirmPassword"
                value={form.confirmPassword}
                onChange={onChange}
                autoComplete="new-password"
                disabled={submitting}
              />
            </div>

            <button type="submit" className="auth-button" disabled={submitting}>
              {submitting ? "Saving…" : "Save password"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
