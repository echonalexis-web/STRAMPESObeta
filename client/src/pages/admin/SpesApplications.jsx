import { useCallback, useEffect, useMemo, useState } from "react";
import { FaTimes } from "react-icons/fa";
import { Eye, FileText, Download, Clock } from "lucide-react";
import { newsAPI, spesAPI } from "../../services/api";
import SecureFileLink from "../../components/SecureFileLink";
import { useToast } from "../../components/feedback/context";
import AdminHeader from "./AdminHeader";
import "../../styles/admin.css";
import "../../styles/spes.css";

// All statuses an application can be in — used for the read-only table filter.
const STATUS_OPTIONS = [
  "submitted",
  "under_review",
  "for_exam",
  "for_interview",
  "evaluated",
  "results_released",
  "withdrawn",
  "disqualified",
];

// Statuses an admin can actually assign from the evaluation drawer.
// "submitted" is the automatic starting state and "results_released" is
// system-managed by the "Release results" action, so neither belongs here —
// picking them here used to silently no-op since the server never accepted
// them from this endpoint.
const SETTABLE_STATUS_OPTIONS = [
  "under_review",
  "for_exam",
  "for_interview",
  "evaluated",
  "withdrawn",
  "disqualified",
];

const STATUS_LABEL = {
  submitted: "Submitted",
  under_review: "Under review",
  for_exam: "For exam",
  for_interview: "For interview",
  evaluated: "Evaluated",
  results_released: "Results released",
  withdrawn: "Withdrawn",
  disqualified: "Disqualified",
};

const OUTCOME_OPTIONS = ["pending", "accepted", "waitlisted", "not_accepted"];

// An application still sitting in one of these stages hasn't had an outcome
// decided yet — it's the set that can silently stall a whole program's
// results release if left unattended.
const UNRESOLVED_STATUSES = ["submitted", "under_review", "for_exam", "for_interview"];

const formatDate = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const daysSince = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
};

// Flags applications that have gone untouched too long — only for statuses
// that still need an admin decision; anything already evaluated/excluded/
// released isn't "neglected", it's just waiting on something else.
function AgeBadge({ app }) {
  if (!UNRESOLVED_STATUSES.includes(app.status)) return null;
  const days = daysSince(app.createdAt);
  if (days === null || days < 7) return null;
  const tier = days >= 14 ? "danger" : "warn";
  return (
    <span className={`spes-age-badge spes-age-badge--${tier}`} title={`${days} days since submitted, still unresolved`}>
      {days}d {tier === "danger" ? "overdue" : "waiting"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Evaluation drawer — slides in from the right (full-screen on mobile) and
// holds everything that used to be crammed into the table row: documents,
// scoring, status/outcome, and remarks.
// ---------------------------------------------------------------------------
function SpesEvalDrawer({ app, onClose, onSaved }) {
  const toast = useToast();
  const [examScore, setExamScore] = useState(app.evaluation?.examScore ?? "");
  const [interviewScore, setInterviewScore] = useState(app.evaluation?.interviewScore ?? "");
  const [outcome, setOutcome] = useState(app.result?.outcome || "pending");
  const [remarks, setRemarks] = useState(app.result?.remarks || "");
  const [status, setStatus] = useState(app.status);
  const [saving, setSaving] = useState(false);

  // The select must always be able to render the app's starting status, even
  // when it isn't one an admin can pick from here (submitted / results_released).
  const statusOptions = SETTABLE_STATUS_OPTIONS.includes(app.status)
    ? SETTABLE_STATUS_OPTIONS
    : [app.status, ...SETTABLE_STATUS_OPTIONS];

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const isExclusion = status === "withdrawn" || status === "disqualified";

  const save = async () => {
    if (isExclusion && !remarks.trim()) {
      toast.error(`A reason in Remarks is required to mark this application as ${status}.`);
      return;
    }
    setSaving(true);
    try {
      const { data } = await spesAPI.adminRecordEvaluation(app._id, {
        examScore,
        interviewScore,
        outcome,
        remarks,
        status: SETTABLE_STATUS_OPTIONS.includes(status) ? status : undefined,
      });
      toast.success("Evaluation saved.");
      onSaved(data?.application);
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const documents = app.documents || [];

  return (
    <div className="spes-drawer-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="spes-drawer" role="dialog" aria-modal="true" aria-label="Review SPES application">
        <div className="spes-drawer__header">
          <div>
            <h2>{app.applicant?.name || "Applicant"}</h2>
            <p className="spes-drawer__subtitle">
              {app.applicant?.email} · {app.announcement?.title || "SPES program"}
            </p>
          </div>
          <button type="button" className="spes-drawer__close" onClick={onClose} aria-label="Close">
            <FaTimes aria-hidden="true" />
          </button>
        </div>

        <div className="spes-drawer__body">
          <section className="spes-drawer__section">
            <h3>Submitted documents</h3>
            {documents.length === 0 ? (
              <p className="spes-note">No documents submitted.</p>
            ) : (
              <div className="spes-doc-grid">
                {documents.map((doc, i) => (
                  <div className="spes-doc-card" key={i}>
                    <FileText size={20} className="spes-doc-card__icon" aria-hidden="true" />
                    <span className="spes-doc-card__label">{doc.label || `Document ${i + 1}`}</span>
                    <SecureFileLink className="spes-doc-card__link" value={doc.fileUrl}>
                      <Download size={14} /> View
                    </SecureFileLink>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="spes-drawer__section">
            <h3>Scoring &amp; evaluation</h3>
            <div className="spes-drawer__grid">
              <label>
                Qualifying exam score
                <input type="number" value={examScore} onChange={(e) => setExamScore(e.target.value)} />
              </label>
              <label>
                Interview score
                <input type="number" value={interviewScore} onChange={(e) => setInterviewScore(e.target.value)} />
              </label>
              <label>
                Application status
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s] || s}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Final outcome
                <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                  {OUTCOME_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="spes-drawer__section">
            <h3>Remarks</h3>
            {isExclusion ? (
              <p className="spes-drawer__warning">
                Marking this application as {status} requires a reason below — it removes the applicant from this
                program's results-release count.
              </p>
            ) : null}
            <textarea
              rows={4}
              placeholder={
                isExclusion
                  ? `Why is this application being marked ${status}? (required)`
                  : "Notes visible to the applicant once results are released…"
              }
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </section>
        </div>

        <div className="spes-drawer__actions">
          <button type="button" className="spes-btn spes-btn--ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="spes-btn" onClick={save} disabled={saving || (isExclusion && !remarks.trim())}>
            {saving ? "Saving…" : "Save evaluation"}
          </button>
        </div>
      </aside>
    </div>
  );
}

export default function SpesApplications() {
  const toast = useToast();
  const [programs, setPrograms] = useState([]);
  const [announcementId, setAnnouncementId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [reviewing, setReviewing] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await newsAPI.listAdmin({ category: "spes", limit: 50 });
        setPrograms(Array.isArray(data?.items) ? data.items : []);
      } catch (_) {
        setPrograms([]);
      }
    })();
  }, []);

  const loadApplications = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await spesAPI.adminList({
        announcement: announcementId || undefined,
        status: statusFilter || undefined,
        limit: 200,
      });
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load applications.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [announcementId, statusFilter, toast]);

  useEffect(() => {
    loadApplications();
  }, [loadApplications]);

  const selectedProgram = useMemo(
    () => programs.find((p) => p._id === announcementId) || null,
    [programs, announcementId]
  );

  const readiness = useMemo(() => {
    const scoped = items.filter((a) => !["withdrawn", "disqualified"].includes(a.status));
    const decided = scoped.filter((a) => a.result?.outcome && a.result.outcome !== "pending");
    return { total: scoped.length, decided: decided.length };
  }, [items]);

  const alreadyReleased = selectedProgram?.spes?.resultsStatus === "published";

  const handleRelease = async () => {
    if (!announcementId) return;
    setReleasing(true);
    try {
      const { data } = await spesAPI.adminReleaseResults(announcementId);
      toast.success(data?.message || "Results released.");
      loadApplications();
      setPrograms((prev) =>
        prev.map((p) =>
          p._id === announcementId
            ? { ...p, spes: { ...(p.spes || {}), resultsStatus: "published" } }
            : p
        )
      );
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to release results.");
    } finally {
      setReleasing(false);
    }
  };

  const patchItem = (updated) => {
    if (!updated) return;
    setItems((prev) => prev.map((a) => (a._id === updated._id ? { ...a, ...updated } : a)));
    setReviewing((prev) => (prev && prev._id === updated._id ? { ...prev, ...updated } : prev));
  };

  return (
    <div className="admin-page-container">
      <AdminHeader
        title="SPES Applications"
        description="Review Special Program for Employment of Students applicants, record exam and interview results, and release results in-platform."
      />

      <div className="spes-admin-controls">
        <label>
          Program
          <select value={announcementId} onChange={(e) => setAnnouncementId(e.target.value)}>
            <option value="">All SPES programs</option>
            {programs.map((p) => (
              <option key={p._id} value={p._id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Any status</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s] || s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {announcementId ? (
        <div className="spes-release-bar">
          <span>
            {readiness.decided} of {readiness.total} applications have a decided outcome.
          </span>
          {alreadyReleased ? (
            <span className="spes-chip spes-chip--results_released">Results published</span>
          ) : (
            <button
              className="spes-btn"
              type="button"
              disabled={releasing || readiness.total === 0 || readiness.decided < readiness.total}
              onClick={handleRelease}
            >
              {releasing ? "Releasing…" : "Release results"}
            </button>
          )}
        </div>
      ) : null}

      <div className="admin-panel-card">
        <div className="admin-card-header">
          <h3>Applications</h3>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Applicant</th>
                <th>School &amp; year level</th>
                <th>Submitted</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="admin-empty-state">
                    <p>Loading…</p>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="admin-empty-state">
                    <p>No applications found.</p>
                  </td>
                </tr>
              ) : (
                items.map((app) => (
                  <tr key={app._id}>
                    <td>
                      <div className="admin-stack-cell">
                        <strong>{app.applicant?.name || "Applicant"}</strong>
                        <span className="admin-muted">{app.applicant?.email}</span>
                      </div>
                    </td>
                    <td>
                      {app.isOutOfSchoolYouth ? (
                        <span className="spes-chip spes-chip--osy">Out-of-school youth</span>
                      ) : (
                        <div className="admin-stack-cell">
                          <span>{app.school || "—"}</span>
                          {app.gradeLevel ? <span className="admin-muted">{app.gradeLevel}</span> : null}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="spes-submitted-date">
                        <Clock size={13} aria-hidden="true" /> {formatDate(app.createdAt)}
                      </span>
                      <AgeBadge app={app} />
                    </td>
                    <td>
                      <span className={`spes-chip spes-chip--${app.status}`}>{STATUS_LABEL[app.status] || app.status}</span>
                    </td>
                    <td>
                      <button type="button" className="admin-inline-btn" onClick={() => setReviewing(app)}>
                        <Eye size={14} /> Review &amp; Evaluate
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {reviewing ? (
        <SpesEvalDrawer app={reviewing} onClose={() => setReviewing(null)} onSaved={patchItem} />
      ) : null}
    </div>
  );
}
