import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2, TriangleAlert, UserRound } from "lucide-react";
import { adminAPI } from "../../services/api";
import MetricCard from "../../components/MetricCard";
import StateBlock from "../../components/StateBlock";
import "../../styles/admin.css";
import AdminHeader from "./AdminHeader";
import AccountSecuritySummary from "../../components/AccountSecuritySummary";
import { userContactLabel } from "../../utils/usernameSignup";

const tabMeta = {
  employers: {
    labelKey: "superadmin.users.tabs.employers",
    Icon: Building2,
    badgeKey: "employerCount",
  },
  jobseekers: {
    labelKey: "superadmin.users.tabs.jobseekers",
    Icon: UserRound,
    badgeKey: "jobseekerCount",
  },
};

const formatDate = (value) => {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

function UserStatCards({ employers, jobseekers }) {
  const { t } = useTranslation();
  const stats = [
    { key: "employers", label: t("admin.kpi.employers"), value: employers, icon: <Building2 size={20} /> },
    { key: "jobseekers", label: t("admin.kpi.jobSeekers"), value: jobseekers, icon: <UserRound size={20} /> },
  ];

  return (
    <section className="admin-user-summary ds-metrics um-summary" aria-label={t("superadmin.users.summaryLabel")}>
      {stats.map((stat) => (
        <MetricCard key={stat.key} icon={stat.icon} value={stat.value} label={stat.label} />
      ))}
    </section>
  );
}

function UserDirectoryEmpty({ role }) {
  const { t } = useTranslation();
  return (
    <StateBlock
      kind="empty"
      className="um-state"
      title={t(`superadmin.users.empty.${role}Title`)}
      description={t("superadmin.users.empty.description")}
    />
  );
}

function UserDirectoryCards({ title, role, data, onToggleStatus, onViewProfile }) {
  return (
    <div className="admin-mobile-user-list" aria-label={`${title} mobile directory`}>
      {data.length === 0 ? (
        <UserDirectoryEmpty role={role} />
      ) : (
        data.map((user) => (
          <article key={user._id} className="admin-mobile-user-card">
            <div className="admin-mobile-user-card__header">
              <h4>{user.name}</h4>
              <span className={`admin-status-badge ${user.isActive === false ? "inactive" : "active"}`}>
                {user.isActive === false ? "Inactive" : "Active"}
              </span>
            </div>

            <div className="admin-mobile-user-card__meta">
              <div>
                <label>Email</label>
                <p>{userContactLabel(user)}</p>
              </div>
              <div>
                <label>Joined</label>
                <p>{formatDate(user.createdAt)}</p>
              </div>
            </div>

            <div className="admin-mobile-user-card__actions">
              <button type="button" className="admin-inline-btn admin-inline-btn--primary" onClick={() => onViewProfile(user)}>
                View Profile
              </button>
              <button type="button" className="admin-inline-btn admin-inline-btn--secondary" onClick={() => onToggleStatus(user)}>
                {user.isActive === false ? "Reactivate" : "Deactivate"}
              </button>
            </div>
          </article>
        ))
      )}
    </div>
  );
}

function EmployersDirectory({ data, onToggleStatus, onViewProfile }) {
  return (
    <div className="admin-panel-card">
      <div className="admin-card-header">
        <h3>Employers Directory</h3>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Status</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={5} className="um-empty-cell"><UserDirectoryEmpty role="employers" /></td>
              </tr>
            ) : (
              data.map((user) => (
                <tr key={user._id}>
                  <td>{user.name}</td>
                  <td>{userContactLabel(user)}</td>
                  <td>
                    <span className={`admin-status-badge ${user.isActive === false ? "inactive" : "active"}`}>
                      {user.isActive === false ? "Inactive" : "Active"}
                    </span>
                  </td>
                  <td>{formatDate(user.createdAt)}</td>
                  <td>
                    <div className="admin-inline-actions">
                      <button className="admin-inline-btn" type="button" onClick={() => onViewProfile(user)}>
                        View Profile
                      </button>
                      <button className="admin-inline-btn" type="button" onClick={() => onToggleStatus(user)}>
                        {user.isActive === false ? "Reactivate" : "Deactivate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <UserDirectoryCards title="Employers" role="employers" data={data} onToggleStatus={onToggleStatus} onViewProfile={onViewProfile} />
    </div>
  );
}

function JobseekersDirectory({ data, onToggleStatus, onViewProfile }) {
  return (
    <div className="admin-panel-card">
      <div className="admin-card-header">
        <h3>Jobseekers Directory</h3>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Status</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={5} className="um-empty-cell"><UserDirectoryEmpty role="jobseekers" /></td>
              </tr>
            ) : (
              data.map((user) => (
                <tr key={user._id}>
                  <td>{user.name}</td>
                  <td>{userContactLabel(user)}</td>
                  <td>
                    <span className={`admin-status-badge ${user.isActive === false ? "inactive" : "active"}`}>
                      {user.isActive === false ? "Inactive" : "Active"}
                    </span>
                  </td>
                  <td>{formatDate(user.createdAt)}</td>
                  <td>
                    <div className="admin-inline-actions">
                      <button className="admin-inline-btn" type="button" onClick={() => onViewProfile(user)}>
                        View Profile
                      </button>
                      <button className="admin-inline-btn" type="button" onClick={() => onToggleStatus(user)}>
                        {user.isActive === false ? "Reactivate" : "Deactivate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <UserDirectoryCards title="Jobseekers" role="jobseekers" data={data} onToggleStatus={onToggleStatus} onViewProfile={onViewProfile} />
    </div>
  );
}

const PAGE_SIZE = 20;

// Builds a page-number list with "…" gap markers, e.g. [1, "…", 4, 5, 6, "…", 12].
function buildPageList(current, total) {
  const pages = [];
  for (let i = 1; i <= total; i += 1) {
    if (i === 1 || i === total || (i >= current - 1 && i <= current + 1)) {
      pages.push(i);
    }
  }

  const withEllipsis = [];
  let previous = 0;
  for (const i of pages) {
    if (previous && i - previous > 1) {
      withEllipsis.push("…");
    }
    withEllipsis.push(i);
    previous = i;
  }
  return withEllipsis;
}

export default function UserManagement() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("employers");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  // Independent of the current page/tab — the tab badges need the TRUE total
  // per role, not just how many rows happen to be on the current page.
  const [counts, setCounts] = useState({ employerCount: 0, jobseekerCount: 0 });
  const [selectedUser, setSelectedUser] = useState(null);
  const [actionToast, setActionToast] = useState(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [suspendPermanent, setSuspendPermanent] = useState(false);

  useEffect(() => {
    if (!actionToast) return;

    const timer = window.setTimeout(() => {
      setActionToast(null);
    }, 2600);

    return () => window.clearTimeout(timer);
  }, [actionToast]);

  // Resets back to page 1 whenever the tab changes, so switching from a deep
  // page on one tab doesn't leave the other tab stranded on an out-of-range page.
  useEffect(() => {
    setPage(1);
  }, [activeTab]);

  useEffect(() => {
    let isMounted = true;

    const loadUsers = async () => {
      setLoading(true);
      try {
        const role = activeTab === "jobseekers" ? "jobseeker" : "employer";
        const { data } = await adminAPI.getUsers({ role, page, limit: PAGE_SIZE });
        if (!isMounted) return;
        setUsers(Array.isArray(data?.users) ? data.users : []);
        setTotalPages(Math.max(Number(data?.totalPages) || 1, 1));
      } catch {
        if (isMounted) {
          setUsers([]);
          setTotalPages(1);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadUsers();
    return () => {
      isMounted = false;
    };
  }, [activeTab, page]);

  // Total counts for the tab badges — fetched once (role never changes from
  // this page's own actions, so these never go stale during a session).
  useEffect(() => {
    let isMounted = true;

    const loadCounts = async () => {
      try {
        const [employerRes, jobseekerRes] = await Promise.all([
          adminAPI.getUsers({ role: "employer", page: 1, limit: 1 }),
          adminAPI.getUsers({ role: "jobseeker", page: 1, limit: 1 }),
        ]);
        if (!isMounted) return;
        setCounts({
          employerCount: Number(employerRes.data?.total) || 0,
          jobseekerCount: Number(jobseekerRes.data?.total) || 0,
        });
      } catch {
        // Badge counts are a nice-to-have; leave them at 0 on failure rather
        // than blocking the directory table itself.
      }
    };

    loadCounts();
    return () => {
      isMounted = false;
    };
  }, []);

  const directoryLabel = activeTab === "jobseekers" ? "Jobseekers" : "Employers";

  const performToggleUserStatus = async (user) => {
    const nextStatus = user.isActive === false;
    const action = nextStatus ? "reactivate" : "deactivate";

    try {
      if (nextStatus) {
        await adminAPI.reactivateUser(user._id);
      } else {
        await adminAPI.deactivateUser(user._id, {
          reason: suspendReason.trim(),
          permanent: suspendPermanent,
        });
      }

      setUsers((prev) =>
        prev.map((item) =>
          item._id === user._id ? { ...item, isActive: nextStatus } : item
        )
      );

      setActionToast({
        type: "success",
        message: `${user.name} has been ${
          nextStatus ? "reactivated" : suspendPermanent ? "banned" : "suspended"
        }.`,
      });
    } catch (error) {
      setActionToast({
        type: "error",
        message: error.response?.data?.message || `Failed to ${action} ${user.name || "user"}.`,
      });
    } finally {
      setSelectedUser(null);
      setSuspendReason("");
      setSuspendPermanent(false);
    }
  };

  const handleToggleUserStatus = (user) => {
    setSuspendReason("");
    setSuspendPermanent(false);
    setSelectedUser(user);
  };

  const handleViewProfile = (user) => {
    navigate(`/admin/users/${user._id}`);
  };

  const renderTabContent = () => {
    if (loading) {
      return (
        <div className="admin-panel-card">
          <StateBlock kind="loading" className="um-state" title={t("superadmin.users.loading")} />
        </div>
      );
    }

    if (activeTab === "jobseekers") return <JobseekersDirectory data={users} onToggleStatus={handleToggleUserStatus} onViewProfile={handleViewProfile} />;
    return <EmployersDirectory data={users} onToggleStatus={handleToggleUserStatus} onViewProfile={handleViewProfile} />;
  };

  return (
    <div className="admin-page-container um-page">
      <AdminHeader
        title={t("navbar.userManagement")}
        description={t("superadmin.users.subtitle")}
      />

      <UserStatCards
        employers={counts.employerCount}
        jobseekers={counts.jobseekerCount}
      />

      <div className="ds-tabs um-tabs" role="tablist" aria-label={t("superadmin.users.tabsLabel")}>
        {Object.entries(tabMeta).map(([key, meta]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            className={`ds-tab um-tab ${activeTab === key ? "is-active" : ""}`}
            onClick={() => setActiveTab(key)}
          >
            <meta.Icon size={18} aria-hidden="true" />
            <span>{t(meta.labelKey)}</span>
            <span className="ds-tab__count">
              {counts[meta.badgeKey]}
            </span>
          </button>
        ))}
      </div>

      {activeTab === "jobseekers" && <AccountSecuritySummary />}

      <div className="tab-content">{renderTabContent()}</div>

      {!loading && (
        <nav className="admin-pagination um-pagination" aria-label={t("superadmin.pagination.label")}>
          <button
            type="button"
            disabled={page === 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            Previous
          </button>
          <div className="um-pagination__pages">
            {buildPageList(page, totalPages).map((item, index) =>
              item === "…" ? (
                <span key={`ellipsis-${index}`} className="um-pagination__ellipsis">
                  …
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  className={`um-pagination__page ${item === page ? "active" : ""}`}
                  aria-current={item === page ? "page" : undefined}
                  disabled={item === page}
                  onClick={() => setPage(item)}
                >
                  {item}
                </button>
              )
            )}
          </div>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
          >
            Next
          </button>
        </nav>
      )}

      {selectedUser ? (
        <div className="admin-warning-modal-backdrop" onClick={() => setSelectedUser(null)}>
          <div
            className="admin-warning-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="um-warning-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="admin-warning-modal-header">
              <div className="admin-warning-modal-icon" aria-hidden="true"><TriangleAlert size={22} /></div>
              <div>
                <h3 id="um-warning-title">{selectedUser.isActive === false ? "Reactivate user" : "Deactivate user"}</h3>
              </div>
            </div>

            <p className="admin-warning-modal-text">
              You are about to {selectedUser.isActive === false ? "reactivate" : suspendPermanent ? "ban" : "suspend"} <strong>{selectedUser.name}</strong>.
              {selectedUser.isActive === false
                ? " This will restore account access for this user."
                : suspendPermanent
                  ? " This permanently revokes their access. They can still appeal to LMD Admin."
                  : " This disables their access until reactivated. They can appeal to LMD Admin."}
            </p>

            {selectedUser.isActive !== false ? (
              <div className="admin-suspend-fields">
                <label>
                  Reason (shown to the user)
                  <input
                    type="text"
                    value={suspendReason}
                    onChange={(event) => setSuspendReason(event.target.value)}
                    placeholder="e.g. Posting a fraudulent job vacancy"
                  />
                </label>
                <label className="admin-suspend-permanent">
                  <input
                    type="checkbox"
                    checked={suspendPermanent}
                    onChange={(event) => setSuspendPermanent(event.target.checked)}
                  />
                  <span>Permanent ban (instead of a temporary suspension)</span>
                </label>
              </div>
            ) : null}

            <div className="admin-warning-modal-actions">
              <button type="button" className="admin-warning-cancel" onClick={() => setSelectedUser(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="admin-warning-confirm"
                onClick={async () => {
                  const user = selectedUser;
                  setSelectedUser(null);
                  await performToggleUserStatus(user);
                }}
              >
                {selectedUser.isActive === false ? "Reactivate" : suspendPermanent ? "Ban user" : "Suspend user"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {actionToast && (
        <div className={`admin-toast admin-toast--${actionToast.type}`} role="status" aria-live="polite">
          {actionToast.message}
        </div>
      )}
    </div>
  );
}
