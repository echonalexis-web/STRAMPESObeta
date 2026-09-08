import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaTimes, FaExternalLinkAlt, FaUserShield, FaFileAlt } from "react-icons/fa";
import { adminAPI } from "../../services/api";
import { useToast } from "../../components/feedback/context";

const REPORT_CATEGORY_LABELS = {
  illegal_job: "Illegal / fake job",
  scam_or_fee: "Scam / applicant fee",
  discrimination: "Discrimination",
  inappropriate_avatar: "Inappropriate photo",
  harassment: "Harassment",
  hate_speech: "Hate speech / threats",
  spam: "Spam",
  impersonation: "Impersonation",
  other: "Other",
};

// How loudly a row should read in the queue. High-harm categories get a red
// flag so an admin can prioritise them without opening every report.
const REPORT_CATEGORY_SEVERITY = {
  illegal_job: "high",
  scam_or_fee: "high",
  discrimination: "high",
  hate_speech: "high",
  harassment: "high",
  impersonation: "high",
  inappropriate_avatar: "medium",
  spam: "low",
  other: "low",
};

const SEVERITY_META = {
  high: { label: "High severity", tone: "danger" },
  medium: { label: "Medium severity", tone: "warn" },
  low: { label: "Low severity", tone: "muted" },
};

const REPORT_STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "under_review", label: "Under review" },
  { value: "action_taken", label: "Action taken" },
  { value: "dismissed", label: "Dismissed" },
];

// The four decisions an admin can reach on a report, as weighted buttons rather
// than a flat dropdown — each maps to the status/action the API already expects.
const REPORT_DECISIONS = [
  {
    key: "dismiss",
    label: "Dismiss",
    hint: "No violation — close the report",
    tone: "neutral",
    status: "dismissed",
    action: "none",
  },
  {
    key: "warn",
    label: "Warn user",
    hint: "Record a warning against the reported user",
    tone: "warn",
    status: "action_taken",
    action: "warning",
  },
  {
    key: "suspend",
    label: "Suspend",
    hint: "Temporarily disable the reported account",
    tone: "danger",
    status: "action_taken",
    action: "suspension",
  },
  {
    key: "ban",
    label: "Ban",
    hint: "Permanently disable the reported account",
    tone: "critical",
    status: "action_taken",
    action: "ban",
  },
];

const APPEAL_DECISIONS = [
  {
    key: "approved",
    label: "Approve & restore",
    hint: "Reactivate the account right away",
    tone: "success",
    decision: "approved",
  },
  {
    key: "denied",
    label: "Deny appeal",
    hint: "Keep the account suspended",
    tone: "danger",
    decision: "denied",
  },
  {
    key: "under_review",
    label: "Mark under review",
    hint: "Need more time before deciding",
    tone: "neutral",
    decision: "under_review",
  },
];

const PAGE_SIZE = 10;

const formatDate = (value) => {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const timeAgo = (value) => {
  if (!value) return "unknown";
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
};

/* ------------------------------ shared bits ------------------------------ */

function StatStrip({ items }) {
  return (
    <div className="mq-statstrip">
      {items.map((it) => (
        <div key={it.label} className={`mq-stat mq-stat--${it.tone || "muted"}`}>
          <span className="mq-stat__value">{it.value}</span>
          <span className="mq-stat__label">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

// Always rendered — even for a single page — so the queue's size is always legible.
function Pagination({ page, total, onPage }) {
  const pageCount = Math.max(1, Math.ceil((total || 0) / PAGE_SIZE));
  const current = Math.min(Math.max(page, 1), pageCount);
  const from = total === 0 ? 0 : (current - 1) * PAGE_SIZE + 1;
  const to = Math.min(current * PAGE_SIZE, total || 0);

  const windowEnd = Math.min(pageCount, Math.max(1, current - 2) + 4);
  const pages = [];
  for (let i = Math.max(1, windowEnd - 4); i <= windowEnd; i += 1) pages.push(i);

  return (
    <div className="mq-pagination">
      <span className="mq-pagination__info">
        {total === 0 ? "No entries" : `Showing ${from}–${to} of ${total}`}
      </span>
      <div className="mq-pagination__controls">
        <button
          type="button"
          className="mq-pagination__btn"
          onClick={() => onPage(current - 1)}
          disabled={current <= 1}
          aria-label="Previous page"
        >
          ‹
        </button>
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            className={`mq-pagination__btn ${p === current ? "is-active" : ""}`}
            onClick={() => onPage(p)}
            aria-current={p === current ? "page" : undefined}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          className="mq-pagination__btn"
          onClick={() => onPage(current + 1)}
          disabled={current >= pageCount}
          aria-label="Next page"
        >
          ›
        </button>
      </div>
    </div>
  );
}

function SeverityBadge({ severity }) {
  const meta = SEVERITY_META[severity] || SEVERITY_META.low;
  return (
    <span className={`mq-sev mq-sev--${meta.tone}`}>
      <span className="mq-sev__dot" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function AccountStatusPill({ isActive, accountStatus }) {
  const status = isActive === false ? accountStatus || "suspended" : "active";
  const tone = status === "active" ? "success" : status === "banned" ? "critical" : "danger";
  return <span className={`mq-pill mq-pill--${tone}`}>{status}</span>;
}

// Right-side drawer chrome shared by the report and appeal review flows.
function DrawerShell({ variant, eyebrow, title, subtitle, icon, onClose, children, footer }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="mq-drawer-overlay" onClick={onClose}>
      <aside
        className={`mq-drawer mq-drawer--${variant}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mq-drawer__head">
          <div className="mq-drawer__headmain">
            <span className="mq-drawer__icon" aria-hidden="true">{icon}</span>
            <div>
              <p className="mq-drawer__eyebrow">{eyebrow}</p>
              <h3>{title}</h3>
              {subtitle ? <p className="mq-drawer__sub">{subtitle}</p> : null}
            </div>
          </div>
          <button type="button" className="mq-drawer__close" onClick={onClose} aria-label="Close">
            <span className="mq-drawer__close-icon" aria-hidden="true">×</span>
            <FaTimes aria-hidden="true" className="mq-drawer__close-svg" />
          </button>
        </header>
        <div className="mq-drawer__body">{children}</div>
        {footer ? <footer className="mq-drawer__foot">{footer}</footer> : null}
      </aside>
    </div>
  );
}

function DrawerContextRow({ label, children }) {
  return (
    <div className="mq-ctx-row">
      <span className="mq-ctx-row__label">{label}</span>
      <span className="mq-ctx-row__value">{children}</span>
    </div>
  );
}

function DecisionButtons({ options, selected, onSelect, disabled }) {
  return (
    <div className="mq-decisions">
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          className={`mq-decision mq-decision--${opt.tone} ${selected === opt.key ? "is-selected" : ""}`}
          onClick={() => onSelect(opt.key)}
          disabled={disabled}
        >
          <span className="mq-decision__label">{opt.label}</span>
          <span className="mq-decision__hint">{opt.hint}</span>
        </button>
      ))}
    </div>
  );
}

/* ----------------------------- Reports queue ----------------------------- */

function ReportReviewDrawer({ report, onClose, onResolved }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [decisionKey, setDecisionKey] = useState("");
  const [note, setNote] = useState(report.resolution?.note || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const severity = REPORT_CATEGORY_SEVERITY[report.category] || "low";
  const decision = REPORT_DECISIONS.find((d) => d.key === decisionKey);
  const enforcing = decision?.action === "suspension" || decision?.action === "ban";
  const owner = report.targetOwner;
  const ctx = report.ownerContext || {};
  const alreadyResolved = ["action_taken", "dismissed"].includes(report.status);

  const applyDecision = async (status, action) => {
    setSaving(true);
    setError("");
    try {
      const { data } = await adminAPI.resolveReport(report._id, { status, action, note });
      const outcome =
        status === "under_review"
          ? "Report marked under review."
          : action === "dismissed" || status === "dismissed"
            ? "Report dismissed."
            : action === "warning"
              ? "Warning recorded against the reported user."
              : action === "suspension"
                ? "Reported user suspended."
                : action === "ban"
                  ? "Reported user banned."
                  : "Report resolved.";
      toast.success(outcome);
      onResolved(data.report);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to update report");
      toast.error(err?.response?.data?.message || "Failed to update report.");
      setSaving(false);
    }
  };

  const footer = (
    <>
      {error ? <p className="mq-error">{error}</p> : null}
      <div className="mq-foot-actions">
        <button
          type="button"
          className="mq-btn mq-btn--ghost"
          onClick={() => applyDecision("under_review", "none")}
          disabled={saving}
        >
          Mark under review
        </button>
        <button
          type="button"
          className="mq-btn mq-btn--primary"
          onClick={() => decision && applyDecision(decision.status, decision.action)}
          disabled={saving || !decision}
        >
          {saving ? "Saving…" : "Apply decision"}
        </button>
      </div>
    </>
  );

  return (
    <DrawerShell
      variant="reports"
      eyebrow="User report"
      title={REPORT_CATEGORY_LABELS[report.category] || report.category}
      subtitle={`Reported ${report.targetType.replace(/_/g, " ")} · ${formatDate(report.createdAt)}`}
      icon={<FaFileAlt aria-hidden="true" />}
      onClose={onClose}
    >
      <section className="mq-drawer-section">
        <div className="mq-drawer-section__title">Report</div>
        <div className="mq-ctx">
          <DrawerContextRow label="Severity"><SeverityBadge severity={severity} /></DrawerContextRow>
          <DrawerContextRow label="Reason">{REPORT_CATEGORY_LABELS[report.category] || report.category}</DrawerContextRow>
          <DrawerContextRow label="Reported by">{report.reporter?.name || report.reporter?.email || "—"}</DrawerContextRow>
          <DrawerContextRow label="Filed">{formatDate(report.createdAt)}</DrawerContextRow>
        </div>
        <p className="mq-details">
          <strong>Details from reporter</strong>
          <span>{report.details || "No extra details were provided."}</span>
        </p>
      </section>

      <section className="mq-drawer-section">
        <div className="mq-drawer-section__title">Reported user</div>
        {owner ? (
          <div className="mq-usercard">
            <div className="mq-usercard__head">
              <div>
                <strong>{owner.name || owner.email}</strong>
                <span className="mq-usercard__meta">Joined {timeAgo(owner.createdAt)} · {owner.role || "user"}</span>
              </div>
              <AccountStatusPill isActive={owner.isActive} accountStatus={owner.accountStatus} />
            </div>
            <div className="mq-usercard__stats">
              <div className={ctx.reportTotal > 1 ? "is-flagged" : ""}>
                <strong>{ctx.reportTotal || 1}</strong>
                <span>report{(ctx.reportTotal || 1) === 1 ? "" : "s"} total</span>
              </div>
              <div>
                <strong>{ctx.reportOpen || 0}</strong>
                <span>still open</span>
              </div>
              <div className={ctx.enforcementActions > 0 ? "is-flagged" : ""}>
                <strong>{ctx.enforcementActions || 0}</strong>
                <span>prior actions</span>
              </div>
            </div>
            <button
              type="button"
              className="mq-linkbtn"
              onClick={() => navigate(`/admin/users/${owner._id}`)}
            >
              Open full profile <FaExternalLinkAlt aria-hidden="true" />
            </button>
          </div>
        ) : (
          <p className="mq-muted">The reported item has no linked account (id: {report.targetId}).</p>
        )}
      </section>

      {report.resolution?.handledBy ? (
        <section className="mq-drawer-section">
          <div className="mq-drawer-section__title">History</div>
          <p className="mq-muted">
            Last handled by {report.resolution.handledBy.name} on {formatDate(report.resolution.resolvedAt)}
            {report.resolution.action && report.resolution.action !== "none"
              ? ` — ${report.resolution.action.replace(/_/g, " ")}`
              : ""}
          </p>
        </section>
      ) : null}

      <section className="mq-drawer-section mq-decision-block">
        <div className="mq-drawer-section__title">
          Decision {alreadyResolved ? <span className="mq-muted">(revising a resolved report)</span> : null}
        </div>
        <DecisionButtons
          options={REPORT_DECISIONS}
          selected={decisionKey}
          onSelect={setDecisionKey}
          disabled={saving}
        />
        <label className="mq-field">
          <span>{enforcing ? "Reason shown to the user" : "Internal note (optional)"}</span>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              enforcing
                ? "Explain why the account is being suspended / banned…"
                : "Context for other admins (not shown to the user)…"
            }
          />
        </label>
      </section>
      <div className="mq-drawer-section">{footer}</div>
    </DrawerShell>
  );
}

export function ReportsQueue({ onStats }) {
  const navigate = useNavigate();
  const [reports, setReports] = useState([]);
  const [counts, setCounts] = useState(null);
  const [statusFilter, setStatusFilter] = useState("open");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await adminAPI.getReports({
        ...(statusFilter ? { status: statusFilter } : {}),
        page,
        limit: PAGE_SIZE,
      });
      setReports(Array.isArray(data?.reports) ? data.reports : []);
      setTotal(Number(data?.total || 0));
      setCounts(data?.counts || null);
      if (data?.counts && onStats) onStats(data.counts);
    } catch {
      setReports([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page, onStats]);

  useEffect(() => {
    load();
  }, [load]);

  // Resolving the last row on a page can leave the current page out of range.
  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > pageCount) setPage(pageCount);
  }, [total, page]);

  const changeFilter = (value) => {
    setStatusFilter(value);
    setPage(1);
  };

  const handleResolved = () => {
    setReviewing(null);
    load();
  };

  return (
    <div className="admin-panel-card mq-panel mq-panel--reports">
      <div className="mq-panel__head">
        <div className="mq-panel__heading">
          <h3><span className="mq-panel__accent" aria-hidden="true" />User Reports</h3>
          <p>Incoming complaints from users about jobs, profiles, and content.</p>
        </div>
        <select
          className="mq-select"
          value={statusFilter}
          onChange={(e) => changeFilter(e.target.value)}
          aria-label="Filter reports by status"
        >
          {REPORT_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {counts ? (
        <StatStrip
          items={[
            { label: "Open", value: counts.open, tone: "danger" },
            { label: "Under review", value: counts.under_review, tone: "warn" },
            { label: "Resolved today", value: counts.resolvedToday, tone: "success" },
          ]}
        />
      ) : null}

      <div className="mq-table-wrap">
        <table className="mq-table">
          <thead>
            <tr>
              <th>Reported</th>
              <th>Reason</th>
              <th>Reported by</th>
              <th>Date</th>
              <th>Status</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="mq-empty">Loading reports…</td></tr>
            ) : reports.length === 0 ? (
              <tr><td colSpan={6} className="mq-empty">No reports in this view.</td></tr>
            ) : (
              reports.map((report) => {
                const severity = REPORT_CATEGORY_SEVERITY[report.category] || "low";
                const repeat = report.ownerContext?.reportTotal > 1;
                return (
                  <tr key={report._id} className={`mq-row mq-row--sev-${severity}`}>
                    <td>
                      <div className="mq-target">
                        <span className={`mq-dot mq-dot--${severity}`} aria-label={`${severity} severity`} />
                        <div>
                          <strong>{report.targetType.replace(/_/g, " ")}</strong>
                          {report.targetOwner ? (
                            <button
                              type="button"
                              className="mq-linklike"
                              onClick={() => navigate(`/admin/users/${report.targetOwner._id}`)}
                            >
                              {report.targetOwner.name || report.targetOwner.email}
                            </button>
                          ) : (
                            <span className="mq-muted">id: {report.targetId}</span>
                          )}
                          {repeat ? (
                            <span className="mq-repeat">{report.ownerContext.reportTotal} reports on this user</span>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="mq-reason">{REPORT_CATEGORY_LABELS[report.category] || report.category}</span>
                      <span className={`mq-reason__sev mq-reason__sev--${SEVERITY_META[severity].tone}`}>
                        {SEVERITY_META[severity].label}
                      </span>
                    </td>
                    <td>{report.reporter?.name || "—"}</td>
                    <td>{formatDate(report.createdAt)}</td>
                    <td>
                      <span className={`mq-status mq-status--${report.status}`}>
                        {report.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="mq-row__action">
                      <button type="button" className="mq-btn mq-btn--review" onClick={() => setReviewing(report)}>
                        Review
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} total={total} onPage={setPage} />

      {reviewing ? (
        <ReportReviewDrawer
          report={reviewing}
          onClose={() => setReviewing(null)}
          onResolved={handleResolved}
        />
      ) : null}
    </div>
  );
}

/* --------------------------- Appeals queue --------------------------- */

function AppealReviewDrawer({ appeal, onClose, onResolved }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [decisionKey, setDecisionKey] = useState("");
  const [adminResponse, setAdminResponse] = useState(appeal.adminResponse || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const decided = ["approved", "denied"].includes(appeal.status);
  const decision = APPEAL_DECISIONS.find((d) => d.key === decisionKey);
  const user = appeal.user;
  const ctx = appeal.context || {};

  const submit = async () => {
    if (!decision) return;
    setSaving(true);
    setError("");
    try {
      const { data } = await adminAPI.resolveAppeal(appeal._id, {
        decision: decision.decision,
        adminResponse,
      });
      toast.success(
        decision.decision === "approved"
          ? "Appeal approved — the account has been reactivated."
          : decision.decision === "denied"
            ? "Appeal denied. The account stays suspended."
            : "Appeal marked under review."
      );
      onResolved(data.appeal);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to update appeal");
      toast.error(err?.response?.data?.message || "Failed to update appeal.");
      setSaving(false);
    }
  };

  const footer = decided ? null : (
    <>
      {error ? <p className="mq-error">{error}</p> : null}
      <div className="mq-foot-actions">
        <button
          type="button"
          className="mq-btn mq-btn--primary"
          onClick={submit}
          disabled={saving || !decision}
        >
          {saving ? "Saving…" : "Submit decision"}
        </button>
      </div>
    </>
  );

  return (
    <DrawerShell
      variant="appeals"
      eyebrow={appeal.accountStatus === "banned" ? "Ban appeal" : "Suspension appeal"}
      title={user?.name || user?.email || "Unknown user"}
      subtitle={`Submitted ${formatDate(appeal.createdAt)}`}
      icon={<FaUserShield aria-hidden="true" />}
      onClose={onClose}
    >
      <section className="mq-drawer-section">
        <div className="mq-drawer-section__title">Why the account was actioned</div>
        <div className="mq-ctx">
          <DrawerContextRow label="Type">{appeal.accountStatus === "banned" ? "Ban" : "Suspension"}</DrawerContextRow>
          <DrawerContextRow label="Original reason">
            {appeal.suspensionReason || user?.suspensionReason || "Not recorded"}
          </DrawerContextRow>
          <DrawerContextRow label="Actioned on">{formatDate(ctx.suspendedAt)}</DrawerContextRow>
          <DrawerContextRow label="Actioned by">{ctx.suspendedByName || "—"}</DrawerContextRow>
          <DrawerContextRow label="Reports against user">{ctx.reportsAgainstUser || 0}</DrawerContextRow>
        </div>
        {user?._id ? (
          <button type="button" className="mq-linkbtn" onClick={() => navigate(`/admin/users/${user._id}`)}>
            Open full profile <FaExternalLinkAlt aria-hidden="true" />
          </button>
        ) : null}
      </section>

      <section className="mq-drawer-section">
        <div className="mq-drawer-section__title">Their appeal</div>
        <p className="mq-details"><span>{appeal.message}</span></p>
      </section>

      {decided ? (
        <section className="mq-drawer-section">
          <div className="mq-drawer-section__title">Outcome</div>
          <p className="mq-muted">
            {appeal.status === "approved" ? "Approved" : "Denied"}
            {appeal.reviewedBy?.name ? ` by ${appeal.reviewedBy.name}` : ""}
            {appeal.adminResponse ? ` — “${appeal.adminResponse}”` : ""}
          </p>
        </section>
      ) : (
        <section className="mq-drawer-section mq-decision-block">
          <div className="mq-drawer-section__title">Decision</div>
          <DecisionButtons
            options={APPEAL_DECISIONS}
            selected={decisionKey}
            onSelect={setDecisionKey}
            disabled={saving}
          />
          <label className="mq-field">
            <span>Response to the user (optional)</span>
            <textarea
              rows={3}
              value={adminResponse}
              onChange={(e) => setAdminResponse(e.target.value)}
              placeholder="Included in the notification the user receives…"
            />
          </label>
        </section>
      )}
      {footer ? <div className="mq-drawer-section">{footer}</div> : null}
    </DrawerShell>
  );
}

export function AppealsQueue({ onStats }) {
  const navigate = useNavigate();
  const [appeals, setAppeals] = useState([]);
  const [counts, setCounts] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await adminAPI.getAppeals({ page, limit: PAGE_SIZE });
      setAppeals(Array.isArray(data?.appeals) ? data.appeals : []);
      setTotal(Number(data?.total || 0));
      setCounts(data?.counts || null);
      if (data?.counts && onStats) onStats(data.counts);
    } catch {
      setAppeals([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, onStats]);

  useEffect(() => {
    load();
  }, [load]);

  // Resolving the last row on a page can leave the current page out of range.
  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > pageCount) setPage(pageCount);
  }, [total, page]);

  const handleResolved = () => {
    setReviewing(null);
    load();
  };

  return (
    <div className="admin-panel-card mq-panel mq-panel--appeals">
      <div className="mq-panel__head">
        <div className="mq-panel__heading">
          <h3><span className="mq-panel__accent" aria-hidden="true" />Suspension Appeals</h3>
          <p>Reactivation requests from suspended and banned accounts.</p>
        </div>
      </div>

      {counts ? (
        <StatStrip
          items={[
            { label: "Pending", value: counts.pending, tone: "warn" },
            { label: "Under review", value: counts.under_review, tone: "info" },
            { label: "Resolved today", value: counts.resolvedToday, tone: "success" },
          ]}
        />
      ) : null}

      <div className="mq-table-wrap">
        <table className="mq-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Type</th>
              <th>Submitted</th>
              <th>Status</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="mq-empty">Loading appeals…</td></tr>
            ) : appeals.length === 0 ? (
              <tr><td colSpan={5} className="mq-empty">No appeals submitted.</td></tr>
            ) : (
              appeals.map((appeal) => {
                const priorReports = appeal.context?.reportsAgainstUser || 0;
                return (
                  <tr key={appeal._id} className={`mq-row mq-row--appeal-${appeal.status}`}>
                    <td>
                      <div className="mq-target">
                        <span className={`mq-dot mq-dot--appeal-${appeal.status}`} aria-hidden="true" />
                        <div>
                          <button
                            type="button"
                            className="mq-linklike"
                            onClick={() => appeal.user?._id && navigate(`/admin/users/${appeal.user._id}`)}
                          >
                            {appeal.user?.name || appeal.user?.email || "Unknown"}
                          </button>
                          {priorReports > 0 ? (
                            <span className="mq-repeat">{priorReports} report{priorReports === 1 ? "" : "s"} on file</span>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`mq-pill mq-pill--${appeal.accountStatus === "banned" ? "critical" : "danger"}`}>
                        {appeal.accountStatus === "banned" ? "Ban" : "Suspension"}
                      </span>
                    </td>
                    <td>{formatDate(appeal.createdAt)}</td>
                    <td>
                      <span className={`mq-status mq-status--${appeal.status}`}>
                        {appeal.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="mq-row__action">
                      <button type="button" className="mq-btn mq-btn--review" onClick={() => setReviewing(appeal)}>
                        {["approved", "denied"].includes(appeal.status) ? "View" : "Review"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} total={total} onPage={setPage} />

      {reviewing ? (
        <AppealReviewDrawer
          appeal={reviewing}
          onClose={() => setReviewing(null)}
          onResolved={handleResolved}
        />
      ) : null}
    </div>
  );
}
