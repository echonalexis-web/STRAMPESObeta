import { useState, useContext, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { authAPI } from "../services/api";
import GoogleSignInButton from "../components/GoogleSignInButton";
import AccountInactiveModal from "../components/AccountInactiveModal";
import { useToast } from "../components/feedback/context";
import "../styles/auth.css";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import pesoLogo from "../assets/images/peso-logo.png";
import provincialSeal from "../assets/images/provincial-seal.png";

const normalizeRole = (role) => (role === "employee" || role === "resident" ? "jobseeker" : role);

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
  // Set when login() is refused with EMAIL_NOT_VERIFIED, so the form can
  // offer to resend the link without making the user retype their email.
  const [unverifiedEmail, setUnverifiedEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [inactiveNotice, setInactiveNotice] = useState(false);
  const { login, user } = useContext(AuthContext);
  const navigate = useNavigate();
  const toast = useToast();

  // A toast alongside the inline banner so the error is seen immediately,
  // regardless of scroll position.
  const showError = (message) => {
    setError(message);
    if (message) toast.error(message);
  };

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

  // One-time notice left behind by the API interceptor when a session was
  // ended mid-visit — self-deactivation, a staff account disabled, or the
  // account being deleted (see services/api.js). Shown as a blocking modal
  // rather than a toast since it's the same "your account is no longer
  // usable" notice a live-suspended session gets via ForcedLogoutListener.
  useEffect(() => {
    const notice = localStorage.getItem("authNotice");
    if (notice) {
      setInactiveNotice(true);
      localStorage.removeItem("authNotice");
    }
  }, []);

  useEffect(() => {
    if (user && !isRedirecting) {
      if (user.mustChangePassword === true) {
        navigate("/change-password");
        return;
      }
      const role = normalizeRole(user.role);
      if (role === "superadmin") navigate("/superadmin");
      else if (role === "admin") navigate("/admin");
      else if (role === "employer") navigate("/employer-dashboard");
      else navigate("/dashboard");
    }
  }, [user, navigate, isRedirecting]);

  const getDefaultRouteByRole = (role) => {
    const normalizedRole = normalizeRole(role);
    if (normalizedRole === "superadmin") return "/superadmin";
    if (normalizedRole === "admin") return "/admin";
    if (normalizedRole === "employer") return "/employer-dashboard";
    return "/dashboard";
  };

  const handleChange = (e) => {
    if (error) showError("");
    if (unverifiedEmail) setUnverifiedEmail("");
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleResendVerification = async () => {
    if (!unverifiedEmail || resending) return;
    setResending(true);
    try {
      const { data } = await authAPI.resendEmailVerification(unverifiedEmail);
      toast.success(
        data?.message || "If that email is registered and not yet verified, a verification link has been sent."
      );
    } catch (err) {
      toast.error(formatApiError(err, "Could not resend the verification email."));
    } finally {
      setResending(false);
    }
  };

  const togglePasswordVisibility = () => setShowPassword((prev) => !prev);

  const handleSubmit = async (e) => {
    e.preventDefault();

    // ─── Empty-field validation ───
    const newTouched = { email: true, password: true };
    setTouched(newTouched);

    if (!formData.email.trim() && !formData.password) {
      showError("Please enter your email and password.");
      return;
    }
    if (!formData.email.trim()) {
      showError("Please enter your email address.");
      return;
    }
    if (!formData.password) {
      showError("Please enter your password.");
      return;
    }

    setLoading(true);
    showError("");
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
      // login() already fetches /auth/profile and merges it in internally —
      // await its result directly instead of also fetching and merging it
      // here ourselves and calling login() a second time with that.
      const mergedUser = await login(token, normalizedUser);

      if (data.reactivated) {
        toast.success("Welcome back — your account has been reactivated.");
      }

      // A superadmin-provisioned admin signing in with a temporary password is
      // sent straight to the change-password screen before anything else.
      if (mergedUser?.mustChangePassword === true) {
        setIsRedirecting(true);
        navigate("/change-password");
        return;
      }

      const hasCompletedOnboarding =
        typeof mergedUser?.hasCompletedOnboarding === "boolean"
          ? mergedUser.hasCompletedOnboarding
          : mergedUser?.onboardingComplete;

      const role = normalizeRole(mergedUser?.role);

      if (["jobseeker", "employer"].includes(role) && hasCompletedOnboarding === false) {
        setIsRedirecting(true);
        navigate("/onboarding");
        return;
      }

      setIsRedirecting(true);
      navigate(getDefaultRouteByRole(role));
    } catch (err) {
      console.error("❌ Login error:", err);

      // Account is suspended/banned — credentials were valid. Send the user to
      // the suspension wall with an appeal-only session.
      const data = err?.response?.data;
      if (err?.response?.status === 403 && data?.code === "ACCOUNT_SUSPENDED") {
        if (data.appealToken) localStorage.setItem("appealToken", data.appealToken);
        localStorage.setItem(
          "suspensionInfo",
          JSON.stringify({
            accountStatus: data.accountStatus || "suspended",
            suspensionReason: data.suspensionReason || null,
            suspendedAt: data.suspendedAt || null,
          })
        );
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setIsRedirecting(true);
        navigate("/account-suspended");
        return;
      }

      // Credentials were valid, but the account's email hasn't been
      // confirmed yet — offer to resend the link instead of a dead-end error.
      if (err?.response?.status === 403 && data?.code === "EMAIL_NOT_VERIFIED") {
        setUnverifiedEmail(formData.email.trim().toLowerCase());
        showError(data.message || "Please verify your email address before signing in.");
        setLoading(false);
        return;
      }

      showError(formatApiError(err, "Login failed"));
      setLoading(false);
    }
  };

  const handleGoogleCredential = async (credential) => {
    showError("");
    setLoading(true);
    setIsRedirecting(false);
    try {
      const { data } = await authAPI.google(credential);
      const token = data.token;
      const userData = data.user || {};
      if (!token) throw new Error("No token received from server");

      const normalizedUser = { ...userData, role: normalizeRole(userData.role) };
      await login(token, normalizedUser);

      if (data.reactivated) {
        toast.success("Welcome back — your account has been reactivated.");
      }

      const role = normalizeRole(normalizedUser.role);
      const onboardingDone =
        typeof normalizedUser.hasCompletedOnboarding === "boolean"
          ? normalizedUser.hasCompletedOnboarding
          : normalizedUser.onboardingComplete;

      setIsRedirecting(true);
      if (["jobseeker", "employer"].includes(role) && onboardingDone === false) {
        navigate("/onboarding");
        return;
      }
      navigate(getDefaultRouteByRole(role));
    } catch (err) {
      console.error("❌ Google sign-in error:", err);
      const data = err?.response?.data;
      if (err?.response?.status === 403 && data?.code === "ACCOUNT_SUSPENDED") {
        if (data.appealToken) localStorage.setItem("appealToken", data.appealToken);
        localStorage.setItem(
          "suspensionInfo",
          JSON.stringify({
            accountStatus: data.accountStatus || "suspended",
            suspensionReason: data.suspensionReason || null,
            suspendedAt: data.suspendedAt || null,
          })
        );
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setIsRedirecting(true);
        navigate("/account-suspended");
        return;
      }
      showError(formatApiError(err, "Google sign-in failed"));
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      {inactiveNotice && <AccountInactiveModal onDismiss={() => setInactiveNotice(false)} />}
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

          {unverifiedEmail && (
            <p className="auth-link">
              <button type="button" onClick={handleResendVerification} disabled={resending}>
                {resending ? "Resending…" : "Resend verification email"}
              </button>
            </p>
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

            <div className="auth-forgot">
              <Link to="/forgot-password">Forgot password?</Link>
            </div>

            <button
              type="submit"
              className="auth-button"
              disabled={loading || isRedirecting}
            >
              {loading ? "Logging in..." : isRedirecting ? "Redirecting..." : "Login"}
            </button>
          </form>

          <GoogleSignInButton onCredential={handleGoogleCredential} text="signin_with" />

          <p className="auth-link">
            Don't have an account? <Link to="/register">Register</Link>
          </p>
        </div>
      </div>
    </div>
  );
}