import { useContext, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaDownload, FaPrint, FaCopy } from "react-icons/fa";
import { AuthContext } from "../context/AuthContext";
import { authAPI } from "../services/api";
import { useToast } from "./feedback/context";
import useEmailNudge from "../hooks/useEmailNudge";
import { translateErrorCode } from "../utils/apiErrors";
import { backupCodesFilename, buildBackupCodesText, downloadTextFile, localDateStamp } from "../utils/backupCodesFile";
import { EMAIL_PROMPT_OPEN_EVENT } from "../utils/emailNudge";
import { shouldShowBackupStep, isUsernameOnly } from "../utils/usernameSignup";
import "../styles/username-signup.css";

// Default step right after a username-only sign-up. Without an email there is no
// reset link, so backup codes are the person's way back in. It shows on the first
// onboarding screen (and when "Save backup codes" is clicked in the banner), is
// never auto-generated (the person presses the button), and the codes appear ONCE:
// the server never returns them again. Save a file, print, copy, or screenshot.
// The printed page has the codes only: no name, username or email.
export default function BackupCodesStep() {
  const { user, setUser } = useContext(AuthContext);
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const toast = useToast();
  const userId = user?._id || user?.id;
  const { nudge, dismissBackupStep } = useEmailNudge(userId);

  const [forced, setForced] = useState(false);
  const [codes, setCodes] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onOpen = (event) => {
      if (event.detail?.step === "backup") setForced(true);
    };
    window.addEventListener(EMAIL_PROMPT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(EMAIL_PROMPT_OPEN_EVENT, onOpen);
  }, []);

  const natural = shouldShowBackupStep({ user, pathname, nudge });
  // Once codes are on screen the card stays until the person confirms they saved them.
  const visible = Boolean(codes) || natural || (forced && isUsernameOnly(user) && !user?.backupCodesGeneratedAt);
  if (!visible) return null;

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await authAPI.generateBackupCodes();
      setCodes(Array.isArray(data?.codes) ? data.codes : []);
    } catch (err) {
      setError(translateErrorCode(err?.response?.data?.code, "") || t("backupSignup.generateError"));
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    try {
      const text = buildBackupCodesText(codes, {
        title: t("settings.account.backupCodes.file.title"),
        generatedLabel: t("settings.account.backupCodes.file.generated", { date: localDateStamp() }),
        notes: [t("settings.account.backupCodes.file.note1"), t("settings.account.backupCodes.file.note2")],
      });
      downloadTextFile(backupCodesFilename(), text);
    } catch {
      toast.error(t("backupSignup.generateError"));
    }
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      toast.success(t("backupSignup.copied"));
    } catch {
      toast.error(t("settings.account.backupCodes.copyError"));
    }
  };

  const finish = () => {
    // Remember that codes exist so the banner link and this card stop appearing.
    setUser({ ...user, backupCodesGeneratedAt: new Date().toISOString() });
    setCodes(null);
    setSaved(false);
    setForced(false);
  };

  const later = () => {
    dismissBackupStep();
    setForced(false);
  };

  return (
    <section className="bcs" role="region" aria-labelledby="bcs-title">
      <h2 className="eprompt__title" id="bcs-title">{t("backupSignup.title")}</h2>

      {!codes ? (
        <>
          <p className="egate__text">{t("backupSignup.body")}</p>
          {error && <p className="egate__error" role="alert">{error}</p>}
          <div className="egate__actions">
            <button type="button" className="egate__btn egate__btn--ghost" onClick={later} disabled={busy}>
              {t("backupSignup.later")}
            </button>
            <button type="button" className="egate__btn egate__btn--primary" onClick={generate} disabled={busy}>
              {busy ? t("backupSignup.working") : t("backupSignup.generate")}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="egate__error" role="note">{t("backupSignup.warning")}</p>
          <div className="bcs-printable">
            <p className="bcs-print-title">{t("backupSignup.printTitle")}</p>
            <ul className="bcs__codes" aria-label={t("backupSignup.title")}>
              {codes.map((code) => (
                <li key={code}>
                  <code>{code}</code>
                </li>
              ))}
            </ul>
            <p className="bcs-print-note">{t("backupSignup.printNote")}</p>
          </div>
          <div className="bcs__tools">
            <button type="button" className="egate__btn egate__btn--ghost" onClick={download}>
              <FaDownload aria-hidden="true" /> {t("backupSignup.download")}
            </button>
            <button type="button" className="egate__btn egate__btn--ghost" onClick={() => window.print()}>
              <FaPrint aria-hidden="true" /> {t("backupSignup.print")}
            </button>
            <button type="button" className="egate__btn egate__btn--ghost" onClick={copyAll}>
              <FaCopy aria-hidden="true" /> {t("backupSignup.copy")}
            </button>
          </div>
          <p className="su-hint">{t("backupSignup.screenshotHint")}</p>
          <label className="bcs__confirm">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            <span>{t("backupSignup.savedCheck")}</span>
          </label>
          <div className="egate__actions">
            <button type="button" className="egate__btn egate__btn--primary" onClick={finish} disabled={!saved}>
              {t("backupSignup.done")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
