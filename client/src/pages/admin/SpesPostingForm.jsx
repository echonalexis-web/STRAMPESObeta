import { useTranslation } from "react-i18next";
import StateBlock from "../../components/StateBlock";
import AdminHeader from "./AdminHeader";
import "../../styles/admin.css";
import "../../styles/spes.css";

// Create / edit form for a SPES posting. Filled in by the admin UI step.
export default function SpesPostingForm() {
  const { t } = useTranslation();
  return (
    <div className="admin-page-container spes-admin">
      <AdminHeader title={t("spesPostings.formTitle")} description={t("spesPostings.adminDescription")} />
      <StateBlock kind="empty" title={t("spesPostings.adminEmptyTitle")} description={t("spesPostings.adminEmptyBody")} />
    </div>
  );
}
