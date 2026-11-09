import { useContext, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaEye, FaEyeSlash, FaTimes } from "react-icons/fa";
import { AuthContext } from "../context/AuthContext";
import { authAPI } from "../services/api";
import CodeInput from "./CodeInput";
import { useToast } from "./feedback/context";
import useEmailNudge from "../hooks/useEmailNudge";
import { translateErrorCode } from "../utils/apiErrors";
import { EMAIL_PROMPT_OPEN_EVENT } from "../utils/emailNudge";
import { formatCountdown, isCompleteCode, secondsLeft, shouldShowEmailPrompt } from "../utils/usernameSignup";
import "../styles/username-signup.css";

const EMAIL_SHAPE = /^\S+@\S+\.\S+$/;

// An email is OPTIONAL. This is a card, not a dialog: no overlay, no focus trap,
// nothing is blocked while it is open, and it can be dismissed at any time. It
// appears once, right after onboarding, and an "Add email" click anywhere (the
// banner, Settings, Edit Profile) opens it. After a dismissal the banner brings
// it back rarely (14, 45, 90 days, then never): see utils/emailNudge.js.
//
// Steps: intro (what an email is good for), email + current password, 6-digit code.
export default function EmailPrompt() {
  const { user, login } = useContext(AuthContext);
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const toast = useToast();
  const userId = user?._id || user?.id;
  const { nudge, dismiss, markSeen } = useEmailNudge(userId);

  const [forced, setForced] = useState(false);
  const [closed, setClosed] = useState(false);
  const [step, setStep] = useState("intro"); // "intro" | "email" | "code"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [autoShown, setAutoShown] = useState(false);

  const remaining = secondsLeft(cooldownUntil, now);

  useEffect(() => {
    if (!cooldownUntil || cooldownUntil <= Date.now()) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  // "Add email" from the banner, Settings or Edit Profile.
  useEffect(() => {
    const onOpen = (event) => {
      if (event.detail?.step === "backup") return; // handled by the backup-codes card
      setClosed(false);
      setForced(true);
      setStep("intro");
    };
    window.addEventListener(EMAIL_PROMPT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(EMAIL_PROMPT_OPEN_EVENT, onOpen);
  }, []);

  // First appearance: right after onboarding, once. It stays until dismissed.
  const eligibleFirstTime = shouldShowEmailPrompt({ user, pathname, nudge });
  useEffect(() => {
    if (eligibleFirstTime && !autoShown) {
      setAutoShown(true);
      markSeen(); // counts as shown from now on; later reminders come from the banner
    }
  }, [eligibleFirstTime, autoShown, markSeen]);

  // Not over the suspension or email-confirmation pages, and only for an account without a verified email.
  const allowedHere = shouldShowEmailPrompt({ user, pathname, nudge, forced: true });
  const visible = !closed && allowedHere && (autoShown || forced);

  const reset = () => {
    setStep("intro");
    setEmail("");
    setPassword("");
    setShowPassword(false);
    setCode("");
    setError("");
    setCooldownUntil(0);
  };

  const close = () => {
    setClosed(true);
    setForced(false);
    setPassword(""); // never keep the password once the card is dismissed
    dismiss();
    reset();
  };

  const errorText = (err) => {
    const data = err?.response?.data;
    const wait = formatCountdown(data?.retryAfter);
    if (data?.code === "EMAIL_CODE_COOLDOWN") return t("emailStep.cooldown", { time: wait });
    if (data?.code === "EMAIL_CODE_LIMIT") return t("emailStep.hourlyLimit", { time: wait });
    return translateErrorCode(data?.code, "") || t("errors.codes.GENERIC");
  };

  const sendCode = async (event) => {
    event?.preventDefault();
    if (busy) return;
    const target = email.trim();
    if (!EMAIL_SHAPE.test(target)) {
      setError(t("errors.codes.EMAIL_INVALID"));
      return;
    }
    if (!password) {
      setError(t("errors.codes.PASSWORD_INCORRECT"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { data } = await authAPI.requestAddEmail({ email: target, currentPassword: password });
      setCooldownUntil(Date.now() + (Number(data?.retryAfter) || 60) * 1000);
      setNow(Date.now());
      setCode("");
      setStep("code");
    } catch (err) {
      const retryAfter = Number(err?.response?.data?.retryAfter);
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        setCooldownUntil(Date.now() + retryAfter * 1000);
        setNow(Date.now());
      }
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value = code) => {
    if (busy || !isCompleteCode(value)) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await authAPI.verifyAddEmail(value);
      // The server bumped tokenVersion: this fresh token replaces the old one.
      await login(data.token, data.user);
      toast.success(t("emailStep.success"));
      setForced(false);
      setClosed(true);
      reset();
    } catch (err) {
      setError(errorText(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <section className="eprompt" role="region" aria-labelledby="eprompt-title">
      <button type="button" className="eprompt__close" onClick={close} aria-label={t("emailPrompt.dismiss")} disabled={busy}>
        <FaTimes aria-hidden="true" />
      </button>

      {step === "intro" && (
        <div className="egate">
          <h2 className="eprompt__title" id="eprompt-title">{t("emailPrompt.title")}</h2>
          <p className="egate__text">{t("emailPrompt.intro")}</p>
          <ul className="eprompt__benefits">
            <li>{t("emailPrompt.benefitOffline")}</li>
            <li>{t("emailPrompt.benefitReset")}</li>
          </ul>
          <p className="su-hint">{t("emailPrompt.optionalNote")}</p>
          <div className="egate__actions">
            <button type="button" className="egate__btn egate__btn--ghost" onClick={close}>
              {t("emailPrompt.maybeLater")}
            </button>
            <button type="button" className="egate__btn egate__btn--primary" onClick={() => setStep("email")}>
              {t("emailPrompt.addEmail")}
            </button>
          </div>
        </div>
      )}

      {step === "email" && (
        <form className="egate" onSubmit={sendCode} noValidate>
          <h2 className="eprompt__title" id="eprompt-title">{t("emailStep.title")}</h2>
          <p className="egate__text">{t("emailStep.intro")}</p>

          <div className="egate__field">
            <label className="egate__label" htmlFor="eprompt-email">{t("emailStep.emailLabel")}</label>
            <input
              id="eprompt-email"
              className="egate__input"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              placeholder={t("emailStep.emailPlaceholder")}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError("");
              }}
              disabled={busy}
            />
          </div>

          <div className="egate__field">
            <label className="egate__label" htmlFor="eprompt-password">{t("emailStep.passwordLabel")}</label>
            <div className="egate__pw">
              <input
                id="eprompt-password"
                className="egate__input"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError("");
                }}
                disabled={busy}
                aria-describedby="eprompt-password-hint"
              />
              <button
                type="button"
                className="egate__pw-toggle"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? t("emailStep.hidePassword") : t("emailStep.showPassword")}
                aria-pressed={showPassword}
                disabled={busy}
              >
                {showPassword ? <FaEyeSlash aria-hidden="true" /> : <FaEye aria-hidden="true" />}
              </button>
            </div>
            <span id="eprompt-password-hint" className="su-hint">{t("emailStep.passwordHint")}</span>
          </div>

          {error && <p className="egate__error" role="alert">{error}</p>}

          <div className="egate__actions">
            <button type="button" className="egate__btn egate__btn--ghost" onClick={close} disabled={busy}>
              {t("emailPrompt.maybeLater")}
            </button>
            <button type="submit" className="egate__btn egate__btn--primary" disabled={busy || remaining > 0}>
              {busy
                ? t("emailStep.sending")
                : remaining > 0
                  ? t("emailStep.resendIn", { time: formatCountdown(remaining) })
                  : t("emailStep.sendCode")}
            </button>
          </div>
        </form>
      )}

      {step === "code" && (
        <form
          className="egate"
          onSubmit={(e) => {
            e.preventDefault();
            verify();
          }}
          noValidate
        >
          <h2 className="eprompt__title" id="eprompt-title">{t("emailStep.codeTitle")}</h2>
          <p className="egate__text" id="eprompt-code-hint">{t("emailStep.codeHint", { email: email.trim() })}</p>

          <div className="egate__field">
            <label className="egate__label" htmlFor="eprompt-code">{t("emailStep.codeLabel")}</label>
            <CodeInput
              id="eprompt-code"
              value={code}
              onChange={(v) => {
                setCode(v);
                if (error) setError("");
              }}
              onComplete={verify}
              label={t("emailStep.codeLabel")}
              describedBy="eprompt-code-hint"
              invalid={Boolean(error)}
              disabled={busy}
              autoFocus
            />
          </div>

          {error && <p className="egate__error" role="alert">{error}</p>}

          <button type="button" className="egate__link" onClick={sendCode} disabled={busy || remaining > 0}>
            {remaining > 0 ? t("emailStep.resendIn", { time: formatCountdown(remaining) }) : t("emailStep.resend")}
          </button>
          <button
            type="button"
            className="egate__link"
            onClick={() => {
              setStep("email");
              setCode("");
              setError("");
            }}
            disabled={busy}
          >
            {t("emailStep.useAnother")}
          </button>

          <div className="egate__actions">
            <button type="button" className="egate__btn egate__btn--ghost" onClick={close} disabled={busy}>
              {t("emailPrompt.maybeLater")}
            </button>
            <button type="submit" className="egate__btn egate__btn--primary" disabled={busy || !isCompleteCode(code)}>
              {busy ? t("emailStep.verifying") : t("emailStep.verify")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
