import { useRef, useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaArrowLeft, FaSignOutAlt } from "react-icons/fa";
import { Check, Circle, CircleAlert, Eye, EyeOff, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { AuthContext } from "../context/AuthContext";
import { authAPI } from "../services/api";
import PublicNavbar from "../components/PublicNavbar";
import "../styles/change-password.css";

const MIN_LENGTH = 8;

const normalizeRole = (role) => (role === "employee" || role === "resident" ? "jobseeker" : role);

const routeForRole = (role) => {
  const r = normalizeRole(role);
  if (r === "superadmin") return "/superadmin";
  if (r === "admin") return "/admin";
  if (r === "employer") return "/employer-dashboard";
  return "/dashboard";
};

const ERROR_ID = "cpw-error";

export default function ChangePassword() {
  const { t } = useTranslation();
  const { user, setUser, setToken, logout } = useContext(AuthContext);
  const navigate = useNavigate();

  const forced = user?.mustChangePassword === true;

  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [show, setShow] = useState({ currentPassword: false, newPassword: false, confirmPassword: false });
  // `field` is the input the message is about, so it can be marked invalid
  // and focused; `message` is what the banner shows.
  const [error, setError] = useState({ field: "", message: "" });
  const [submitting, setSubmitting] = useState(false);

  const fieldRefs = {
    currentPassword: useRef(null),
    newPassword: useRef(null),
    confirmPassword: useRef(null),
  };

  const lengthOk = form.newPassword.length >= MIN_LENGTH;
  const matchOk = form.confirmPassword.length > 0 && form.newPassword === form.confirmPassword;

  const showError = (field, message) => {
    setError({ field, message });
    fieldRefs[field]?.current?.focus();
  };

  const onChange = (e) => {
    if (error.message) setError({ field: "", message: "" });
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  // Validate when the user leaves a field, not on every keystroke.
  const onBlurNew = () => {
    if (form.newPassword && !lengthOk) {
      setError({ field: "newPassword", message: t("changePassword.errors.tooShort") });
    }
  };
  const onBlurConfirm = () => {
    if (form.confirmPassword && form.newPassword !== form.confirmPassword) {
      setError({ field: "confirmPassword", message: t("changePassword.errors.mismatch") });
    }
  };

  const toggleShow = (name) => setShow((prev) => ({ ...prev, [name]: !prev[name] }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.currentPassword) {
      showError("currentPassword", t("changePassword.errors.fillCurrentNew"));
      return;
    }
    if (!form.newPassword) {
      showError("newPassword", t("changePassword.errors.fillCurrentNew"));
      return;
    }
    if (!lengthOk) {
      showError("newPassword", t("changePassword.errors.tooShort"));
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      showError("confirmPassword", t("changePassword.errors.mismatch"));
      return;
    }

    setSubmitting(true);
    setError({ field: "", message: "" });
    try {
      const { data } = await authAPI.changePassword({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      // The server invalidates every token issued before this change
      // (including this tab's own) and returns a fresh one — store it so
      // this session doesn't immediately get logged out on its next request.
      if (data?.token) {
        localStorage.setItem("token", data.token);
        setToken(data.token);
      }
      setUser((prev) => (prev ? { ...prev, mustChangePassword: false } : prev));
      navigate(routeForRole(user?.role), { replace: true });
    } catch (err) {
      setSubmitting(false);
      const message = err?.response?.data?.message || t("changePassword.errors.generic");
      // A rejected change is almost always the current password being wrong.
      setError({ field: "currentPassword", message });
      // Focus after the inputs are re-enabled.
      requestAnimationFrame(() => fieldRefs.currentPassword.current?.focus());
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const renderField = ({ name, label, autoComplete, onBlur, children }) => {
    const invalid = error.field === name && !!error.message;
    return (
      <div className="cpw-field">
        <label className="cpw-label" htmlFor={name}>
          {label}
        </label>
        <div className="cpw-input-wrap">
          <input
            ref={fieldRefs[name]}
            id={name}
            name={name}
            className="cpw-input"
            type={show[name] ? "text" : "password"}
            value={form[name]}
            onChange={onChange}
            onBlur={onBlur}
            autoComplete={autoComplete}
            disabled={submitting}
            aria-invalid={invalid ? "true" : undefined}
            aria-describedby={invalid ? ERROR_ID : undefined}
          />
          <button
            type="button"
            className="cpw-toggle"
            onClick={() => toggleShow(name)}
            aria-label={show[name] ? t("changePassword.hide") : t("changePassword.show")}
            aria-pressed={show[name]}
            disabled={submitting}
          >
            {show[name] ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </button>
        </div>
        {children}
      </div>
    );
  };

  const requirement = (met, text) => (
    <li className={`cpw-req ${met ? "cpw-req--met" : ""}`}>
      {met ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}
      <span>
        {text}
        <span className="ds-sr-only"> — {met ? "✓" : "✗"}</span>
      </span>
    </li>
  );

  return (
    <div className="cpw-page">
      <PublicNavbar
        action={
          forced
            ? { onClick: handleLogout, label: t("changePassword.logout"), icon: <FaSignOutAlt aria-hidden="true" /> }
            : { to: "/settings", label: t("changePassword.backToSettings"), icon: <FaArrowLeft aria-hidden="true" /> }
        }
      />

      <main className="cpw-main">
        <div className="cpw-grid">
          <section className="cpw-intro" aria-labelledby="cpw-title">
            <p className={`cpw-eyebrow ${forced ? "cpw-eyebrow--forced" : ""}`}>
              {forced ? t("changePassword.eyebrowForced") : t("changePassword.eyebrow")}
            </p>
            <div className={`cpw-badge ${forced ? "cpw-badge--forced" : ""}`} aria-hidden="true">
              <KeyRound />
            </div>
            <h1 id="cpw-title">
              {forced ? t("changePassword.titleForced") : t("changePassword.title")}
            </h1>
            <p className="cpw-subtitle">
              {forced ? t("changePassword.subtitleForced") : t("changePassword.subtitle")}
            </p>

            <div className="cpw-tips">
              <h2 className="cpw-tips__title">
                <ShieldCheck aria-hidden="true" />
                {t("changePassword.tipsTitle")}
              </h2>
              <ul>
                <li>{t("changePassword.tip1")}</li>
                <li>{t("changePassword.tip2")}</li>
                <li>{t("changePassword.tip3")}</li>
              </ul>
            </div>
          </section>

          <section className="cpw-card" aria-labelledby="cpw-title">
          {error.message && (
            <div id={ERROR_ID} className="cpw-alert" role="alert">
              <CircleAlert aria-hidden="true" />
              <span>{error.message}</span>
            </div>
          )}

          <form className="cpw-form" onSubmit={handleSubmit} noValidate>
            {renderField({
              name: "currentPassword",
              label: forced ? t("changePassword.temporaryLabel") : t("changePassword.currentLabel"),
              autoComplete: "current-password",
            })}

            {renderField({
              name: "newPassword",
              label: t("changePassword.newLabel"),
              autoComplete: "new-password",
              onBlur: onBlurNew,
            })}

            {renderField({
              name: "confirmPassword",
              label: t("changePassword.confirmLabel"),
              autoComplete: "new-password",
              onBlur: onBlurConfirm,
            })}

            <ul className="cpw-reqs" aria-label={t("changePassword.requirementsTitle")}>
              <li className="cpw-reqs__title" aria-hidden="true">
                {t("changePassword.requirementsTitle")}
              </li>
              {requirement(lengthOk, t("changePassword.reqLength"))}
              {requirement(matchOk, t("changePassword.reqMatch"))}
            </ul>

            <button type="submit" className="cpw-submit" disabled={submitting}>
              {submitting ? (
                <>
                  <LoaderCircle className="cpw-spin" aria-hidden="true" />
                  {t("changePassword.saving")}
                </>
              ) : (
                t("changePassword.submit")
              )}
            </button>
          </form>
          </section>
        </div>
      </main>
    </div>
  );
}
