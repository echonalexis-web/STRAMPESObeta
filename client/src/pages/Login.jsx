import { useState, useContext, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { authAPI } from "../services/api";
import "../styles/auth.css";
import { FaEye, FaEyeSlash } from "react-icons/fa";

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

  const safeData =
    typeof data === "object" && data !== null
      ? JSON.stringify(data)
      : String(data || "none");

  return `${fallback} | status:${status || "none"} | code:${err?.code || "none"}`;
};

export default function Login() {
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const { login, user } = useContext(AuthContext);
  const navigate = useNavigate();

  // Redirect if already logged in
  useEffect(() => {
    if (user && !isRedirecting) {
      const role = normalizeRole(user.role);
      if (role === "admin") {
        navigate("/admin");
      } else if (role === "employer") {
        navigate("/employer-dashboard");
      } else {
        navigate("/dashboard");
      }
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

  const togglePasswordVisibility = () => {
    setShowPassword((prev) => !prev);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Basic validation
    if (!formData.email.trim() || !formData.password) {
      setError("Please enter both email and password");
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
      
      if (!data.token || !data.user) {
        throw new Error("Invalid response from server");
      }

      // Get user profile for complete data
      let profileData = null;
      try {
        const profileResponse = await authAPI.getProfile();
        profileData = profileResponse.data;
      } catch (profileErr) {
        console.warn("Could not fetch profile, using login data:", profileErr);
      }

      const mergedUser = {
        ...data.user,
        ...(profileData || {}),
        role: normalizeRole(profileData?.role || data.user?.role),
      };

      // Store auth data
      login(data.token, mergedUser);

      // Check onboarding status
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
      setError(formatApiError(err, "Login failed"));
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h2>Login</h2>
        <p className="auth-subtitle">Access your account to view jobs and manage applications.</p>

        {error && (
          <div className="error-message" role="alert" aria-live="polite">
            {error}
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
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
          Don't have an account? <Link to="/register" onClick={(e) => {
            if (loading || isRedirecting) e.preventDefault();
          }}>Register</Link>
        </p>
      </div>
    </div>
  );
}