import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { AuthContext } from "../context/AuthContext";
import { authAPI } from "../services/api";
import AppModal from "./AppModal";
import DobPrompt from "./DobPrompt";
import "../styles/age-gate.css";

const JOBSEEKER_ROLES = ["jobseeker", "employee", "resident"];

// Blocking prompt for legacy jobseeker accounts that have no date of birth yet
// (accounts made before it was required, and earlier Google sign-ups). It only
// appears once the profile has been hydrated from the server, which includes a
// server-computed `ageTier`; "unknown" means no usable date of birth. The date
// is saved once and then locked. An account flagged for age review is shown a
// notice instead (nothing is deleted automatically).
export default function DobGate() {
  const { user, setUser, logout } = useContext(AuthContext);
  const { t } = useTranslation();

  if (!user || !JOBSEEKER_ROLES.includes(user.role)) return null;

  if (user.ageReviewRequired === true) {
    return (
      <AppModal isOpen onClose={() => {}} hideClose title={t("ageGate.reviewTitle")} panelClassName="dob-prompt">
        <div className="dob-prompt__form">
          <p className="dob-prompt__text">{t("ageGate.reviewBody")}</p>
          <div className="dob-prompt__actions">
            <button type="button" className="dob-prompt__btn" onClick={logout}>
              {t("ageGate.signOut")}
            </button>
          </div>
        </div>
      </AppModal>
    );
  }

  if (user.ageTier !== "unknown") return null;

  const handleSubmit = async (dateOfBirth) => {
    try {
      const { data } = await authAPI.setMyDateOfBirth(dateOfBirth);
      setUser({ ...user, dateOfBirth, ageTier: data.ageTier });
      return null;
    } catch (err) {
      const code = err?.response?.data?.code;
      if (code === "AGE_UNDER_MINIMUM") setUser({ ...user, ageReviewRequired: true });
      return code || "GENERIC";
    }
  };

  return (
    <DobPrompt
      isOpen
      onSubmit={handleSubmit}
      title={t("ageGate.legacyTitle")}
      description={t("ageGate.legacyBody")}
    />
  );
}
