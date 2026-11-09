import { useState, useContext, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { authAPI } from "../services/api";
import GoogleSignInButton from "../components/GoogleSignInButton";
import DobPrompt from "../components/DobPrompt";
import { useTranslation } from "react-i18next";
import AccountInactiveModal from "../components/AccountInactiveModal";
import { useToast } from "../components/feedback/context";
import "../styles/auth.css";
import "@fontsource/plus-jakarta-sans/800.css";
import "../styles/login.css";
import "../styles/username-signup.css";
import {
  isUsernameSignupEnabled,
  identifierKind,
  readRememberedUsername,
  writeRememberedUsername,
  clearRememberedUsername,
} from "../utils/usernameSignup";
import {
  FaEye,
  FaEyeSlash,
  FaEnvelope,
  FaLock,
  FaUserGraduate,
  FaBuilding,
  FaSignInAlt,
} from "react-icons/fa";

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
  const { t } = useTranslation();
  // First-time Google jobseeker: nothing is created until a date of birth passes the age check.
  const [pendingGoogleToken, setPendingGoogleToken] = useState("");
  // Username sign-up feature: "remember my username" (default OFF, shared PESO
  // and school computers). Only a username is ever stored; never a password or email.
  const usernameFeature = isUsernameSignupEnabled();
  const [rememberUsername, setRememberUsername] = useState(
    () => usernameFeature && Boolean(readRememberedUsername(localStorage))
  );
  const [formData, setFormData] = useState(() => ({
    email: usernameFeature ? readRememberedUsername(localStorage) : "",
    password: "",
  }));
  const [showPassword, setShowPassword] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(false);
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

  // One-time notice left behind by the API interceptor when a session was
  // ended mid-visit — self-deactivation, a staff account disabled, or the
  // account being deleted (see services/api.js). Shown as a blocking modal
  // rather than a toast since it's the same "your account is no longer
  // usable" notice a live-suspended session gets via ForcedLogoutListener.
  useEffect(() => {
    const notice = localStorage.getItem("authNotice");
    if (notice) {
      setInactiveNotice(
        localStorage.getItem("authNoticeCode") === "SESSION_EXPIRED" ? "session-expired" : true
      );
      localStorage.removeItem("authNotice");
    }
    localStorage.removeItem("authNoticeCode");
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
      showError("Please enter your email or username, and password.");
      return;
    }
    if (!formData.email.trim()) {
      showError("Please enter your email or username.");
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
      // `identifier` — an email OR a username, resolved server-side by
      // shape (see authController.login). Lowercased the same way for
      // either: emails are case-insensitive by normalization, and a
      // username is compared case-insensitively too, so this is harmless
      // either way and keeps the request consistent.
      const loginPayload = {
        identifier: formData.email.trim().toLowerCase(),
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

      if (usernameFeature) {
        if (rememberUsername && identifierKind(formData.email) === "username") {
          writeRememberedUsername(localStorage, formData.email);
        } else {
          clearRememberedUsername(localStorage);
        }
      }

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
        // The resend link needs an email; a typed username cannot be resent to.
        setUnverifiedEmail(identifierKind(formData.email) === "email" ? formData.email.trim().toLowerCase() : "");
        showError(data.message || "Please verify your email address before signing in.");
        setLoading(false);
        return;
      }

      // With the username feature on, a wrong password and a temporary lock
      // look identical on purpose (the server says the same thing for both),
      // so one message explains both and the way out.
      if (usernameFeature && err?.response?.status === 400 && !data?.code) {
        showError(t("login.lockedGeneric"));
        setLoading(false);
        return;
      }

      showError(formatApiError(err, "Login failed"));
      setLoading(false);
    }
  };

  const finishGoogleSignIn = async (data) => {
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
  };

  // Step 2 for a first-time Google jobseeker. Resolves to null on success or an
  // error code for the prompt to show; an under-15 date creates nothing.
  const handleGoogleDob = async (dateOfBirth) => {
    try {
      const { data } = await authAPI.googleComplete(pendingGoogleToken, dateOfBirth);
      setPendingGoogleToken("");
      await finishGoogleSignIn(data);
      return null;
    } catch (err) {
      const code = err?.response?.data?.code;
      if (code === "GOOGLE_PENDING_EXPIRED") setPendingGoogleToken("");
      return code || "GENERIC";
    }
  };

  const handleGoogleCredential = async (credential) => {
    showError("");
    setLoading(true);
    setIsRedirecting(false);
    try {
      const { data } = await authAPI.google(credential);
      if (data?.code === "DOB_REQUIRED" && data.pendingToken) {
        setPendingGoogleToken(data.pendingToken);
        setLoading(false);
        return;
      }
      await finishGoogleSignIn(data);
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
    <main className="login-page">
      {inactiveNotice && (
        <AccountInactiveModal
          reason={inactiveNotice === "session-expired" ? "session-expired" : undefined}
          onDismiss={() => setInactiveNotice(false)}
        />
      )}
      <div className="login-layout">
        {/* ─── Branding Side ─── */}
        <section className="login-branding" aria-labelledby="login-brand-title">
          <div className="login-branding-content">
            <p className="login-eyebrow">PUBLIC EMPLOYMENT SERVICE OFFICE</p>
            <h1 id="login-brand-title" className="login-branding-title">Trabaho<br />Mandin!</h1>
            <p className="login-branding-tagline">Trabaho para sa Marinduqueño</p>
            <p className="login-branding-desc">
              Marinduque, the Heart of the Philippines. Connect with local employers,
              discover livelihood opportunities, and build your future right here at home.
            </p>
            <div className="login-branding-chips">
              <span>Local Employers</span>
              <span>Smart Job Matching</span>
            </div>
            <div className="login-branding-footer">
              LALAWIGAN NG MARINDUQUE
            </div>
          </div>
        </section>

        {/* ─── Form Side ─── */}
        <section className="login-form-panel" aria-labelledby="login-form-title">
          <div className="login-form-content">
            <header className="login-form-header">
              <h2 id="login-form-title">Sign in to STRAM PESO</h2>
              <p>Access your account to find work or post openings.</p>
            </header>

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
                <div className="auth-field-header">
                  <label htmlFor="email">Email or Username</label>
                  {usernameFeature && (
                    <Link to="/forgot-username" className="auth-forgot-link">{t("login.forgotUsername")}</Link>
                  )}
                </div>
                <div className="auth-input-wrap">
                  <FaEnvelope className="auth-input-icon" aria-hidden="true" />
                  <input
                    id="email"
                    // Not type="email": this field also accepts a username,
                    // and a browser enforces its own email-shape validation
                    // on type="email" inputs regardless of the form's
                    // noValidate. autoComplete="username" is the token
                    // password managers actually key the saved credential
                    // pair on (paired with current-password below) —
                    // correct for a login field even when it holds an email.
                    type="text"
                    name="email"
                    placeholder="Email or username"
                    value={formData.email}
                    onChange={handleChange}
                    required
                    disabled={loading || isRedirecting}
                    autoComplete="username"
                    className={touched.email && !formData.email.trim() ? "is-error" : ""}
                  />
                </div>
              </div>

              <div className="form-group">
                <div className="auth-field-header">
                  <label htmlFor="password">Password</label>
                  <Link to="/forgot-password" className="auth-forgot-link">Forgot password?</Link>
                </div>
                <div className="auth-input-wrap password-container">
                  <FaLock className="auth-input-icon" aria-hidden="true" />
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

              {usernameFeature && (
                <>
                  <label className="auth-checkbox-row">
                    <input
                      type="checkbox"
                      checked={rememberUsername}
                      onChange={(e) => {
                        setRememberUsername(e.target.checked);
                        if (!e.target.checked) clearRememberedUsername(localStorage);
                      }}
                      disabled={loading || isRedirecting}
                    />
                    {t("login.rememberUsername")}
                  </label>
                  {readRememberedUsername(localStorage) && (
                    <p className="auth-link">
                      <button
                        type="button"
                        onClick={() => {
                          clearRememberedUsername(localStorage);
                          setRememberUsername(false);
                          setFormData((prev) => ({ ...prev, email: "" }));
                        }}
                      >
                        {t("login.clearRemembered")}
                      </button>
                    </p>
                  )}
                </>
              )}

              <label className="auth-checkbox-row">
                <input
                  type="checkbox"
                  checked={keepSignedIn}
                  onChange={(e) => setKeepSignedIn(e.target.checked)}
                  disabled={loading || isRedirecting}
                />
                Keep me signed in
              </label>

              <button
                type="submit"
                className="auth-button"
                disabled={loading || isRedirecting}
              >
                <FaSignInAlt aria-hidden="true" />
                {loading ? "Logging in..." : isRedirecting ? "Redirecting..." : "Login to Account"}
              </button>
            </form>

            <GoogleSignInButton onCredential={handleGoogleCredential} text="signin_with" fullWidth />
            <DobPrompt
              isOpen={Boolean(pendingGoogleToken)}
              onSubmit={handleGoogleDob}
              onCancel={() => setPendingGoogleToken("")}
              title={t("ageGate.googleTitle")}
              description={t("ageGate.googleBody")}
            />

            <div className="login-register">
              <p className="login-register-label">NEW TO PESO MARINDUQUE?</p>
              <div className="login-register-buttons">
                <Link to="/register" className="login-register-btn login-register-btn--applicant">
                  <FaUserGraduate aria-hidden="true" />
                  <span>Register as Applicant</span>
                </Link>
                <Link to="/register-employer" className="login-register-btn login-register-btn--employer">
                  <FaBuilding aria-hidden="true" />
                  <span>Register as Employer</span>
                </Link>
              </div>
            </div>

            <p className="auth-terms-footer">
              By logging in, you agree to the{" "}
              <Link to="/terms">Terms of Service</Link>,{" "}
              <Link to="/privacy">Privacy Policy</Link>, and{" "}
              <Link to="/cookies">Cookie Policy</Link> of PESO Marinduque.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
