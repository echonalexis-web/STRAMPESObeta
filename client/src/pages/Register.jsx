import { useState, useContext, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { authAPI } from "../services/api";
import GoogleSignInButton from "../components/GoogleSignInButton";
import "../styles/auth.css";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import pesoLogo from "../assets/images/peso-logo.png";
import provincialSeal from "../assets/images/provincial-seal.png";

const normalizeRole = (role) => (role === "employee" || role === "jobseeker" ? "resident" : role);

const formatApiError = (err, fallback = "Registration failed") => {
  const status = err?.response?.status;
  const data = err?.response?.data;

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
    surname: "",
    firstName: "",
    middleName: "",
    suffix: "",
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

    // ─── Empty-field validation ───
    const newTouched = { surname: true, firstName: true, email: true, password: true };
    setTouched(newTouched);

    if (!formData.surname.trim() && !formData.firstName.trim() && !formData.email.trim() && !formData.password) {
      setError("Please fill in all required fields.");
      return;
    }
    if (!formData.surname.trim()) {
      setError("Please enter your surname.");
      return;
    }
    if (!formData.firstName.trim()) {
      setError("Please enter your first name.");
      return;
    }
    if (!formData.email.trim()) {
      setError("Please enter your email address.");
      return;
    }
    if (!formData.password) {
      setError("Please enter a password.");
      return;
    }

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
    if (formData.surname.trim().length < 2 || formData.firstName.trim().length < 2) {
      setError("Please enter your full name.");
      return;
    }

    setLoading(true);

    try {
      const normalizedEmail = formData.email.trim().toLowerCase();
      const surname = formData.surname.trim();
      const firstName = formData.firstName.trim();
      const middleName = formData.middleName.trim();
      const suffix = formData.suffix.trim();
      const composedName = [firstName, middleName, surname, suffix].filter(Boolean).join(" ");

      const registerResponse = await authAPI.register({
        name: composedName,
        surname,
        firstName,
        middleName,
        suffix,
        email: normalizedEmail,
        password: formData.password,
        role: "employee",
      });

      const registeredHasCompletedOnboarding =
        typeof registerResponse.data?.hasCompletedOnboarding === "boolean"
          ? registerResponse.data.hasCompletedOnboarding
          : registerResponse.data?.onboardingComplete;

      const { data: loginResponse } = await authAPI.login({
        email: normalizedEmail,
        password: formData.password,
      });

      if (!loginResponse.token || !loginResponse.user) {
        throw new Error("Invalid response from server");
      }

      let profileData = null;
      try {
        const profileResponse = await authAPI.getProfile();
        if (profileResponse && profileResponse.data) {
          profileData = profileResponse.data;
        }
      } catch (profileErr) {
        console.warn("Could not fetch profile on registration:", profileErr);
        // Profile fetch is optional - user will be created successfully even if this fails
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

  const handleGoogleCredential = async (credential) => {
    setError("");
    setLoading(true);
    try {
      const { data } = await authAPI.google(credential);
      const token = data.token;
      const userData = data.user || {};
      if (!token) throw new Error("Invalid response from server");

      const mergedUser = { ...userData, role: normalizeRole(userData.role) };
      login(token, mergedUser);

      const onboardingDone =
        typeof mergedUser.hasCompletedOnboarding === "boolean"
          ? mergedUser.hasCompletedOnboarding
          : mergedUser.onboardingComplete;

      // New Google users land here with no completed onboarding → pick a role.
      if (data.isNewUser || onboardingDone === false) {
        navigate("/onboarding");
      } else {
        navigate(getDefaultRouteByRole(mergedUser.role));
      }
    } catch (err) {
      console.error("Google sign-in error:", err);
      const d = err?.response?.data;
      if (err?.response?.status === 403 && d?.code === "ACCOUNT_SUSPENDED") {
        if (d.appealToken) localStorage.setItem("appealToken", d.appealToken);
        localStorage.setItem(
          "suspensionInfo",
          JSON.stringify({
            accountStatus: d.accountStatus || "suspended",
            suspensionReason: d.suspensionReason || null,
            suspendedAt: d.suspendedAt || null,
          })
        );
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        navigate("/account-suspended");
        return;
      }
      setError(formatApiError(err, "Google sign-in failed"));
      setLoading(false);
    }
  };

  const showPasswordRequirements = touched.password && passwordErrors.length > 0 && isPasswordFocused;
  const showPasswordSuccess = touched.password && passwordErrors.length === 0 && formData.password.length > 0;

  return (
    <div className="auth-container">
      <div className="auth-panel">
        {/* ─── Branding Side ─── */}
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
              Ialawigan ng Marinduque
            </div>
          </div>
        </div>

        {/* ─── Form Side ─── */}
        <div className="auth-card">
          <h2>Create Account</h2>
          <p className="auth-subtitle">Register now to discover local jobs and join the STRAM PESO community.</p>

          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="surname">Surname</label>
                <input
                  id="surname"
                  type="text"
                  name="surname"
                  placeholder="Dela Cruz"
                  value={formData.surname}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  onFocus={handleFocus}
                  required
                  disabled={loading}
                  autoComplete="family-name"
                  className={touched.surname && !formData.surname.trim() ? "is-error" : ""}
                />
              </div>
              <div className="form-group">
                <label htmlFor="firstName">First Name</label>
                <input
                  id="firstName"
                  type="text"
                  name="firstName"
                  placeholder="Juan"
                  value={formData.firstName}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  onFocus={handleFocus}
                  required
                  disabled={loading}
                  autoComplete="given-name"
                  className={touched.firstName && !formData.firstName.trim() ? "is-error" : ""}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="middleName">Middle Name <span className="optional-label">(optional)</span></label>
                <input
                  id="middleName"
                  type="text"
                  name="middleName"
                  placeholder="Santos"
                  value={formData.middleName}
                  onChange={handleChange}
                  disabled={loading}
                  autoComplete="additional-name"
                />
              </div>
              <div className="form-group">
                <label htmlFor="suffix">Suffix <span className="optional-label">(optional)</span></label>
                <input
                  id="suffix"
                  type="text"
                  name="suffix"
                  placeholder="Jr., III, etc."
                  value={formData.suffix}
                  onChange={handleChange}
                  disabled={loading}
                  autoComplete="honorific-suffix"
                />
              </div>
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
                className={touched.email && !formData.email.trim() ? "is-error" : ""}
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
                  className={touched.password && !formData.password ? "is-error" : ""}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex="-1"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  disabled={loading}
                >
                  {showPassword ? <FaEyeSlash /> : <FaEye />}
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

          <GoogleSignInButton onCredential={handleGoogleCredential} text="signup_with" />

          <p className="auth-link">
            Already have an account? <Link to="/login" onClick={(e) => {
              if (loading) e.preventDefault();
            }}>Log in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}