import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FaArrowLeft, FaShieldAlt, FaFlag, FaEnvelopeOpenText } from "react-icons/fa";
import "../../styles/admin.css";
import "../../styles/moderation.css";
import AdminHeader from "./AdminHeader";
import { ReportsQueue, AppealsQueue } from "./ModerationQueues";

const TABS = {
  reports: { label: "User Reports", icon: <FaFlag aria-hidden="true" />, accent: "reports" },
  appeals: { label: "Suspension Appeals", icon: <FaEnvelopeOpenText aria-hidden="true" />, accent: "appeals" },
};

export default function UserModeration() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState(TABS[requestedTab] ? requestedTab : "reports");
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
        title="Reports & Appeals"
        description="Review user-submitted reports and decide on suspension appeals."
        icon={<FaShieldAlt aria-hidden="true" />}
      />

      <button type="button" className="admin-backlink" onClick={() => navigate("/admin/users")}>
        <FaArrowLeft aria-hidden="true" /> Back to User Management
      </button>

      <div className="tab-pill-bar mq-tab-bar" role="tablist" aria-label="Moderation tabs">
        {Object.entries(TABS).map(([key, meta]) => {
          const badge = tabBadge(key);
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={activeTab === key}
              className={`tab-pill mq-tab mq-tab--${meta.accent} ${activeTab === key ? "active" : ""}`}
              onClick={() => selectTab(key)}
            >
              <span className="mq-tab__dot" aria-hidden="true" />
              <span className="mq-tab__icon">{meta.icon}</span>
              <span>{meta.label}</span>
              {badge ? <span className="mq-tab__badge">{badge}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="tab-content">
        <div hidden={activeTab !== "reports"}>
          <ReportsQueue onStats={setReportStats} />
        </div>
        <div hidden={activeTab !== "appeals"}>
          <AppealsQueue onStats={setAppealStats} />
        </div>
      </div>
    </div>
  );
}
