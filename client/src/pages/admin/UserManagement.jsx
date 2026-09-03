import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminAPI } from "../../services/api";
import "../../styles/admin.css";
import AdminHeader from "./AdminHeader";

const tabMeta = {
  employers: {
    label: "Employers Management",
    emoji: "🏢",
    badgeKey: "employerCount",
  },
  jobseekers: {
    label: "Jobseekers Management",
    emoji: "👤",
    badgeKey: "jobseekerCount",
  },
  verification: {
    label: "Verification Queue",
    emoji: "📋",
    badgeKey: "verificationCount",
    warning: true,
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

function UserStatCards({ employers, jobseekers, verificationQueue }) {
  const stats = [
    { label: "Employers", value: employers, tone: "info" },
    { label: "Jobseekers", value: jobseekers, tone: "success" },
    { label: "Pending Verification", value: verificationQueue, tone: "warning" },
  ];

  return (
    <section className="admin-stat-row admin-stat-row--compact">
      {stats.map((stat) => (
        <article key={stat.label} className={`admin-stat-card admin-stat-card--compact admin-stat-card--${stat.tone}`}>
          <span className="admin-stat-label">{stat.label}</span>
          <strong>{stat.value}</strong>
        </article>
      ))}
    </section>
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
                <td colSpan={5} className="admin-empty-state"><p>No employers found.</p></td>
              </tr>
            ) : (
              data.map((user) => (
                <tr key={user._id}>
                  <td>{user.name}</td>
                  <td>{user.email}</td>
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
              <th>Role</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={5} className="admin-empty-state"><p>No jobseekers found.</p></td>
              </tr>
            ) : (
              data.map((user) => (
                <tr key={user._id}>
                  <td>{user.name}</td>
                  <td>{user.email}</td>
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
    </div>
  );
}

function VerificationQueueTable({ data }) {
  return (
    <div className="admin-panel-card">
      <div className="admin-card-header">
        <h3>Verification Queue</h3>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Employer</th>
              <th>Email</th>
              <th>Company</th>
              <th>Status</th>
              <th>Requested</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={5} className="admin-empty-state"><p>No pending verifications.</p></td>
              </tr>
            ) : (
              data.map((user) => (
                <tr key={user._id}>
                  <td>{user.name}</td>
                  <td>{user.email}</td>
                  <td>{user.companyName || "—"}</td>
                  <td>
                    <span className={`admin-status-badge ${user.verificationStatus === "verified" ? "active" : user.verificationStatus === "pending" ? "pending" : "inactive"}`}>
                      {user.verificationStatus || "unverified"}
                    </span>
                  </td>
                  <td>{formatDate(user.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function UserManagement() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("employers");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);
  const [actionToast, setActionToast] = useState(null);

  useEffect(() => {
    if (!actionToast) return;

    const timer = window.setTimeout(() => {
      setActionToast(null);
    }, 2600);

    return () => window.clearTimeout(timer);
  }, [actionToast]);

  useEffect(() => {
    let isMounted = true;

    const loadUsers = async () => {
      try {
        const { data } = await adminAPI.getUsers({ page: 1, limit: 250 });
        if (!isMounted) return;
        setUsers(Array.isArray(data?.users) ? data.users : []);
      } catch (error) {
        if (isMounted) {
          setUsers([]);
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
  }, []);

  const counts = useMemo(() => {
    const employerCount = users.filter((user) => user.role === "employer").length;
    const jobseekerCount = users.filter((user) => user.role === "resident" || user.role === "jobseeker").length;
    const verificationCount = users.filter((user) => user.role === "employer" && (user.verificationStatus === "pending" || user.verificationStatus === "unverified")).length;

    return { employerCount, jobseekerCount, verificationCount };
  }, [users]);

  const employerDirectory = users.filter((user) => user.role === "employer");
  const jobSeekerDirectory = users.filter((user) => user.role === "resident" || user.role === "jobseeker");
  const verificationQueue = employerDirectory.filter((user) => user.verificationStatus !== "verified");

  const performToggleUserStatus = async (user) => {
    const nextStatus = user.isActive === false;
    const action = nextStatus ? "reactivate" : "deactivate";

    try {
      if (nextStatus) {
        await adminAPI.reactivateUser(user._id);
      } else {
        await adminAPI.deactivateUser(user._id);
      }

      setUsers((prev) =>
        prev.map((item) =>
          item._id === user._id ? { ...item, isActive: nextStatus } : item
        )
      );

      setActionToast({
        type: "success",
        message: `${user.name} has been ${nextStatus ? "reactivated" : "deactivated"}.`,
      });
    } catch (error) {
      setActionToast({
        type: "error",
        message: error.response?.data?.message || `Failed to ${action} ${user.name || "user"}.`,
      });
    } finally {
      setSelectedUser(null);
    }
  };

  const handleToggleUserStatus = (user) => {
    setSelectedUser(user);
  };

  const handleViewProfile = (user) => {
    navigate(`/admin/users/${user._id}`);
  };

  const renderTabContent = () => {
    if (loading) {
      return <div className="admin-panel-card"><p className="admin-loading">Loading users...</p></div>;
    }

    if (activeTab === "employers") return <EmployersDirectory data={employerDirectory} onToggleStatus={handleToggleUserStatus} onViewProfile={handleViewProfile} />;
    if (activeTab === "jobseekers") return <JobseekersDirectory data={jobSeekerDirectory} onToggleStatus={handleToggleUserStatus} onViewProfile={handleViewProfile} />;
    return <VerificationQueueTable data={verificationQueue} />;
  };

  return (
    <div className="admin-page-container">
      <AdminHeader
        title="User Management"
        description="Supervise employer accreditations, jobseeker profiles, and compliance verification queues."
      />

      <UserStatCards
        employers={counts.employerCount}
        jobseekers={counts.jobseekerCount}
        verificationQueue={counts.verificationCount}
      />

      <div className="tab-pill-bar" role="tablist" aria-label="User management tabs">
        {Object.entries(tabMeta).map(([key, meta]) => (
          <button
            key={key}
            type="button"
            className={`tab-pill ${activeTab === key ? "active" : ""}`}
            onClick={() => setActiveTab(key)}
          >
            <span>{meta.emoji} {meta.label}</span>
            <span className={`badge ${meta.warning ? "warning" : ""}`}>
              {counts[meta.badgeKey]}
            </span>
          </button>
        ))}
      </div>

      <div className="tab-content">{renderTabContent()}</div>

      {selectedUser ? (
        <div className="admin-warning-modal-backdrop" onClick={() => setSelectedUser(null)}>
          <div className="admin-warning-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-warning-modal-header">
              <div className="admin-warning-modal-icon">!</div>
              <div>
                <p>Account action</p>
                <h3>{selectedUser.isActive === false ? "Reactivate user" : "Deactivate user"}</h3>
              </div>
            </div>

            <p className="admin-warning-modal-text">
              You are about to {selectedUser.isActive === false ? "reactivate" : "deactivate"} <strong>{selectedUser.name}</strong>.
              {selectedUser.isActive === false ? " This will restore account access for this user." : " This will temporarily disable their access to the platform."}
            </p>

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
                {selectedUser.isActive === false ? "Reactivate" : "Deactivate"}
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
