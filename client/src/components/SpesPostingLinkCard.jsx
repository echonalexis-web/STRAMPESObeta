import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaGraduationCap } from "react-icons/fa";
import "../styles/spes.css";

// Shown on a news article that is (or announces) a SPES posting. The posting itself,
// its eligibility and the apply flow live on the posting page; this is only the link.
// An announcement posted the old way (category spes) resolves to a posting by its
// own id, so the same link works until it is migrated.
export default function SpesPostingLinkCard({ announcement }) {
  const { t } = useTranslation();
  const postingId = announcement?.spesPostingId || announcement?._id;
  if (!postingId) return null;
  return (
    <section className="spes-panel" aria-label={t("spes.panel.aria")}>
      <h2 className="spes-panel__title">
        <FaGraduationCap aria-hidden="true" /> {t("spes.panel.title")}
      </h2>
      <p className="spes-note">{t("spesPostings.newsCardBody")}</p>
      <Link to={`/spes/postings/${postingId}`} className="spes-btn">
        {t("spesPostings.newsCardCta")}
      </Link>
    </section>
  );
}
