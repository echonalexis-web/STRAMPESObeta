import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminAPI } from "../../services/api";
import SecureFileLink from "../../components/SecureFileLink";
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
              <th>Status</th>
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

function VerificationQueueTable({ data, onDecision, busyId }) {
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState("");

  const startReject = (userId) => {
    setRejectingId(userId);
    setReason("");
  };
  const cancelReject = () => {
    setRejectingId(null);
    setReason("");
  };
  const confirmReject = (userId) => {
    const note = reason.trim();
    if (!note) return;
    onDecision(userId, { decision: "rejected", note });
    cancelReject();
  };

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
              <th>Company</th>
              <th>Documents</th>
              <th>Status</th>
              <th>Submitted</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={6} className="admin-empty-state"><p>No pending verifications.</p></td>
              </tr>
            ) : (
              data.map((user) => (
                <Fragment key={user._id}>
                  <tr>
                    <td>
                      <div className="admin-stack-cell">
                        <strong>{user.name}</strong>
                        <span className="admin-muted">{user.email}</span>
                      </div>
                    </td>
                    <td>{user.companyName || "—"}</td>
                    <td>
                      <div className="admin-doc-links">
                        {user.businessPermitUrl ? (
                          <SecureFileLink className="admin-inline-btn" value={user.businessPermitUrl}>
                            Business Permit
                          </SecureFileLink>
                        ) : (
                          <span className="admin-muted">No permit</span>
                        )}
                        {user.registrationDocUrl ? (
                          <SecureFileLink className="admin-inline-btn" value={user.registrationDocUrl}>
                            Registration
                          </SecureFileLink>
                        ) : (
                          <span className="admin-muted">No registration</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span
                        className={`admin-status-badge ${
                          user.verificationStatus === "verified"
                            ? "active"
                            : user.verificationStatus === "pending"
                            ? "pending"
                            : "inactive"
                        }`}
                      >
                        {user.verificationStatus || "unverified"}
                      </span>
                      {user.verificationNote ? (
                        <div className="admin-muted admin-reject-note">Last note: {user.verificationNote}</div>
                      ) : null}
                    </td>
                    <td>{formatDate(user.verificationSubmittedAt || user.createdAt)}</td>
                    <td>
                      <div className="admin-inline-actions">
                        <button
                          className="admin-inline-btn"
                          type="button"
                          disabled={busyId === user._id || user.verificationStatus === "verified"}
                          onClick={() => onDecision(user._id, { decision: "approved" })}
                        >
                          Approve
                        </button>
                        <button
                          className="admin-inline-btn"
                          type="button"
                          disabled={busyId === user._id}
                          onClick={() => startReject(user._id)}
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                  {rejectingId === user._id ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="admin-reject-row">
                          <input
                            type="text"
                            value={reason}
                            placeholder="Reason shown to the employer (required)"
                            onChange={(event) => setReason(event.target.value)}
                          />
                          <button
                            className="admin-warning-confirm"
                            type="button"
                            disabled={!reason.trim() || busyId === user._id}
                            onClick={() => confirmReject(user._id)}
                          >
                            Confirm rejection
                          </button>
                          <button className="admin-warning-cancel" type="button" onClick={cancelReject}>
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
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
  const [suspendReason, setSuspendReason] = useState("");
  const [suspendPermanent, setSuspendPermanent] = useState(false);
  const [verifyBusyId, setVerifyBusyId] = useState(null);

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
    const verificationCount = users.filter(
      (user) => user.role === "employer" && user.verificationStatus !== "verified"
    ).length;

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

  const handleVerificationDecision = async (userId, payload) => {
    setVerifyBusyId(userId);
    try {
      const { data } = await adminAPI.updateEmployerVerification(userId, payload);
      const nextStatus = data?.user?.verificationStatus;
      setUsers((prev) =>
        prev.map((item) =>
          item._id === userId
            ? {
                ...item,
                verificationStatus: nextStatus || item.verificationStatus,
                verificationNote: data?.user?.verificationNote ?? null,
              }
            : item
        )
      );
      setActionToast({
        type: "success",
        message: `Verification ${payload.decision === "approved" ? "approved" : "rejected"}.`,
      });
    } catch (error) {
      setActionToast({
        type: "error",
        message: error.response?.data?.message || "Failed to update verification.",
      });
    } finally {
      setVerifyBusyId(null);
    }
  };

  const renderTabContent = () => {
    if (loading) {
      return <div className="admin-panel-card"><p className="admin-loading">Loading users...</p></div>;
    }

    if (activeTab === "employers") return <EmployersDirectory data={employerDirectory} onToggleStatus={handleToggleUserStatus} onViewProfile={handleViewProfile} />;
    if (activeTab === "jobseekers") return <JobseekersDirectory data={jobSeekerDirectory} onToggleStatus={handleToggleUserStatus} onViewProfile={handleViewProfile} />;
    return (
      <VerificationQueueTable
        data={verificationQueue}
        onDecision={handleVerificationDecision}
        busyId={verifyBusyId}
      />
    );
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
