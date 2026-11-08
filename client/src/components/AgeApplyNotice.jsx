import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import "../styles/age-gate.css";

// Replaces the Apply button on regular job vacancies for 15-17 accounts: says
// why and links to SPES, the program they can apply to. The server blocks the
// apply call regardless; this only explains it.
export default function AgeApplyNotice() {
  const { t } = useTranslation();
  return (
    <div className="age-notice" role="note">
      <p className="age-notice__title">{t("ageGate.applyNoticeTitle")}</p>
      <p className="age-notice__text">{t("ageGate.applyNoticeBody")}</p>
      <Link className="age-notice__link" to="/spes/applications">
        {t("ageGate.applyNoticeCta")}
      </Link>
    </div>
  );
}
