import { useEffect, useState } from "react";
import { adminAPI } from "../../services/api";
import "../../styles/admin.css";
import AdminHeader from "./AdminHeader";
import { formatAuditAction, getAuditCategories } from "../../utils/auditConstants";

const formatDateTime = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const normalizeSeverity = (value) => String(value || "info").trim().toLowerCase();

const range = (start, end) => Array.from({ length: end - start + 1 }, (_, index) => start + index);

const ELLIPSIS = "ellipsis";

const getPaginationItems = (currentPage, totalPages, siblingCount = 1) => {
  const totalSlots = siblingCount * 2 + 5;

  if (totalPages <= totalSlots) {
    return range(1, totalPages);
  }

  const leftSibling = Math.max(currentPage - siblingCount, 1);
  const rightSibling = Math.min(currentPage + siblingCount, totalPages);
  const showLeftEllipsis = leftSibling > 2;
  const showRightEllipsis = rightSibling < totalPages - 1;

  if (!showLeftEllipsis && showRightEllipsis) {
    const leftRange = range(1, 3 + siblingCount * 2);
    return [...leftRange, ELLIPSIS, totalPages];
  }

  if (showLeftEllipsis && !showRightEllipsis) {
    const rightRange = range(totalPages - (3 + siblingCount * 2) + 1, totalPages);
    return [1, ELLIPSIS, ...rightRange];
  }

  return [1, ELLIPSIS, ...range(leftSibling, rightSibling), ELLIPSIS, totalPages];
};

export default function AuditTrail() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [actionCategoryFilter, setActionCategoryFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalEntries, setTotalEntries] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    let isCurrent = true;

    const loadLogs = async () => {
      setLoading(true);
      try {
        const { data } = await adminAPI.getAuditLogs({
          page: currentPage,
          limit: rowsPerPage,
          search: searchTerm.trim() || undefined,
          severity: severityFilter !== "all" ? severityFilter : undefined,
          category: actionCategoryFilter !== "all" ? actionCategoryFilter : undefined,
          fromDate: fromDate || undefined,
          toDate: toDate || undefined,
        });
        if (!isCurrent) return;
        setLogs(Array.isArray(data?.items) ? data.items : []);
        setTotalEntries(Number(data?.total) || 0);
        setTotalPages(Math.max(Number(data?.totalPages) || 1, 1));
        setError("");
      } catch (err) {
        if (isCurrent) {
          setLogs([]);
          setTotalEntries(0);
          setTotalPages(1);
          setError(err.response?.data?.message || "Failed to load audit logs");
        }
      } finally {
        if (isCurrent) {
          setLoading(false);
        }
      }
    };

    loadLogs();
    return () => {
      isCurrent = false;
    };
  }, [currentPage, rowsPerPage, searchTerm, severityFilter, actionCategoryFilter, fromDate, toDate]);

  const hasActiveFilters =
    Boolean(searchTerm.trim()) ||
    severityFilter !== "all" ||
    actionCategoryFilter !== "all" ||
    Boolean(fromDate) ||
    Boolean(toDate);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginationItems = getPaginationItems(safeCurrentPage, totalPages);
  const startEntry = totalEntries === 0 ? 0 : (safeCurrentPage - 1) * rowsPerPage + 1;
  const endEntry = totalEntries === 0 ? 0 : Math.min(safeCurrentPage * rowsPerPage, totalEntries);

  const resetFilters = () => {
    setSearchTerm("");
    setSeverityFilter("all");
    setActionCategoryFilter("all");
    setFromDate("");
    setToDate("");
    setCurrentPage(1);
    setRowsPerPage(10);
  };

  return (
    <div className="admin-page-container">
      <AdminHeader
        title="Audit Trail"
        description="Review platform activity, security events, and administrative actions captured by the backend."
      />

      <section className="admin-panel-card">
        <div className="admin-card-header">
          <h3>System Activity Monitor</h3>
        </div>

        {error ? <div className="admin-form-error">{error}</div> : null}

        <div className="admin-audit-toolbar">
          <div className="admin-filter-row">
            <div className="admin-filter-group admin-filter-search">
              <label htmlFor="audit-search" className="admin-filter-label">
                Search
              </label>
              <input
                id="audit-search"
                type="text"
                value={searchTerm}
                onChange={(event) => {
                  setSearchTerm(event.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search actor, action, or target"
              />
            </div>

            <div className="admin-filter-group">
              <label htmlFor="audit-severity" className="admin-filter-label">
                Severity
              </label>
              <select
                id="audit-severity"
                value={severityFilter}
                onChange={(event) => {
                  setSeverityFilter(event.target.value);
                  setCurrentPage(1);
                }}
              >
                <option value="all">All Severities</option>
                <option value="info">info</option>
                <option value="warning">warning</option>
                <option value="critical">critical</option>
              </select>
            </div>

            <div className="admin-filter-group">
              <label htmlFor="audit-action-category" className="admin-filter-label">
                Action Category
              </label>
              <select
                id="audit-action-category"
                value={actionCategoryFilter}
                onChange={(event) => {
                  setActionCategoryFilter(event.target.value);
                  setCurrentPage(1);
                }}
              >
                {getAuditCategories().map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="admin-filter-group">
              <label htmlFor="audit-from-date" className="admin-filter-label">
                From Date
              </label>
              <input
                id="audit-from-date"
                type="date"
                value={fromDate}
                onChange={(event) => {
                  setFromDate(event.target.value);
                  setCurrentPage(1);
                }}
              />
            </div>

            <div className="admin-filter-group">
              <label htmlFor="audit-to-date" className="admin-filter-label">
                To Date
              </label>
              <input
                id="audit-to-date"
                type="date"
                value={toDate}
                onChange={(event) => {
                  setToDate(event.target.value);
                  setCurrentPage(1);
                }}
              />
            </div>

            <div className="admin-filter-group admin-filter-actions">
              <button type="button" className="admin-filter-reset" onClick={resetFilters}>
                Reset
              </button>
            </div>
          </div>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Severity</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="admin-loading">Loading audit logs...</td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="admin-empty-state admin-audit-empty-state">
                    <p>
                      {hasActiveFilters
                        ? "No activity logs found matching the selected filters."
                        : "No audit entries found."}
                    </p>
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const severity = normalizeSeverity(log.severity);
                  const severityClass = severity === "critical" ? "critical" : severity === "warning" ? "warning" : "info";
                  const severityLabel = severity === "critical" ? "Critical" : severity === "warning" ? "Warning" : "Info";

                  return (
                    <tr key={log._id || `${log.createdAt}-${log.action}`}>
                      <td>{formatDateTime(log.createdAt)}</td>
                      <td>{log.actorId?.name || log.actorRole || "System"}</td>
                      <td>{formatAuditAction(log.action)}</td>
                      <td>{log.targetUserId?.name || log.targetType || "—"}</td>
                      <td>
                        <span className={`admin-severity-pill ${severityClass}`}>
                          {severityLabel}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="admin-audit-pagination">
          <div className="admin-audit-pagination__info">
            Showing {startEntry}-{endEntry} of {totalEntries} entries
          </div>

          <div className="admin-audit-pagination__controls">
            <button
              type="button"
              className="admin-audit-pagination__button"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={safeCurrentPage === 1 || totalEntries === 0}
            >
              Previous
            </button>

            {paginationItems.map((item, index) =>
              item === ELLIPSIS ? (
                <span
                  key={`ellipsis-${index}`}
                  className="admin-audit-pagination__ellipsis"
                  aria-hidden="true"
                >
                  …
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  className={`admin-audit-pagination__button ${safeCurrentPage === item ? "admin-audit-pagination__button--active" : ""}`}
                  onClick={() => setCurrentPage(item)}
                >
                  {item}
                </button>
              )
            )}

            <button
              type="button"
              className="admin-audit-pagination__button"
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              disabled={safeCurrentPage >= totalPages || totalEntries === 0}
            >
              Next
            </button>
          </div>

          <div className="admin-audit-pagination__rows">
            <label htmlFor="audit-rows-per-page">Rows per page</label>
            <select
              id="audit-rows-per-page"
              value={rowsPerPage}
              onChange={(event) => {
                const nextRowsPerPage = Number(event.target.value);
                setRowsPerPage(nextRowsPerPage);
                setCurrentPage(1);
              }}
            >
              {[10, 25, 50, 100].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>
    </div>
  );
}
