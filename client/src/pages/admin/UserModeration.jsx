import { useContext, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaArrowLeft, FaShieldAlt, FaFlag, FaEnvelopeOpenText } from "react-icons/fa";
import "../../styles/admin.css";
import "../../styles/moderation.css";
import AdminHeader from "./AdminHeader";
import { AuthContext } from "../../context/AuthContext";
import { ReportsQueue, AppealsQueue } from "./ModerationQueues";

const TABS = {
  reports: { labelKey: "superadmin.moderation.tabs.reports", icon: <FaFlag aria-hidden="true" />, accent: "reports" },
  appeals: { labelKey: "superadmin.moderation.tabs.appeals", icon: <FaEnvelopeOpenText aria-hidden="true" />, accent: "appeals" },
};

export default function UserModeration() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // PESO admins see the reports queue only; appeals stay with the superadmin.
  const { user } = useContext(AuthContext);
  const isSuperadmin = user?.role === "superadmin";
  const visibleTabs = isSuperadmin ? TABS : { reports: TABS.reports };
  const requestedTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState(visibleTabs[requestedTab] ? requestedTab : "reports");
  const [reportStats, setReportStats] = useState(null);
  const [appealStats, setAppealStats] = useState(null);

  const selectTab = (key) => {
    setActiveTab(key);
    setSearchParams({ tab: key }, { replace: true });
  };

  const tabBadge = (key) => {
    if (key === "reports") return reportStats ? reportStats.open + reportStats.under_review : null;
    return appealStats ? appealStats.pending + appealStats.under_review : null;
  };

  return (
    <div className={`admin-page-container mq-scope mq-scope--${activeTab}`}>
      <AdminHeader
        title={t("navbar.reportsAppeals")}
        description={t("superadmin.moderation.subtitle")}
        icon={<FaShieldAlt aria-hidden="true" />}
      />

      <button type="button" className="admin-backlink" onClick={() => navigate("/admin/users")}>
        <FaArrowLeft aria-hidden="true" /> {t("superadmin.moderation.back")}
      </button>

      <div className="ds-tabs mq-tab-bar" role="tablist" aria-label={t("superadmin.moderation.tabsLabel")}>
        {Object.entries(visibleTabs).map(([key, meta]) => {
          const badge = tabBadge(key);
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={activeTab === key}
              className={`ds-tab mq-tab mq-tab--${meta.accent} ${activeTab === key ? "active is-active" : ""}`}
              onClick={() => selectTab(key)}
            >
              <span className="mq-tab__icon">{meta.icon}</span>
              <span className="mq-tab__label">{t(meta.labelKey)}</span>
              {badge ? <span className="mq-tab__badge ds-tab__count">{badge}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="tab-content">
        <div hidden={activeTab !== "reports"}>
          <ReportsQueue onStats={setReportStats} />
        </div>
        {isSuperadmin && (
          <div hidden={activeTab !== "appeals"}>
            <AppealsQueue onStats={setAppealStats} />
          </div>
        )}
      </div>
    </div>
  );
}
