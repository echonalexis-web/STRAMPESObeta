import { useState, useContext } from "react";
import { useNavigate, Link } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { authAPI } from "../services/api";
import GoogleSignInButton from "../components/GoogleSignInButton";
import { useToast } from "../components/feedback/context";
import RegistrationLayout from "../components/RegistrationLayout";
import { useUsernameAvailability } from "../hooks/useUsernameAvailability";
import { FaEye, FaEyeSlash, FaEnvelope, FaLock, FaAt, FaUserPlus } from "react-icons/fa";
import { useTranslation } from "react-i18next";
import DobPrompt from "../components/DobPrompt";
import { checkDobInput, getManilaTodayISO } from "../utils/age";
import { translateErrorCode } from "../utils/apiErrors";

// Honest limit: this only remembers an under-15 attempt for this browser
// session so the form is not offered again straight away. A determined child can
// clear it; the real controls are server-side and proof of age at SPES intake.
// Nothing about the attempt (not even the date) is stored.
const AGE_BLOCK_KEY = "ageBlockedSession";
const readAgeBlocked = () => {
  try {
    return sessionStorage.getItem(AGE_BLOCK_KEY) === "1";
  } catch {
    return false;
  }
};
const writeAgeBlocked = () => {
  try {
    sessionStorage.setItem(AGE_BLOCK_KEY, "1");
  } catch {
    /* storage unavailable: the block simply is not remembered */
  }
};

const normalizeRole = (role) => (role === "employee" || role === "resident" ? "jobseeker" : role);

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
  const { t } = useTranslation();
  const [ageBlocked, setAgeBlocked] = useState(readAgeBlocked);
  // Set when a first-time Google sign-in needs a date of birth before the account exists.
  const [pendingGoogleToken, setPendingGoogleToken] = useState("");
  const [formData, setFormData] = useState({
    surname: "",
    firstName: "",
    middleName: "",
    suffix: "",
    email: "",
    dateOfBirth: "",
    password: "",
    username: "",
  });
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  // Optional — leaving it blank gets an auto-suggested one instead (see
  // authController.register). Live-checked the same way Settings' own
  // username editor does, against the same public, rate-limited endpoint.
  const usernameCheck = useUsernameAvailability(formData.username, { enabled: true });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState([]);
  const [touched, setTouched] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);
  // Set once registration succeeds — there's no session to log into yet
  // (see handleSubmit), so this replaces the form with a "check your email"
  // notice instead of navigating anywhere.
  const [success, setSuccess] = useState("");
  const [devVerifyUrl, setDevVerifyUrl] = useState("");
  const { login } = useContext(AuthContext);
  const navigate = useNavigate();
  const toast = useToast();

  // On a long form, a plain inline banner can end up far above whatever the
  // user has scrolled down to fill in next — this fires a toast alongside it
  // so the error is seen immediately regardless of scroll position.
  const showError = (message) => {
    setError(message);
    if (message) toast.error(message);
  };

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
        showError("");
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
    showError("");
    setPasswordErrors([]);

    // ─── Empty-field validation ───
    const newTouched = { surname: true, firstName: true, email: true, password: true };
    setTouched(newTouched);

    if (!formData.surname.trim() && !formData.firstName.trim() && !formData.email.trim() && !formData.password) {
      showError("Please fill in all required fields.");
      return;
    }
    if (!formData.surname.trim()) {
      showError("Please enter your surname.");
      return;
    }
    if (!formData.firstName.trim()) {
      showError("Please enter your first name.");
      return;
    }
    if (!formData.email.trim()) {
      showError("Please enter your email address.");
      return;
    }
    {
      const dobCode = checkDobInput(formData.dateOfBirth);
      if (dobCode === "AGE_UNDER_MINIMUM") {
        // Not sent anywhere: the date of an under-15 attempt is never stored.
        writeAgeBlocked();
        setAgeBlocked(true);
        return;
      }
      if (dobCode) {
        showError(t(`errors.codes.${dobCode}`));
        return;
      }
    }
    if (!formData.password) {
      showError("Please enter a password.");
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
      showError("Please enter a valid email address.");
      return;
    }

    // Name validation
    if (formData.surname.trim().length < 2 || formData.firstName.trim().length < 2) {
      showError("Please enter your full name.");
      return;
    }

    // Optional field — only blocks submission when it's actually been typed
    // AND the live check already came back negative. The server re-checks
    // regardless (the authority here), this just avoids a pointless round
    // trip when the client already knows the answer.
    if (formData.username.trim() && usernameCheck.status === "unavailable") {
      showError(usernameCheck.message || "That username is already taken.");
      return;
    }

    if (!agreedToTerms) {
      showError("Please agree to the Terms of Service and Privacy Policy to continue.");
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

      const { data: registerResponse } = await authAPI.register({
        name: composedName,
        surname,
        firstName,
        middleName,
        suffix,
        email: normalizedEmail,
        dateOfBirth: formData.dateOfBirth,
        password: formData.password,
        role: "employee",
        username: formData.username.trim(),
      });

      // register() deliberately returns no session token: the account is
      // unverified until the emailed link is opened, and login() refuses
      // unverified accounts. So there's nothing to log in with yet — show a
      // "check your email" state instead of navigating anywhere.
      setSuccess(
        registerResponse.message ||
          "Account created! We've sent a verification link to your email — verify it, then log in."
      );
      setDevVerifyUrl(registerResponse.devVerifyUrl || "");
      setFormData({ surname: "", firstName: "", middleName: "", suffix: "", email: "", dateOfBirth: "", password: "", username: "" });
      setTouched({});
      setTimeout(() => navigate("/login"), 4000);
    } catch (err) {
      console.error("Registration error:", err);
      if (err?.response?.data?.code === "AGE_UNDER_MINIMUM") {
        writeAgeBlocked();
        setAgeBlocked(true);
        return;
      }
      showError(translateErrorCode(err?.response?.data?.code) || formatApiError(err, "Registration failed"));
    } finally {
      setLoading(false);
    }
  };

  const finishGoogleSignIn = (data) => {
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
  };

  // Step 2 for a first-time Google jobseeker: nothing exists yet, so the date
  // of birth goes up with the short-lived pending token. Resolves to null on
  // success or an error code for the prompt to show.
  const handleGoogleDob = async (dateOfBirth) => {
    try {
      const { data } = await authAPI.googleComplete(pendingGoogleToken, dateOfBirth);
      setPendingGoogleToken("");
      finishGoogleSignIn(data);
      return null;
    } catch (err) {
      const code = err?.response?.data?.code;
      if (code === "AGE_UNDER_MINIMUM") {
        writeAgeBlocked();
        setPendingGoogleToken("");
        setAgeBlocked(true);
        return null;
      }
      if (code === "GOOGLE_PENDING_EXPIRED") setPendingGoogleToken("");
      return code || "GENERIC";
    }
  };

  const handleGoogleCredential = async (credential) => {
    showError("");
    setLoading(true);
    try {
      const { data } = await authAPI.google(credential, "jobseeker");
      if (data?.code === "DOB_REQUIRED" && data.pendingToken) {
        setPendingGoogleToken(data.pendingToken);
        return;
      }
      finishGoogleSignIn(data);
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
      showError(formatApiError(err, "Google sign-in failed"));
    } finally {
      setLoading(false);
    }
  };

  const showPasswordRequirements = touched.password && passwordErrors.length > 0 && isPasswordFocused;
  const showPasswordSuccess = touched.password && passwordErrors.length === 0 && formData.password.length > 0;

  return (
    <RegistrationLayout>
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}

      {success ? (
        <div className="auth-notice" role="status" aria-live="polite">
          <p>{success}</p>
          {devVerifyUrl && (
            <p className="auth-notice__dev">
              <strong>Dev:</strong> email isn&rsquo;t wired up yet &mdash;{" "}
              <a href={devVerifyUrl}>open the verification link</a>.
            </p>
          )}
        </div>
      ) : ageBlocked ? (
        <div className="auth-notice" role="alert">
          <p><strong>{t("ageGate.underMinimumTitle")}</strong></p>
          <p>{t("ageGate.underMinimumBody")}</p>
        </div>
      ) : (
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
          <div className="auth-input-wrap">
            <FaEnvelope className="auth-input-icon" aria-hidden="true" />
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
        </div>

        <div className="form-group">
          <label htmlFor="dateOfBirth">{t("ageGate.dobLabel")}</label>
          <input
            id="dateOfBirth"
            type="date"
            name="dateOfBirth"
            value={formData.dateOfBirth}
            onChange={handleChange}
            max={getManilaTodayISO()}
            min="1900-01-01"
            required
            disabled={loading}
            autoComplete="bday"
            aria-describedby="dateOfBirth-hint"
          />
          <span id="dateOfBirth-hint" className="optional-label">{t("ageGate.registerHint")}</span>
        </div>

        <div className="form-group">
          <label htmlFor="username">Username <span className="optional-label">(optional)</span></label>
          <div className="auth-input-wrap">
            <FaAt className="auth-input-icon" aria-hidden="true" />
            <input
              id="username"
              type="text"
              name="username"
              placeholder="A second way to sign in"
              value={formData.username}
              onChange={handleChange}
              disabled={loading}
              autoComplete="username"
              maxLength={30}
            />
          </div>
          {usernameCheck.status === "checking" && (
            <span className="password-valid" style={{ color: "#64748b" }}>Checking…</span>
          )}
          {usernameCheck.status === "available" && (
            <span className="password-valid">✓ That username is available</span>
          )}
          {usernameCheck.status === "unavailable" && (
            <span className="password-error">{usernameCheck.message}</span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="password">Password</label>
          <div className="auth-input-wrap password-wrapper">
            <FaLock className="auth-input-icon" aria-hidden="true" />
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
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowPassword(!showPassword)}
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

        <label className="auth-checkbox-row">
          <input
            type="checkbox"
            checked={agreedToTerms}
            onChange={(e) => setAgreedToTerms(e.target.checked)}
            disabled={loading}
          />
          <span>
            I have read and agree to the{" "}
            <Link to="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</Link>,{" "}
            <Link to="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</Link>, and{" "}
            <Link to="/cookies" target="_blank" rel="noopener noreferrer">Cookie Policy</Link>.
          </span>
        </label>

        <button type="submit" className="auth-button" disabled={loading || !agreedToTerms}>
          <FaUserPlus aria-hidden="true" />
          {loading ? "Creating Account..." : "Create Account"}
        </button>
      </form>
      )}

      {!success && !ageBlocked && <GoogleSignInButton onCredential={handleGoogleCredential} text="signup_with" fullWidth />}
      <DobPrompt
        isOpen={Boolean(pendingGoogleToken)}
        onSubmit={handleGoogleDob}
        onCancel={() => setPendingGoogleToken("")}
        title={t("ageGate.googleTitle")}
        description={t("ageGate.googleBody")}
      />

      {!success && (
        <p className="auth-terms-footer">
          By continuing with Google, you agree to the{" "}
          <Link to="/terms">Terms of Service</Link> &amp; <Link to="/privacy">Privacy Policy</Link>.
        </p>
      )}

      <p className="auth-link">
        Already have an account? <Link to="/login" onClick={(e) => {
          if (loading) e.preventDefault();
        }}>Log in</Link>
      </p>
    </RegistrationLayout>
  );
}
