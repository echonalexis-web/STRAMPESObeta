import { useTranslation } from "react-i18next";
import StateBlock from "../components/StateBlock";
import "../styles/spes.css";

// Applicant list of SPES postings. Filled in by the applicant UI step.
export default function SpesPostings() {
  const { t } = useTranslation();
  return (
    <main className="spes-page">
      <h1>{t("spesPostings.title")}</h1>
      <StateBlock kind="empty" title={t("spesPostings.emptyTitle")} description={t("spesPostings.emptyBody")} />
    </main>
  );
}
