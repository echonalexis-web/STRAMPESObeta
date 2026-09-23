import { Fragment, useContext, useEffect, useMemo, useState } from "react";
import { AuthContext } from "../../context/AuthContext";
import { verificationAPI } from "../../services/api";
import SecureFileLink from "../../components/SecureFileLink";
import "../../styles/admin.css";
import AdminHeader from "./AdminHeader";

const formatDate = (value) => {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const STATUS_TABS = [
  { key: "pending", label: "Pending" },
  { key: "verified", label: "Verified" },
];

function VerificationQueueTable({ data, onDecision, busyId, showActions, title, emptyMessage, dateLabel, dateAccessor }) {
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState("");
  const colCount = showActions ? 6 : 5;

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
        <h3>{title}</h3>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Employer</th>
              <th>Company</th>
              <th>Documents</th>
              <th>Status</th>
              <th>{dateLabel}</th>
              {showActions ? <th>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="admin-empty-state"><p>{emptyMessage}</p></td>
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
                    <td>{formatDate(dateAccessor(user))}</td>
                    {showActions ? (
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
                    ) : null}
                  </tr>
                  {showActions && rejectingId === user._id ? (
                    <tr>
                      <td colSpan={colCount}>
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

export default function EmployerVerification() {
  const { user } = useContext(AuthContext);
  // Only a plain admin may approve/reject (mirrors the backend guards on
  // both the legacy PATCH /verification/:id route and the id-scoped
  // POST /admin/employers/:id/verification/approve|reject routes, which are
  // both authorizeRoles("admin") — superadmin is intentionally read-only
  // here for oversight, on every status tab).
  const canAct = user?.role === "admin";

  const [statusTab, setStatusTab] = useState("pending");
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [actionToast, setActionToast] = useState(null);

  useEffect(() => {
    if (!actionToast) return;
    const timer = window.setTimeout(() => setActionToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [actionToast]);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    const loadQueue = async () => {
      try {
        const { data } = await verificationAPI.getQueue({ page: 1, limit: 100, status: statusTab });
        if (!isMounted) return;
        setQueue(Array.isArray(data?.items) ? data.items : []);
        setLoadError("");
      } catch (error) {
        if (!isMounted) return;
        setQueue([]);
        setLoadError(error.response?.data?.message || "Failed to load the verification list.");
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadQueue();
    return () => {
      isMounted = false;
    };
  }, [statusTab]);

  const count = useMemo(() => queue.length, [queue]);
  const showActions = canAct && statusTab === "pending";
  const isPendingTab = statusTab === "pending";

  const handleDecision = async (userId, payload) => {
    setBusyId(userId);
    try {
      if (payload.decision === "approved") {
        await verificationAPI.approve(userId);
      } else {
        await verificationAPI.reject(userId, payload.note);
      }
      // A decided employer leaves the Pending tab; nothing to remove when
      // acting from elsewhere since actions only render on that tab.
      setQueue((prev) => prev.filter((item) => item._id !== userId));
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
      setBusyId(null);
    }
  };

  return (
    <div className="admin-page-container">
      <AdminHeader
        title="Employer Verification"
        description={
          !isPendingTab
            ? "Read-only list of employers who have already been accredited."
            : canAct
            ? "Review the documents of employers awaiting accreditation and approve or reject them."
            : "Read-only view of employers awaiting accreditation review."
        }
      />

      <div className="admin-tab-filters" role="tablist" aria-label="Verification status">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={statusTab === tab.key}
            className={statusTab === tab.key ? "active" : ""}
            onClick={() => setStatusTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <section className="admin-stat-row admin-stat-row--compact">
        <article
          className={`admin-stat-card admin-stat-card--compact admin-stat-card--${
            isPendingTab ? "warning" : "success"
          }`}
        >
          <span className="admin-stat-label">{isPendingTab ? "Pending Verification" : "Verified Employers"}</span>
          <strong>{count}</strong>
        </article>
      </section>

      {isPendingTab && !canAct ? (
        <p className="admin-muted" style={{ margin: "0 0 1rem" }}>
          Only LMD PESO admins can approve or reject submissions.
        </p>
      ) : null}

      <div className="tab-content">
        {loading ? (
          <div className="admin-panel-card"><p className="admin-loading">Loading verification list...</p></div>
        ) : loadError ? (
          <div className="admin-panel-card"><p className="admin-empty-state">{loadError}</p></div>
        ) : (
          <VerificationQueueTable
            data={queue}
            onDecision={handleDecision}
            busyId={busyId}
            showActions={showActions}
            title={isPendingTab ? "Verification Queue" : "Verified Employers"}
            emptyMessage={isPendingTab ? "No pending verifications." : "No verified employers yet."}
            dateLabel={isPendingTab ? "Submitted" : "Verified"}
            dateAccessor={(item) =>
              isPendingTab ? item.verificationSubmittedAt || item.createdAt : item.verificationReviewedAt || item.createdAt
            }
          />
        )}
      </div>

      {actionToast && (
        <div className={`admin-toast admin-toast--${actionToast.type}`} role="status" aria-live="polite">
          {actionToast.message}
        </div>
      )}
    </div>
  );
}
