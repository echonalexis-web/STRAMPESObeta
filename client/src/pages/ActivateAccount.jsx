import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import { authAPI } from "../services/api";
import FormField from "../components/FormField";
import { useFieldErrors } from "../hooks/useFieldErrors";
import { makeError, mapServerError } from "../utils/formErrors";
import { passwordProblems } from "../utils/usernameSignup";
import { ACTIVATION_RULES, extractActivationToken } from "../utils/activationLink";
import "../styles/auth.css";
import "../styles/activate-account.css";
import pesoLogo from "../assets/images/peso-logo.png";
import provincialSeal from "../assets/images/provincial-seal.png";

const FIELD_ORDER = ["password", "confirmPassword"];

// Public page behind the link in a staff invitation email. It reads the token
// once, removes it from the address bar and from referrers, checks it, and lets
// the person choose their own password. It never signs them in.
export default function ActivateAccount() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const formRef = useRef(null);
  const headingRef = useRef(null);
  const { errors, clearFieldError, replaceErrors, focusFirstInvalid } = useFieldErrors();

  // Read in the initializer (it only reads) and cleared in the effect below.
  const [token] = useState(() =>
    typeof window === "undefined" ? "" : extractActivationToken(window.location.hash, window.location.search)
  );
  const [status, setStatus] = useState(token ? "checking" : "invalid");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  // Focus can only move to a field once it is enabled again, after the request ends.
  const focusAfterRequest = useRef(null);

  // Keep the token out of the address bar, history entries and referrers.
  useEffect(() => {
    if (typeof window !== "undefined" && window.history && typeof window.history.replaceState === "function") {
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
    // The router keeps its own copy of the location and would write the old URL
    // (with the token) back on its next update, so it is replaced as well.
    navigate({ pathname: window.location.pathname, search: "", hash: "" }, { replace: true });
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [navigate]);

  // One neutral message for every kind of bad link: the server answers 400 for
  // all of them and so does this page.
  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    authAPI
      .checkActivation(token)
      .then(() => {
        if (!cancelled) setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        // A bad link is 400. Anything else (offline, busy) still shows the form:
        // the server checks the link again on submit.
        setStatus(err?.response?.status === 400 ? "invalid" : "ready");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (status === "invalid" && headingRef.current) headingRef.current.focus();
  }, [status]);

  // Something on the first render can write the router's copy of the URL back, so
  // the address bar is scrubbed again once the link has been checked.
  useEffect(() => {
    if (status === "checking") return;
    if (typeof window !== "undefined" && window.location.hash) {
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
  }, [status]);

  useEffect(() => {
    if (submitting || !focusAfterRequest.current) return;
    const next = focusAfterRequest.current;
    focusAfterRequest.current = null;
    focusFirstInvalid(FIELD_ORDER, next, formRef.current);
  }, [submitting, focusFirstInvalid]);

  const problems = useMemo(() => passwordProblems({ password }), [password]);
  const metCount = ACTIVATION_RULES.filter((rule) => !problems.includes(rule)).length;
  const matches = confirmPassword.length > 0 && password === confirmPassword;

  const validate = () => {
    const next = {};
    if (!password) next.password = makeError("activation.errors.passwordRequired");
    else if (problems.length > 0) next.password = makeError("errors.codes.PASSWORD_WEAK");
    if (!confirmPassword) next.confirmPassword = makeError("activation.errors.confirmRequired");
    else if (password !== confirmPassword) next.confirmPassword = makeError("activation.errors.mismatch");
    return next;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setFormError("");
    const found = validate();
    replaceErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstInvalid(FIELD_ORDER, found, formRef.current);
      return;
    }
    setSubmitting(true);
    try {
      await authAPI.activateAccount({ token, password, confirmPassword });
      navigate("/login", { replace: true, state: { activated: true } });
    } catch (err) {
      const status = err?.response?.status;
      const mapped = mapServerError(err);
      if (mapped.code === "INVITE_INVALID") {
        setStatus("invalid");
      } else if (mapped.code === "PASSWORD_MISMATCH") {
        const next = { confirmPassword: makeError("activation.errors.mismatch") };
        replaceErrors(next);
        focusAfterRequest.current = next;
      } else if (mapped.code && mapped.code.startsWith("PASSWORD_")) {
        const next = { password: makeError(mapped.key, mapped.params) };
        replaceErrors(next);
        focusAfterRequest.current = next;
      } else if (status === 429) {
        setFormError(t("activation.errors.tooMany"));
      } else {
        setFormError(t("activation.errors.generic"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const toggleLabel = showPassword ? t("activation.hide") : t("activation.show");
  const inputType = showPassword ? "text" : "password";

  return (
    <div className="auth-container">
      <div className="auth-panel">
        <div className="auth-branding">
          <div className="auth-branding-content">
            <img src={pesoLogo} alt="PESO Marinduque Logo" className="auth-branding-logo" />
            <h1 className="auth-branding-title">TRABAHO MANDIN!</h1>
            <p className="auth-branding-tagline">Trabaho para sa Marinduqueño</p>
            <img src={provincialSeal} alt="Provincial Seal of Marinduque" className="auth-branding-seal" />
            <div className="auth-branding-footer">
              PUBLIC EMPLOYMENT SERVICE OFFICE<br />
              Lalawigan ng Marinduque
            </div>
          </div>
        </div>

        <div className="auth-card aa-card">
          {status === "checking" ? (
            <>
              <h2>{t("activation.title")}</h2>
              <p className="auth-subtitle" role="status" aria-live="polite">{t("activation.checking")}</p>
            </>
          ) : status === "invalid" ? (
            <>
              <h2 ref={headingRef} tabIndex={-1}>{t("activation.invalidTitle")}</h2>
              <div className="error-message" role="alert">{t("activation.invalidBody")}</div>
              <p className="auth-link">
                <Link to="/login">{t("activation.backToLogin")}</Link>
              </p>
            </>
          ) : (
            <>
              <h2>{t("activation.title")}</h2>
              <p className="auth-subtitle">{t("activation.subtitle")}</p>

              {formError ? (
                <div className="error-message" role="alert">{formError}</div>
              ) : null}

              <form className="auth-form aa-form" onSubmit={handleSubmit} noValidate ref={formRef}>
                <FormField
                  id="password"
                  label={t("activation.password")}
                  required
                  error={errors.password}
                  renderControl={(aria) => (
                    <div className="password-container aa-password">
                      <input
                        name="password"
                        type={inputType}
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          clearFieldError("password");
                        }}
                        autoComplete="new-password"
                        disabled={submitting}
                        {...aria}
                        aria-describedby={[aria["aria-describedby"], "activate-requirements"].filter(Boolean).join(" ")}
                      />
                      <button
                        type="button"
                        className="password-toggle aa-toggle"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={toggleLabel}
                        aria-pressed={showPassword}
                        disabled={submitting}
                      >
                        {showPassword ? <FaEyeSlash aria-hidden="true" /> : <FaEye aria-hidden="true" />}
                      </button>
                    </div>
                  )}
                />

                <div className="aa-requirements" id="activate-requirements">
                  <p className="aa-requirements__title">{t("activation.requirementsTitle")}</p>
                  <div
                    className="aa-meter"
                    role="meter"
                    aria-valuemin={0}
                    aria-valuemax={ACTIVATION_RULES.length}
                    aria-valuenow={metCount}
                    aria-label={t("activation.requirementsTitle")}
                  >
                    {ACTIVATION_RULES.map((rule, index) => (
                      <span key={rule} className={`aa-meter__seg${index < metCount ? " is-on" : ""}`} />
                    ))}
                  </div>
                  <ul className="aa-rules">
                    {ACTIVATION_RULES.map((rule) => {
                      const met = !problems.includes(rule);
                      return (
                        <li key={rule} className={met ? "is-met" : ""}>
                          <span className="aa-rules__mark" aria-hidden="true">{met ? "✓" : "○"}</span>
                          <span>{t(`password.${rule}`)}</span>
                          <span className="ds-sr-only">{met ? t("password.requirementMet") : t("password.requirementOpen")}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <FormField
                  id="confirmPassword"
                  label={t("activation.confirm")}
                  required
                  error={errors.confirmPassword}
                >
                  <input
                    name="confirmPassword"
                    type={inputType}
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      clearFieldError("confirmPassword");
                    }}
                    autoComplete="new-password"
                    disabled={submitting}
                  />
                </FormField>
                {matches ? (
                  <p className="aa-match" role="status">
                    <span aria-hidden="true">✓</span> {t("password.match")}
                  </p>
                ) : null}

                <button type="submit" className="auth-button" disabled={submitting}>
                  {submitting ? t("activation.submitting") : t("activation.submit")}
                </button>
              </form>

              <p className="auth-link">
                <Link to="/login">{t("activation.backToLogin")}</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
