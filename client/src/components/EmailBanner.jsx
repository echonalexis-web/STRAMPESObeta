import { useContext } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaTimes } from "react-icons/fa";
import { AuthContext } from "../context/AuthContext";
import useEmailNudge from "../hooks/useEmailNudge";
import { shouldShowEmailBanner } from "../utils/usernameSignup";
import { openEmailPrompt } from "../utils/emailNudge";
import "../styles/username-signup.css";

// A slim, dismissible reminder that an email is a good idea (notifications while
// away, and resetting your own password). It is optional: nothing is blocked
// without one. It sits in the page flow under the top bar (not fixed), and after
// a dismissal it returns rarely: 14, 45, 90 days, then never (utils/emailNudge.js).
export default function EmailBanner() {
  const { user } = useContext(AuthContext);
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const userId = user?._id || user?.id;
  const { nudge, dismiss } = useEmailNudge(userId);

  if (!shouldShowEmailBanner({ user, pathname, nudge })) return null;

  const needsBackupCodes = !user?.backupCodesGeneratedAt;

  return (
    <div className="ebanner" role="region" aria-label={t("emailBanner.addEmail")}>
      <p className="ebanner__text">{t("emailBanner.messageBenefits")}</p>
      <div className="ebanner__actions">
        <button type="button" className="ebanner__btn" onClick={() => openEmailPrompt()}>
          {t("emailBanner.addEmail")}
        </button>
        {needsBackupCodes && (
          <button type="button" className="ebanner__btn ebanner__btn--ghost" onClick={() => openEmailPrompt("backup")}>
            {t("emailBanner.saveBackupCodes")}
          </button>
        )}
        <button type="button" className="ebanner__close" onClick={dismiss} aria-label={t("emailBanner.dismiss")}>
          <FaTimes aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
