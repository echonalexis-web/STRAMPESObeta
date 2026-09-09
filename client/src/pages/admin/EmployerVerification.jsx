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

function VerificationQueueTable({ data, onDecision, busyId, readOnly }) {
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
              {!readOnly ? <th>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={readOnly ? 5 : 6} className="admin-empty-state"><p>No pending verifications.</p></td>
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
                    {!readOnly ? (
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
                  {!readOnly && rejectingId === user._id ? (
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

export default function EmployerVerification() {
  const { user } = useContext(AuthContext);
  const readOnly = user?.role === "superadmin";

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

    const loadQueue = async () => {
      try {
        const { data } = await verificationAPI.getQueue({ page: 1, limit: 100 });
        if (!isMounted) return;
        setQueue(Array.isArray(data?.items) ? data.items : []);
        setLoadError("");
      } catch (error) {
        if (!isMounted) return;
        setQueue([]);
        setLoadError(error.response?.data?.message || "Failed to load the verification queue.");
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadQueue();
    return () => {
      isMounted = false;
    };
  }, []);

  const pendingCount = useMemo(() => queue.length, [queue]);

  const handleDecision = async (userId, payload) => {
    setBusyId(userId);
    try {
      await verificationAPI.review(userId, payload);
      // The queue only holds pending employers, so a reviewed one drops out.
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
          readOnly
            ? "Read-only view of employers awaiting accreditation review."
            : "Review the documents of employers awaiting accreditation and approve or reject them."
        }
      />

      <section className="admin-stat-row admin-stat-row--compact">
        <article className="admin-stat-card admin-stat-card--compact admin-stat-card--warning">
          <span className="admin-stat-label">Pending Verification</span>
          <strong>{pendingCount}</strong>
        </article>
      </section>

      {readOnly ? (
        <p className="admin-muted" style={{ margin: "0 0 1rem" }}>
          Only LMD PESO admins can approve or reject submissions.
        </p>
      ) : null}

      <div className="tab-content">
        {loading ? (
          <div className="admin-panel-card"><p className="admin-loading">Loading verification queue...</p></div>
        ) : loadError ? (
          <div className="admin-panel-card"><p className="admin-empty-state">{loadError}</p></div>
        ) : (
          <VerificationQueueTable
            data={queue}
            onDecision={handleDecision}
            busyId={busyId}
            readOnly={readOnly}
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
