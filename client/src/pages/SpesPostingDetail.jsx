import { useTranslation } from "react-i18next";
import StateBlock from "../components/StateBlock";
import "../styles/spes.css";

// Applicant view of one SPES posting. Filled in by the applicant UI step.
export default function SpesPostingDetail() {
  const { t } = useTranslation();
  return (
    <main className="spes-page">
      <StateBlock kind="empty" title={t("spesPostings.emptyTitle")} description={t("spesPostings.emptyBody")} />
    </main>
  );
}
