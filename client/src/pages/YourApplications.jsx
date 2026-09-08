import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { jobAPI } from "../services/api";
import EmployerAvatar from "../components/EmployerAvatar";
import "../styles/jobboard.css";
import { FaExclamationTriangle, FaRegEye, FaPen, FaTrashAlt } from "react-icons/fa";

const PER_PAGE = 5;

const formatDate = (date) => {
  if (!date) return "N/A";
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const baseName = (path) => (path ? String(path).replace(/\\/g, "/").split("/").pop() : "");

const locationLine = (address) => {
  if (!address) return "Location not specified";
  const parts = String(address).split(", ").filter(Boolean);
  return parts.length > 2 ? parts.slice(1).join(", ") : address;
};

const STATUS_META = {
  pending:     { label: "Pending",      tone: "pending" },
  applied:     { label: "Pending",      tone: "pending" },
  reviewed:    { label: "Reviewed",     tone: "pending" },
  shortlisted: { label: "Shortlisted",  tone: "shortlisted" },
  accepted:    { label: "Accepted",     tone: "accepted" },
  hired:       { label: "Hired",        tone: "accepted" },
  rejected:    { label: "Not selected", tone: "rejected" },
};

const statusMeta = (status) =>
  STATUS_META[String(status || "").toLowerCase()] || { label: status || "Pending", tone: "pending" };

const TABS = [
  { key: "all", label: "All", match: () => true },
  { key: "pending", label: "Pending", match: (s) => s === "pending" || s === "applied" },
  { key: "reviewed", label: "Reviewed", match: (s) => s === "reviewed" },
  { key: "shortlisted", label: "Shortlisted", match: (s) => s === "shortlisted" },
  { key: "accepted", label: "Accepted", match: (s) => s === "accepted" || s === "hired" },
  { key: "rejected", label: "Rejected", match: (s) => s === "rejected" },
];

export default function YourApplications() {
  const navigate = useNavigate();

  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [page, setPage] = useState(1);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  const fetchApplications = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await jobAPI.getMyApplications();
      setApplications(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load your applications");
      setApplications([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApplications();
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  useEffect(() => {
    setPage(1);
  }, [activeTab]);

  const counts = useMemo(() => {
    const c = {};
    for (const tab of TABS) {
      c[tab.key] = applications.filter((a) => tab.match(String(a.status || "").toLowerCase())).length;
    }
    return c;
  }, [applications]);

  const filtered = useMemo(() => {
    const tab = TABS.find((t) => t.key === activeTab) || TABS[0];
    return applications.filter((a) => tab.match(String(a.status || "").toLowerCase()));
  }, [applications, activeTab]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const handleConfirmWithdraw = async () => {
    if (!confirmDeleteId) return;
    setIsDeleting(true);
    try {
      await jobAPI.deleteApplication(confirmDeleteId);
      setToastMessage("Application withdrawn.");
      setConfirmDeleteId(null);
      await fetchApplications();
    } catch (err) {
      setToastMessage(err.response?.data?.message || "Failed to withdraw application.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="jobboard-container">
      <section className="jobboard-hero jobboard-hero--slim">
        <div className="jobboard-hero-content">
          <h1>Your Applications</h1>
          <p>Track every job you have applied to and pick up where you left off.</p>
        </div>
      </section>

      <div className="jobboard-content">
        <div className="app-status-tabs" role="tablist" aria-label="Filter applications by status">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              className={`app-tab ${activeTab === tab.key ? "is-active" : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}<span className="app-tab-n">{counts[tab.key] ?? 0}</span>
            </button>
          ))}
        </div>

        {error && <div className="error-message" style={{ marginBottom: "1.5rem" }}>{error}</div>}

        {loading ? (
          <p className="app-list-empty">Loading your applications…</p>
        ) : applications.length === 0 ? (
          <p className="app-list-empty">
            You haven’t applied to any jobs yet. <button className="link-btn" onClick={() => navigate("/jobs")}>Browse jobs</button>
          </p>
        ) : (
          <>
            {visible.length === 0 ? (
              <p className="app-list-empty">No applications in this status.</p>
            ) : (
              <div className="applications-list">
                {visible.map((application) => {
                  const job = application.vacancy || {};
                  const employer = job.employer || {};
                  const meta = statusMeta(application.status);
                  const jobId = job._id;

                  return (
                    <div key={application._id} className="app-row">
                      <EmployerAvatar employer={employer} className="app-row-logo" />

                      <div className="app-row-main">
                        <div className="app-row-main-top">
                          <button
                            type="button"
                            className="app-row-title"
                            onClick={() => jobId && navigate(`/jobs/${jobId}`)}
                            disabled={!jobId}
                          >
                            {job.title || "Untitled position"}
                          </button>
                          <span className={`status-pill tone-${meta.tone}`}>{meta.label}</span>
                        </div>
                        <div className="app-row-sub">
                          {(employer.companyName || employer.name || "Unknown employer")}
                          {" · "}
                          {locationLine(job.location)}
                        </div>
                        <div className="app-row-metaline">
                          Applied {formatDate(application.appliedAt)}
                          {application.resume ? ` · résumé ${baseName(application.resume)}` : ""}
                        </div>
                      </div>

                      <div className="app-row-actions">
                        <button
                          type="button"
                          className="app-act app-act-view"
                          onClick={() => jobId && navigate(`/jobs/${jobId}`)}
                          disabled={!jobId}
                        >
                          <FaRegEye /> View
                        </button>
                        <button
                          type="button"
                          className="app-act app-act-edit"
                          onClick={() => jobId && navigate(`/jobs/${jobId}/apply?mode=edit`)}
                          disabled={!jobId}
                        >
                          <FaPen /> Edit
                        </button>
                        <button
                          type="button"
                          className="app-act app-act-withdraw"
                          onClick={() => setConfirmDeleteId(application._id)}
                        >
                          <FaTrashAlt /> Withdraw
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="pagination-controls">
              <button
                className="pagination-btn"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
              >
                ← Previous
              </button>
              <div className="pagination-info">Page {safePage} of {totalPages}</div>
              <button
                className="pagination-btn"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
              >
                Next →
              </button>
            </div>
          </>
        )}
      </div>

      {toastMessage && (
        <div className="app-toast app-toast--success" role="status" aria-live="polite">{toastMessage}</div>
      )}

      {confirmDeleteId && (
        <div className="modal-overlay" onClick={() => !isDeleting && setConfirmDeleteId(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon modal-icon-warning"><FaExclamationTriangle /></div>
            <h2>Withdraw application?</h2>
            <p>This removes your application for this job. You can apply again while the vacancy is open.</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmDeleteId(null)} disabled={isDeleting}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={handleConfirmWithdraw} disabled={isDeleting}>
                {isDeleting ? "Withdrawing…" : "Withdraw"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
