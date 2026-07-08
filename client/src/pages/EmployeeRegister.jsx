import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authAPI } from "../services/api";
import "../styles/auth.css";

const validatePassword = (password) => {
  const errors = [];
  if (password.length < 8) {
    errors.push("at least 8 characters");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("one uppercase letter");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("one lowercase letter");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("one number");
  }
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push("one special character");
  }
  return errors;
};

const formatApiError = (err, fallback = "Registration failed") => {
  const status = err?.response?.status;
  const data = err?.response?.data;

  // Handle duplicate email specifically
  if (data?.message?.toLowerCase().includes("email") && 
      (data?.message?.toLowerCase().includes("already") || 
       data?.message?.toLowerCase().includes("exists") ||
       data?.message?.toLowerCase().includes("taken"))) {
    return "This email is already registered. Please use a different email or log in.";
  }

  // Handle invalid invite code
  if (data?.message?.toLowerCase().includes("invite") || 
      data?.message?.toLowerCase().includes("invalid") ||
      data?.message?.toLowerCase().includes("not found")) {
    return "Invalid or expired invite code. Please check with your administrator.";
  }

  if (data?.errors && typeof data.errors === "object") {
    const messages = Object.values(data.errors).flat();
    if (messages.length > 0) {
      return messages.join(" ");
    }
  }

  if (Array.isArray(data?.errors) && data.errors.length > 0) {
    const message = data.errors.join(" ");
    return status ? `${message} (HTTP ${status})` : message;
  }

  if (typeof data === "string" && data.trim()) {
    return status ? `${data} (HTTP ${status})` : data;
  }

  const message = data?.message || data?.error || err?.message;

  if (message) {
    return status ? `${message} (HTTP ${status})` : message;
  }

  if (err?.code === "ERR_NETWORK") {
    return "Network error: Cannot connect to server. Please check your connection.";
  }

  if (err?.code === "ECONNABORTED") {
    return "Request timed out. Please try again.";
  }

  return fallback;
};

export default function EmployerRegister() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    inviteCode: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState([]);
  const [touched, setTouched] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });

    if (name === "password") {
      const errors = validatePassword(value);
      setPasswordErrors(errors);
      // Auto-clear error when user starts typing
      if (error && error.includes("email")) {
        setError("");
      }
    }
  };

  const handleBlur = (e) => {
    const { name } = e.target;
    setTouched({ ...touched, [name]: true });
    if (name === "password") {
      setIsPasswordFocused(false);
    }
  };

  const handleFocus = (e) => {
    if (e.target.name === "password") {
      setIsPasswordFocused(true);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    // Validate password
    const passwordValidationErrors = validatePassword(formData.password);
    if (passwordValidationErrors.length > 0) {
      setPasswordErrors(passwordValidationErrors);
      return;
    }

    // Basic email validation
    if (!formData.email.includes("@") || !formData.email.includes(".")) {
      setError("Please enter a valid email address.");
      return;
    }

    // Name validation
    if (formData.name.trim().length < 2) {
      setError("Please enter your full name.");
      return;
    }

    // Invite code validation
    if (!formData.inviteCode.trim()) {
      setError("Please enter an invite code.");
      return;
    }

    setLoading(true);

    try {
      const trimmedData = {
        name: formData.name.trim(),
        email: formData.email.trim().toLowerCase(),
        password: formData.password,
        inviteCode: formData.inviteCode.trim(),
      };

      const response = await authAPI.registerEmployer(trimmedData);
      
      // Check if registration succeeded
      if (response.data?.message || response.status === 201 || response.status === 200) {
        setSuccess("Employer account created successfully! You can now log in.");
        // Clear form
        setFormData({
          name: "",
          email: "",
          password: "",
          inviteCode: "",
        });
        setTouched({});
        // Redirect after 2 seconds
        setTimeout(() => {
          navigate("/login");
        }, 2000);
      }
    } catch (err) {
      console.error("Registration error:", err);
      setError(formatApiError(err, "Registration failed. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  // Determine if password requirements should be shown
  const showPasswordRequirements = touched.password && passwordErrors.length > 0 && isPasswordFocused;
  const showPasswordSuccess = touched.password && passwordErrors.length === 0 && formData.password.length > 0;

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h2>Register as Employer</h2>
        <p className="auth-subtitle">Create an employer account to post vacancies and manage applicants.</p>

        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}

        {success && (
          <div className="success-message" role="alert">
            {success}
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="name">Full Name</label>
            <input
              id="name"
              type="text"
              name="name"
              placeholder="Enter your full name"
              value={formData.name}
              onChange={handleChange}
              onBlur={handleBlur}
              onFocus={handleFocus}
              required
              disabled={loading}
              autoComplete="name"
              className={touched.name && formData.name.trim().length < 2 && formData.name.length > 0 ? "is-error" : ""}
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              id="email"
              type="email"
              name="email"
              placeholder="Enter your email"
              value={formData.email}
              onChange={handleChange}
              onBlur={handleBlur}
              onFocus={handleFocus}
              required
              disabled={loading}
              autoComplete="email"
              className={touched.email && (!formData.email.includes("@") || !formData.email.includes(".")) && formData.email.length > 0 ? "is-error" : ""}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <div className="password-wrapper">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                name="password"
                placeholder="Create a password"
                value={formData.password}
                onChange={handleChange}
                onBlur={handleBlur}
                onFocus={handleFocus}
                required
                disabled={loading}
                autoComplete="new-password"
                className={touched.password && passwordErrors.length > 0 ? "is-error" : ""}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex="-1"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "🙈" : "👁️"}
              </button>
            </div>

            {showPasswordRequirements && (
              <div className="password-requirements">
                <span className="password-requirements-title">Password must contain:</span>
                {passwordErrors.map((err, index) => (
                  <span key={index} className="password-error">• {err}</span>
                ))}
              </div>
            )}

            {showPasswordSuccess && (
              <span className="password-valid">✓ Password meets all requirements</span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="inviteCode">Invite Code</label>
            <input
              id="inviteCode"
              type="text"
              name="inviteCode"
              placeholder="Enter your invite code"
              value={formData.inviteCode}
              onChange={handleChange}
              onBlur={handleBlur}
              onFocus={handleFocus}
              required
              disabled={loading}
              autoComplete="off"
              className={touched.inviteCode && !formData.inviteCode.trim() && formData.inviteCode.length > 0 ? "is-error" : ""}
            />
          </div>

          <button type="submit" className="auth-button" disabled={loading}>
            {loading ? "Creating Account..." : "Create Employer Account"}
          </button>
        </form>

        <p className="auth-link">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}