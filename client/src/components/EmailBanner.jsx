import { useContext } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthContext } from "../context/AuthContext";
import { shouldShowEmailBanner } from "../utils/usernameSignup";
import { openEmailGate } from "../utils/emailGateEvents";
import "../styles/username-signup.css";

// Slim, non-blocking notice for a jobseeker with no verified email. It sits in
// the page flow under the top bar (not fixed), so it never covers content.
// The server, not this banner, is what actually limits the account.
export default function EmailBanner() {
  const { user } = useContext(AuthContext);
  const { pathname } = useLocation();
  const { t } = useTranslation();

  if (!shouldShowEmailBanner({ user, pathname })) return null;

  const needsBackupCodes = !user?.backupCodesGeneratedAt;

  return (
    <div className="ebanner" role="region" aria-label={t("emailBanner.addEmail")}>
      <p className="ebanner__text">{t("emailBanner.message")}</p>
      <div className="ebanner__actions">
        <button type="button" className="ebanner__btn" onClick={() => openEmailGate()}>
          {t("emailBanner.addEmail")}
        </button>
        {needsBackupCodes && (
          <button type="button" className="ebanner__btn ebanner__btn--ghost" onClick={() => openEmailGate("backup")}>
            {t("emailBanner.saveBackupCodes")}
          </button>
        )}
      </div>
    </div>
  );
}
