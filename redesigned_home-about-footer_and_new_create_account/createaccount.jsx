import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import "../styles/auth.css";
import { FaEye, FaEyeSlash, FaUserShield, FaUserTie } from "react-icons/fa";

/* ─── Draft Placeholders (Replace with local image imports when ready) ─── */
const draftLogoPlaceholder =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><circle cx='50' cy='50' r='48' fill='%2315803d' stroke='%23ffcc00' stroke-width='4'/><text x='50%' y='55%' font-weight='bold' font-size='18' fill='%23ffffff' text-anchor='middle'>PESO</text></svg>";

const draftSealPlaceholder =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'><circle cx='40' cy='40' r='38' fill='none' stroke='%23eab308' stroke-width='3' stroke-dasharray='4,4'/><text x='50%' y='55%' font-size='12' fill='%23ffffff' text-anchor='middle'>SEAL</text></svg>";

export default function CreateAccount() {
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
    role: "staff",
    department: "Employment Services",
    password: "",
    confirmPassword: "",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  /* ─── Spotlight mouse tracking ─── */
  useEffect(() => {
    const container = document.querySelector(".auth-container");
    if (!container) return;

    const handleMouseMove = (e) => {
      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      container.style.setProperty("--x", `${x}%`);
      container.style.setProperty("--y", `${y}%`);
    };

    container.addEventListener("mousemove", handleMouseMove);
    return () => container.removeEventListener("mousemove", handleMouseMove);
  }, []);

  const handleChange = (e) => {
    if (error) setError("");
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleRoleSelect = (role) => {
    setFormData((prev) => ({ ...prev, role }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!formData.fullName.trim() || !formData.email.trim() || !formData.password) {
      setError("Please fill in all required fields.");
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setSuccess(
        `Account successfully created for ${formData.fullName} (${formData.role.toUpperCase()})!`
      );
      setFormData({
        fullName: "",
        email: "",
        phone: "",
        role: "staff",
        department: "Employment Services",
        password: "",
        confirmPassword: "",
      });
    } catch (err) {
      setError("Failed to create account. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-panel">
        {/* ─── Branding Side ─── */}
        <div className="auth-branding">
          <div className="auth-branding-content">
            <img
              src={draftLogoPlaceholder}
              alt="PESO Logo Draft"
              className="auth-branding-logo"
            />
            <h1 className="auth-branding-title">SYSTEM ADMIN</h1>
            <p className="auth-branding-tagline">Personnel Onboarding</p>
            <p className="auth-branding-desc">
              Register authorized accounts for Administrators and Staff members to manage platform listings, verifications, and services.
            </p>
            <img
              src={draftSealPlaceholder}
              alt="Provincial Seal Draft"
              className="auth-branding-seal"
            />
            <div className="auth-branding-footer">
              PUBLIC EMPLOYMENT SERVICE OFFICE<br />
              Lalawigan ng Marinduque
            </div>
          </div>
        </div>

        {/* ─── Form Side ─── */}
        <div className="auth-card">
          <h2>Create Account</h2>
          <p className="auth-subtitle">Assign system roles and internal privileges.</p>

          {error && <div className="error-message" role="alert">{error}</div>}
          {success && (
            <div
              className="success-message"
              role="alert"
              style={{
                color: "#166534",
                backgroundColor: "#dcfce7",
                padding: "0.75rem",
                borderRadius: "8px",
                marginBottom: "1rem",
                fontSize: "0.9rem",
              }}
            >
              {success}
            </div>
          )}

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            
            {/* Role Switcher */}
            <div className="form-group">
              <label>Select Role</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <button
                  type="button"
                  onClick={() => handleRoleSelect("staff")}
                  style={{
                    padding: "0.75rem",
                    borderRadius: "8px",
                    border: formData.role === "staff" ? "2px solid #eab308" : "1px solid rgba(255, 255, 255, 0.2)",
                    background: formData.role === "staff" ? "rgba(234, 179, 8, 0.15)" : "rgba(255, 255, 255, 0.05)",
                    color: "#ffffff",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0.5rem",
                    fontWeight: "600",
                  }}
                >
                  <FaUserTie color={formData.role === "staff" ? "#eab308" : "#ffffff"} /> Staff
                </button>
                <button
                  type="button"
                  onClick={() => handleRoleSelect("admin")}
                  style={{
                    padding: "0.75rem",
                    borderRadius: "8px",
                    border: formData.role === "admin" ? "2px solid #eab308" : "1px solid rgba(255, 255, 255, 0.2)",
                    background: formData.role === "admin" ? "rgba(234, 179, 8, 0.15)" : "rgba(255, 255, 255, 0.05)",
                    color: "#ffffff",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0.5rem",
                    fontWeight: "600",
                  }}
                >
                  <FaUserShield color={formData.role === "admin" ? "#eab308" : "#ffffff"} /> Admin
                </button>
              </div>
            </div>

            {/* Inputs */}
            <div className="form-group">
              <label htmlFor="fullName">Full Name</label>
              <input
                id="fullName"
                type="text"
                name="fullName"
                placeholder="e.g. Juan Cruz"
                value={formData.fullName}
                onChange={handleChange}
                required
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="email">Email Address</label>
              <input
                id="email"
                type="email"
                name="email"
                placeholder="official@peso.gov.ph"
                value={formData.email}
                onChange={handleChange}
                required
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="department">Department / Division</label>
              <select
                id="department"
                name="department"
                value={formData.department}
                onChange={handleChange}
                disabled={loading}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  borderRadius: "8px",
                  background: "rgba(0, 0, 0, 0.2)",
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                  color: "#ffffff",
                  outline: "none",
                }}
              >
                <option value="Employment Services" style={{ background: "#14532d" }}>Employment Services</option>
                <option value="Skills & Training" style={{ background: "#14532d" }}>Skills & Training</option>
                <option value="Livelihood Programs" style={{ background: "#14532d" }}>Livelihood Programs</option>
                <option value="Executive Office" style={{ background: "#14532d" }}>Executive Office</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <div className="password-container">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  name="password"
                  placeholder="Enter password"
                  value={formData.password}
                  onChange={handleChange}
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((prev) => !prev)}
                >
                  {showPassword ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <div className="password-container">
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  name="confirmPassword"
                  placeholder="Confirm password"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                >
                  {showConfirmPassword ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>
            </div>

            <button type="submit" className="auth-button" disabled={loading}>
              {loading ? "Creating Account..." : "Create Account"}
            </button>
          </form>

          <p className="auth-link">
            Return to dashboard? <Link to="/admin">Admin Dashboard</Link>
          </p>
        </div>
      </div>
    </div>
  );
}