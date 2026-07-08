import { useState, useContext } from "react";
import { useNavigate, Link } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { authAPI } from "../services/api";
import "../styles/auth.css";

const normalizeRole = (role) => (role === "employee" || role === "jobseeker" ? "resident" : role);

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

// Password strength validation
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

export default function Register() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState([]);
  const [touched, setTouched] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);
  const { login } = useContext(AuthContext);
  const navigate = useNavigate();

  const getDefaultRouteByRole = (role) => {
    const normalizedRole = normalizeRole(role);
    if (normalizedRole === "admin") return "/admin";
    if (normalizedRole === "employer") return "/employer-dashboard";
    return "/dashboard";
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
    
    if (name === "password") {
      const errors = validatePassword(value);
      setPasswordErrors(errors);
      // Auto-clear error when user starts typing again
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
    setPasswordErrors([]);

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

    setLoading(true);

    try {
      const normalizedEmail = formData.email.trim().toLowerCase();

      // ✅ Use the generic /auth/register endpoint with role: "employee"
      const registerResponse = await authAPI.register({
        name: formData.name.trim(),
        email: normalizedEmail,
        password: formData.password,
        role: "employee", // 👈 tells backend this is an applicant account
      });

      const registeredHasCompletedOnboarding =
        typeof registerResponse.data?.hasCompletedOnboarding === "boolean"
          ? registerResponse.data.hasCompletedOnboarding
          : registerResponse.data?.onboardingComplete;

      // Auto-login after registration
      const { data: loginResponse } = await authAPI.login({
        email: normalizedEmail,
        password: formData.password,
      });

      if (!loginResponse.token || !loginResponse.user) {
        throw new Error("Invalid response from server");
      }

      // Get profile data
      let profileData = null;
      try {
        const profileResponse = await authAPI.getProfile();
        profileData = profileResponse.data;
      } catch (profileErr) {
        console.warn("Could not fetch profile:", profileErr);
      }

      const mergedUser = {
        ...loginResponse.user,
        ...(profileData || {}),
        role: normalizeRole(profileData?.role || loginResponse.user?.role),
      };

      login(loginResponse.token, mergedUser);

      const mergedHasCompletedOnboarding =
        typeof mergedUser?.hasCompletedOnboarding === "boolean"
          ? mergedUser.hasCompletedOnboarding
          : mergedUser?.onboardingComplete;

      // Check if onboarding is needed
      if (registeredHasCompletedOnboarding === false || mergedHasCompletedOnboarding === false) {
        navigate("/onboarding");
      } else {
        navigate(getDefaultRouteByRole(mergedUser?.role));
      }
    } catch (err) {
      console.error("Registration error:", err);
      setError(formatApiError(err, "Registration failed"));
      setLoading(false);
    }
  };

  // Determine if password requirements should be shown
  const showPasswordRequirements = touched.password && passwordErrors.length > 0 && isPasswordFocused;
  const showPasswordSuccess = touched.password && passwordErrors.length === 0 && formData.password.length > 0;

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h2>Create Account</h2>
        <p className="auth-subtitle">Register now to discover local jobs and join the STRAM PESO community.</p>

        {error && (
          <div className="error-message" role="alert">
            {error}
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

          <button type="submit" className="auth-button" disabled={loading}>
            {loading ? "Creating Account..." : "Create Account"}
          </button>
        </form>

        <p className="auth-link">
          Already have an account? <Link to="/login" onClick={(e) => {
            if (loading) e.preventDefault();
          }}>Log in</Link>
        </p>
      </div>
    </div>
  );
}