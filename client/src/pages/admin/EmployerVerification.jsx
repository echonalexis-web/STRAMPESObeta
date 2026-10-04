import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { FaCheckCircle, FaClipboardCheck, FaClock, FaEnvelope, FaFileAlt, FaInfoCircle, FaSearch } from "react-icons/fa";
import { AuthContext } from "../../context/AuthContext";
import { verificationAPI } from "../../services/api";
import SecureFileLink from "../../components/SecureFileLink";
import "../../styles/admin.css";
import "../../styles/employer-verification.css";
import AdminHeader from "./AdminHeader";

const PAGE_SIZE = 10;

const formatDate = (value) => {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const STATUS_TABS = [
  { key: "pending", label: "Pending", dotTone: "pending" },
  { key: "verified", label: "Verified", dotTone: "verified" },
  { key: "all", label: "All Records", dotTone: null },
];

const STATUS_META = {
  pending: { label: "Pending Review", tone: "pending" },
  verified: { label: "Verified", tone: "verified" },
  rejected: { label: "Rejected", tone: "rejected" },
  unverified: { label: "Unverified", tone: "unverified" },
};

const statusMeta = (status) => STATUS_META[status] || STATUS_META.unverified;

// Reviewed items show when they were decided; everything else shows when it
// was submitted — one rule that works uniformly across every status tab.
const dateMeta = (item) =>
  item.verificationStatus === "verified" || item.verificationStatus === "rejected"
    ? { label: "Reviewed", value: item.verificationReviewedAt || item.createdAt }
    : { label: "Submitted", value: item.verificationSubmittedAt || item.createdAt };

// The backend stores two document URLs; these labels match the PH business
// accreditation documents they actually represent.
const DOC_FIELDS = [
  { key: "registrationDocUrl", label: "DTI Registration" },
  { key: "businessPermitUrl", label: "Mayor's Permit" },
];

// Builds a page-number list with "…" gap markers, e.g. [1, "…", 4, 5, 6, "…", 12].
const buildPageList = (current, total) => {
  const pages = [];
  for (let i = 1; i <= total; i += 1) {
    if (i === 1 || i === total || (i >= current - 1 && i <= current + 1)) pages.push(i);
  }
  const withEllipsis = [];
  let previous = 0;
  for (const i of pages) {
    if (previous && i - previous > 1) withEllipsis.push("…");
    withEllipsis.push(i);
    previous = i;
  }
  return withEllipsis;
};

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
  const [counts, setCounts] = useState({ pending: 0, verified: 0 });
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [actionToast, setActionToast] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => {
    if (!actionToast) return;
    const timer = window.setTimeout(() => setActionToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [actionToast]);

  // Debounce the search box, and land back on page 1 once the committed term
  // changes (bundled into the same tick so the queue only fetches once).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Tab badges and the two stat cards need pending/verified totals regardless
  // of which tab is active, so they're loaded independently of the main list.
  const loadCounts = useCallback(async () => {
    try {
      const [pendingRes, verifiedRes] = await Promise.all([
        verificationAPI.getQueue({ page: 1, limit: 1, status: "pending" }),
        verificationAPI.getQueue({ page: 1, limit: 1, status: "verified" }),
      ]);
      setCounts({
        pending: Number(pendingRes.data?.total || 0),
        verified: Number(verifiedRes.data?.total || 0),
      });
    } catch {
      // Non-fatal — badges just keep their last known value.
    }
  }, []);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await verificationAPI.getQueue({ page, limit: PAGE_SIZE, status: statusTab, search });
      setQueue(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total || 0));
      setTotalPages(Math.max(Number(data?.totalPages) || 1, 1));
      setLoadError("");
    } catch (error) {
      setQueue([]);
      setTotal(0);
      setTotalPages(1);
      setLoadError(error.response?.data?.message || "Failed to load the verification list.");
    } finally {
      setLoading(false);
    }
  }, [statusTab, page, search]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // Approving/rejecting the last item on a page can leave it out of range.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [totalPages, page]);

  // Switching tabs can leave the reject panel pointed at a user no longer in view.
  useEffect(() => {
    setRejectingId(null);
    setRejectReason("");
  }, [statusTab]);

  const pageList = useMemo(() => buildPageList(page, totalPages), [page, totalPages]);

  const startReject = (userId) => {
    setRejectingId(userId);
    setRejectReason("");
  };
  const cancelReject = () => {
    setRejectingId(null);
    setRejectReason("");
  };

  const handleDecision = async (userId, payload) => {
    setBusyId(userId);
    try {
      if (payload.decision === "approved") {
        await verificationAPI.approve(userId);
      } else {
        await verificationAPI.reject(userId, payload.note);
      }
      cancelReject();
      setActionToast({
        type: "success",
        message: `Verification ${payload.decision === "approved" ? "approved" : "rejected"}.`,
      });
      await loadQueue();
      loadCounts();
    } catch (error) {
      setActionToast({
        type: "error",
        message: error.response?.data?.message || "Failed to update verification.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const confirmReject = (userId) => {
    const note = rejectReason.trim();
    if (!note) return;
    handleDecision(userId, { decision: "rejected", note });
  };

  const emptyMessage =
    statusTab === "pending"
      ? "No pending verifications."
      : statusTab === "verified"
      ? "No verified employers yet."
      : "No employer records found.";

  const rangeFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeTo = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="admin-page-container ev-scope">
      <AdminHeader
        title="Employer Verification"
        description={
          canAct
            ? "Review the documents of employers awaiting accreditation and approve or reject them."
            : "Read-only view of employer accreditation records."
        }
      />

      <div className="ev-tabs" role="tablist" aria-label="Verification status">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={statusTab === tab.key}
            className={`ev-tab ${statusTab === tab.key ? "active" : ""}`}
            onClick={() => {
              setStatusTab(tab.key);
              setPage(1);
            }}
          >
            {tab.dotTone ? <span className={`ev-tab__dot ev-tab__dot--${tab.dotTone}`} aria-hidden="true" /> : null}
            {tab.label}
            {tab.key !== "all" ? <span className="ev-tab__badge">{counts[tab.key]}</span> : null}
          </button>
        ))}
      </div>

      <div className="ev-stats">
        <article className="ev-stat ev-stat--pending">
          <span className="ev-stat__label">Pending Review</span>
          <span className="ev-stat__value">{counts.pending}</span>
          <span className="ev-stat__icon"><FaClock aria-hidden="true" /></span>
        </article>
        <article className="ev-stat ev-stat--verified">
          <span className="ev-stat__label">Accredited</span>
          <span className="ev-stat__value">{counts.verified}</span>
          <span className="ev-stat__icon"><FaCheckCircle aria-hidden="true" /></span>
        </article>
      </div>

      <div className="ev-search">
        <FaSearch aria-hidden="true" />
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search company name or email…"
          aria-label="Search employers"
        />
      </div>

      {!canAct ? (
        <div className="ev-notice">
          <FaInfoCircle aria-hidden="true" />
          <span>
            <strong>Notice:</strong> Only designated LMD PESO system administrators are authorized to approve,
            request revisions, or reject submissions.
          </span>
        </div>
      ) : null}

      <div className="ev-section-head">
        <h3><FaClipboardCheck aria-hidden="true" /> Verification Queue</h3>
        {!loading && !loadError ? (
          <span className="ev-section-head__count">
            Showing {queue.length} of {total}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="ev-empty">Loading verification list…</div>
      ) : loadError ? (
        <div className="ev-empty">{loadError}</div>
      ) : (
        <div className="ev-list">
          {queue.length === 0 ? (
            <div className="ev-empty">{search ? "No records match your search." : emptyMessage}</div>
          ) : (
            queue.map((item) => {
              const meta = statusMeta(item.verificationStatus);
              const when = dateMeta(item);
              const docs = DOC_FIELDS.filter((doc) => item[doc.key]);
              const showActions = canAct && item.verificationStatus === "pending";

              return (
                <article key={item._id} className="ev-card">
                  <div className="ev-card__header">
                    <div>
                      <p className="ev-card__name">{item.name}</p>
                      <span className="ev-card__email">
                        <FaEnvelope aria-hidden="true" />
                        {item.email}
                      </span>
                    </div>
                    <span className={`ev-badge ev-badge--${meta.tone}`}>
                      <span className="ev-badge__dot" aria-hidden="true" />
                      {meta.label}
                    </span>
                  </div>

                  <div className="ev-card__meta">
                    <div>
                      <label>Company Name</label>
                      <p>{item.companyName || "—"}</p>
                    </div>
                    <div>
                      <label>{when.label} Date</label>
                      <p>{formatDate(when.value)}</p>
                    </div>
                  </div>

                  <div className="ev-card__docs-head">
                    <label>Submitted Attachments</label>
                    <span className="ev-card__docs-count">
                      {docs.length === 0
                        ? "No files attached"
                        : `${docs.length} file${docs.length === 1 ? "" : "s"} attached`}
                    </span>
                  </div>
                  {docs.length > 0 ? (
                    <div className="ev-card__docs">
                      {docs.map((doc) => (
                        <SecureFileLink key={doc.key} className="ev-doc-chip" value={item[doc.key]}>
                          <FaFileAlt aria-hidden="true" />
                          {doc.label}
                        </SecureFileLink>
                      ))}
                    </div>
                  ) : null}

                  {item.verificationNote ? (
                    <div className="ev-card__note">Last note: {item.verificationNote}</div>
                  ) : null}

                  {showActions ? (
                    rejectingId === item._id ? (
                      <div className="ev-card__reject">
                        <input
                          type="text"
                          value={rejectReason}
                          placeholder="Reason shown to the employer (required)"
                          onChange={(e) => setRejectReason(e.target.value)}
                        />
                        <div className="ev-card__reject-actions">
                          <button
                            type="button"
                            className="ev-btn ev-btn--danger"
                            disabled={!rejectReason.trim() || busyId === item._id}
                            onClick={() => confirmReject(item._id)}
                          >
                            Confirm rejection
                          </button>
                          <button type="button" className="ev-btn ev-btn--ghost" onClick={cancelReject}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="ev-card__actions">
                        <button
                          type="button"
                          className="ev-btn ev-btn--approve"
                          disabled={busyId === item._id}
                          onClick={() => handleDecision(item._id, { decision: "approved" })}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="ev-btn ev-btn--reject"
                          disabled={busyId === item._id}
                          onClick={() => startReject(item._id)}
                        >
                          Reject
                        </button>
                      </div>
                    )
                  ) : null}
                </article>
              );
            })
          )}
        </div>
      )}

      {!loading && !loadError ? (
        <div className="ev-pagination">
          <span className="ev-pagination__info">
            {total === 0 ? "No records" : `Showing ${rangeFrom}–${rangeTo} of ${total}`}
          </span>
          <div className="ev-pagination__pages">
            <button
              type="button"
              className="ev-pagination__btn"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
            >
              ‹
            </button>
            {pageList.map((item, index) =>
              item === "…" ? (
                <span key={`ellipsis-${index}`} className="ev-pagination__ellipsis">
                  …
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  className={`ev-pagination__btn ${item === page ? "is-active" : ""}`}
                  aria-current={item === page ? "page" : undefined}
                  disabled={item === page}
                  onClick={() => setPage(item)}
                >
                  {item}
                </button>
              )
            )}
            <button
              type="button"
              className="ev-pagination__btn"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Next page"
            >
              ›
            </button>
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
