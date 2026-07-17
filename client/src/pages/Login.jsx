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

  return fallback;
};

export default function Login() {
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const { login, user } = useContext(AuthContext);
  const navigate = useNavigate();

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

      // 🔍 DEBUG: log the raw response
      console.log("🔐 Login response:", data);

      // Extract token – handle different response structures
      const token = data.token || data.accessToken || data.data?.token || data.data?.accessToken;
      if (!token) {
        console.error("❌ No token found in response:", data);
        throw new Error("No token received from server");
      }

      // Build user object from login response
      let userData = data.user || data.data?.user || data;
      if (!userData._id && !userData.id) {
        // fallback: the whole response might be the user
        userData = data;
      }

      // 🔹 STEP 1: Store token and user immediately
      const normalizedUser = { ...userData, role: normalizeRole(userData.role) };
      login(token, normalizedUser); // this sets localStorage and state

      // 🔹 STEP 2: Now fetch full profile with the stored token
      let profileData = null;
      try {
        const profileResponse = await authAPI.getProfile();
        profileData = profileResponse.data;
        console.log("✅ Profile fetched successfully:", profileData);
      } catch (profileErr) {
        console.warn("⚠️ Could not fetch profile, using login data:", profileErr);
      }

      // 🔹 STEP 3: Merge profile data if available
      const mergedUser = {
        ...normalizedUser,
        ...(profileData || {}),
        role: normalizeRole(profileData?.role || normalizedUser.role),
      };

      // Update user state with merged data
      login(token, mergedUser); // update user in context and localStorage

      // Check onboarding
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
          Don't have an account? <Link to="/register">Register</Link>
        </p>
      </div>
    </div>
  );
}