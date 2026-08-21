import { useState, useContext, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { authAPI } from "../services/api";
import "../styles/auth.css";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import pesoLogo from "../assets/images/peso-logo.png";
import provincialSeal from "../assets/images/provincial-seal.png";

const normalizeRole = (role) => (role === "employee" || role === "jobseeker" ? "resident" : role);

const formatApiError = (err, fallback = "Login failed") => {
  const status = err?.response?.status;
  const data = err?.response?.data;

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

export default function Login() {
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [touched, setTouched] = useState({});
  const { login, user } = useContext(AuthContext);
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

  useEffect(() => {
    if (user && !isRedirecting) {
      const role = normalizeRole(user.role);
      if (role === "admin") navigate("/admin");
      else if (role === "employer") navigate("/employer-dashboard");
      else navigate("/dashboard");
    }
  }, [user, navigate, isRedirecting]);

  const getDefaultRouteByRole = (role) => {
    const normalizedRole = normalizeRole(role);
    if (normalizedRole === "admin") return "/admin";
    if (normalizedRole === "employer") return "/employer-dashboard";
    return "/dashboard";
  };

  const handleChange = (e) => {
    if (error) setError("");
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const togglePasswordVisibility = () => setShowPassword((prev) => !prev);

  const handleSubmit = async (e) => {
    e.preventDefault();

    // ─── Empty-field validation ───
    const newTouched = { email: true, password: true };
    setTouched(newTouched);

    if (!formData.email.trim() && !formData.password) {
      setError("Please enter your email and password.");
      return;
    }
    if (!formData.email.trim()) {
      setError("Please enter your email address.");
      return;
    }
    if (!formData.password) {
      setError("Please enter your password.");
      return;
    }

    setLoading(true);
    setError("");
    setIsRedirecting(false);

    try {
      const loginPayload = {
        email: formData.email.trim().toLowerCase(),
        password: formData.password,
      };

      const { data } = await authAPI.login(loginPayload);

      console.log("🔐 Login response:", data);

      const token = data.token || data.accessToken || data.data?.token || data.data?.accessToken;
      if (!token) {
        console.error("❌ No token found in response:", data);
        throw new Error("No token received from server");
      }

      let userData = data.user || data.data?.user || data;
      if (!userData._id && !userData.id) {
        userData = data;
      }

      const normalizedUser = { ...userData, role: normalizeRole(userData.role) };
      login(token, normalizedUser);

      let profileData = null;
      try {
        const profileResponse = await authAPI.getProfile();
        profileData = profileResponse.data;
        console.log("✅ Profile fetched successfully:", profileData);
      } catch (profileErr) {
        console.warn("⚠️ Could not fetch profile, using login data:", profileErr);
      }

      const mergedUser = {
        ...normalizedUser,
        ...(profileData || {}),
        role: normalizeRole(profileData?.role || normalizedUser.role),
      };

      login(token, mergedUser);

      const hasCompletedOnboarding =
        typeof mergedUser?.hasCompletedOnboarding === "boolean"
          ? mergedUser.hasCompletedOnboarding
          : mergedUser?.onboardingComplete;

      const role = normalizeRole(mergedUser?.role);

      if (["resident", "employer"].includes(role) && hasCompletedOnboarding === false) {
        setIsRedirecting(true);
        navigate("/onboarding");
        return;
      }

      setIsRedirecting(true);
      navigate(getDefaultRouteByRole(role));
    } catch (err) {
      console.error("❌ Login error:", err);
      setError(formatApiError(err, "Login failed"));
      setLoading(false);
    }
  };

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
              Lalawigan ng Marinduque
            </div>
          </div>
        </div>

        {/* ─── Form Side ─── */}
        <div className="auth-card">
          <h2>Login</h2>
          <p className="auth-subtitle">Access your account to view jobs and manage applications.</p>

          {error && (
            <div className="error-message" role="alert" aria-live="polite">
              {error}
            </div>
          )}

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label htmlFor="email">Email Address</label>
              <input
                id="email"
                type="email"
                name="email"
                placeholder="Enter your email"
                value={formData.email}
                onChange={handleChange}
                required
                disabled={loading || isRedirecting}
                autoComplete="email"
                className={touched.email && !formData.email.trim() ? "is-error" : ""}
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <div className="password-container">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  name="password"
                  placeholder="Enter your password"
                  value={formData.password}
                  onChange={handleChange}
                  required
                  disabled={loading || isRedirecting}
                  autoComplete="current-password"
                  className={touched.password && !formData.password ? "is-error" : ""}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={togglePasswordVisibility}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  disabled={loading || isRedirecting}
                >
                  {showPassword ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="auth-button"
              disabled={loading || isRedirecting}
            >
              {loading ? "Logging in..." : isRedirecting ? "Redirecting..." : "Login"}
            </button>
          </form>

          <p className="auth-link">
            Don't have an account? <Link to="/register">Register</Link>
          </p>
        </div>
      </div>
    </div>
  );
}