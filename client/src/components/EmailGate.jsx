import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import { AuthContext } from "../context/AuthContext";
import { authAPI } from "../services/api";
import AppModal from "./AppModal";
import CodeInput from "./CodeInput";
import { useToast } from "./feedback/context";
import { translateErrorCode } from "../utils/apiErrors";
import { backupCodesFilename, buildBackupCodesText, downloadTextFile, localDateStamp } from "../utils/backupCodesFile";
import {
  EMAIL_GATE_OPEN_EVENT,
  EMAIL_REQUIRED_EVENT,
  clearSkipped,
  readBackupOffered,
  readSkipped,
  writeBackupOffered,
  writeSkipped,
} from "../utils/emailGateEvents";
import { formatCountdown, isCompleteCode, needsEmail, secondsLeft, shouldShowEmailGate } from "../utils/usernameSignup";
import "../styles/username-signup.css";

const EMAIL_SHAPE = /^\S+@\S+\.\S+$/;

// Blocking-but-skippable prompt that gets an email-less jobseeker to add and
// verify an email with a six-digit code. It only ever appears for such an
// account. "Skip for now" is remembered for this browser session only; the
// server is what limits the account until a verified email exists.
export default function EmailGate() {
  const { user, setUser, login } = useContext(AuthContext);
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const toast = useToast();

  const userId = user?._id || user?.id;
  const [, setSkipTick] = useState(0); // re-render after the sessionStorage flag changes
  const skipped = readSkipped(userId);
  const [forced, setForced] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [step, setStep] = useState("email"); // "email" | "code"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [backupBusy, setBackupBusy] = useState(false);
  const emailRef = useRef(null);

  const remaining = secondsLeft(cooldownUntil, now);

  // Tick once a second while a countdown is running.
  useEffect(() => {
    if (!cooldownUntil || cooldownUntil <= Date.now()) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  const resetForm = useCallback(() => {
    setStep("email");
    setEmail("");
    setPassword("");
    setShowPassword(false);
    setCode("");
    setError("");
    setCooldownUntil(0);
  }, []);

  // Other parts of the app can ask for the gate: the banner, Settings, and the
  // API layer when the server answers EMAIL_REQUIRED.
  useEffect(() => {
    const onOpen = (event) => {
      if (event.detail?.step === "backup") {
        setBackupOpen(true);
        return;
      }
      clearSkipped(userId);
      setSkipTick((n) => n + 1);
      setForced(true);
    };
    const onRequired = () => {
      setForced(true);
    };
    window.addEventListener(EMAIL_GATE_OPEN_EVENT, onOpen);
    window.addEventListener(EMAIL_REQUIRED_EVENT, onRequired);
    return () => {
      window.removeEventListener(EMAIL_GATE_OPEN_EVENT, onOpen);
      window.removeEventListener(EMAIL_REQUIRED_EVENT, onRequired);
    };
  }, [userId]);

  const accountNeedsEmail = needsEmail(user);
  const showEmailGate = shouldShowEmailGate({ user, pathname, skipped, forced });
  const showBackup = backupOpen && accountNeedsEmail;

  const offerBackupOnce = () => {
    if (user?.backupCodesGeneratedAt || readBackupOffered(userId)) return;
    writeBackupOffered(userId);
    setBackupOpen(true);
  };

  const handleSkip = () => {
    writeSkipped(userId);
    setSkipTick((n) => n + 1);
    setForced(false);
    setPassword(""); // never keep the password around once the dialog is dismissed
    offerBackupOnce();
  };

  const errorText = (err) => {
    const data = err?.response?.data;
    const code = data?.code;
    const wait = formatCountdown(data?.retryAfter);
    if (code === "EMAIL_CODE_COOLDOWN") return t("emailStep.cooldown", { time: wait });
    if (code === "EMAIL_CODE_LIMIT") return t("emailStep.hourlyLimit", { time: wait });
    return translateErrorCode(code, "") || t("errors.codes.GENERIC");
  };

  const applyRetryAfter = (err) => {
    const retryAfter = Number(err?.response?.data?.retryAfter);
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      setCooldownUntil(Date.now() + retryAfter * 1000);
      setNow(Date.now());
    }
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
      const wait = Number(data?.retryAfter) || 60;
      setCooldownUntil(Date.now() + wait * 1000);
      setNow(Date.now());
      setCode("");
      setStep("code");
    } catch (err) {
      applyRetryAfter(err);
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
      clearSkipped(userId);
      setForced(false);
      setBackupOpen(false);
      resetForm();
    } catch (err) {
      setError(errorText(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const useAnotherEmail = () => {
    setStep("email");
    setCode("");
    setError("");
  };

  const generateBackupCodes = async () => {
    if (backupBusy) return;
    setBackupBusy(true);
    try {
      const { data } = await authAPI.generateBackupCodes();
      const text = buildBackupCodesText(data?.codes || [], {
        title: t("settings.account.backupCodes.file.title"),
        generatedLabel: t("settings.account.backupCodes.file.generated", { date: localDateStamp() }),
        notes: [t("settings.account.backupCodes.file.note1"), t("settings.account.backupCodes.file.note2")],
      });
      downloadTextFile(backupCodesFilename(), text);
      setUser({ ...user, backupCodesGeneratedAt: new Date().toISOString() });
      toast.success(t("emailStep.backupDone"));
      setBackupOpen(false);
    } catch (err) {
      toast.error(translateErrorCode(err?.response?.data?.code, "") || t("emailStep.backupError"));
    } finally {
      setBackupBusy(false);
    }
  };

  if (!user) return null;

  // Backup-codes offer (after skipping, or from the banner).
  if (showBackup && !showEmailGate) {
    return (
      <AppModal
        isOpen
        onClose={() => setBackupOpen(false)}
        title={t("emailStep.backupTitle")}
        closeLabel={t("emailStep.close")}
        panelClassName="egate-panel"
      >
        <div className="egate">
          <p className="egate__text">{t("emailStep.backupBody")}</p>
          <div className="egate__actions">
            <button type="button" className="egate__btn egate__btn--ghost" onClick={() => setBackupOpen(false)} disabled={backupBusy}>
              {t("emailStep.backupNotNow")}
            </button>
            <button type="button" className="egate__btn egate__btn--primary" onClick={generateBackupCodes} disabled={backupBusy}>
              {backupBusy ? t("emailStep.sending") : t("emailStep.backupGenerate")}
            </button>
          </div>
        </div>
      </AppModal>
    );
  }

  if (!showEmailGate) return null;

  // Announce the countdown to screen readers in coarse steps (every 15 s), not every second.
  const announced = remaining > 0 ? Math.ceil(remaining / 15) * 15 : 0;

  return (
    <AppModal
      isOpen
      onClose={handleSkip}
      title={step === "code" ? t("emailStep.codeTitle") : t("emailStep.title")}
      closeLabel={t("emailStep.skip")}
      panelClassName="egate-panel"
    >
      {step === "email" ? (
        <form className="egate" onSubmit={sendCode} noValidate>
          <p className="egate__text">{t("emailStep.intro")}</p>

          <div className="egate__field">
            <label className="egate__label" htmlFor="egate-email">
              {t("emailStep.emailLabel")}
            </label>
            <input
              id="egate-email"
              ref={emailRef}
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
            <label className="egate__label" htmlFor="egate-password">
              {t("emailStep.passwordLabel")}
            </label>
            <div className="egate__pw">
              <input
                id="egate-password"
                className="egate__input"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError("");
                }}
                disabled={busy}
                aria-describedby="egate-password-hint"
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
            <span id="egate-password-hint" className="su-hint">
              {t("emailStep.passwordHint")}
            </span>
          </div>

          {error && (
            <p className="egate__error" role="alert">
              {error}
            </p>
          )}

          <div className="egate__actions">
            <button type="button" className="egate__btn egate__btn--ghost" onClick={handleSkip} disabled={busy}>
              {t("emailStep.skip")}
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
      ) : (
        <form
          className="egate"
          onSubmit={(e) => {
            e.preventDefault();
            verify();
          }}
          noValidate
        >
          <p className="egate__text" id="egate-code-hint">
            {t("emailStep.codeHint", { email: email.trim() })}
          </p>

          <div className="egate__field">
            <label className="egate__label" htmlFor="egate-code">
              {t("emailStep.codeLabel")}
            </label>
            <CodeInput
              id="egate-code"
              value={code}
              onChange={(v) => {
                setCode(v);
                if (error) setError("");
              }}
              onComplete={verify}
              label={t("emailStep.codeLabel")}
              describedBy="egate-code-hint"
              invalid={Boolean(error)}
              disabled={busy}
              autoFocus
            />
          </div>

          {error && (
            <p className="egate__error" role="alert">
              {error}
            </p>
          )}

          <button type="button" className="egate__link" onClick={sendCode} disabled={busy || remaining > 0}>
            {remaining > 0 ? t("emailStep.resendIn", { time: formatCountdown(remaining) }) : t("emailStep.resend")}
          </button>
          <span className="su-sr-only" aria-live="polite" aria-atomic="true">
            {remaining > 0 ? t("emailStep.resendIn", { time: formatCountdown(announced) }) : ""}
          </span>
          <button type="button" className="egate__link" onClick={useAnotherEmail} disabled={busy}>
            {t("emailStep.useAnother")}
          </button>

          <div className="egate__actions">
            <button type="button" className="egate__btn egate__btn--ghost" onClick={handleSkip} disabled={busy}>
              {t("emailStep.skip")}
            </button>
            <button type="submit" className="egate__btn egate__btn--primary" disabled={busy || !isCompleteCode(code)}>
              {busy ? t("emailStep.verifying") : t("emailStep.verify")}
            </button>
          </div>
        </form>
      )}
    </AppModal>
  );
}
