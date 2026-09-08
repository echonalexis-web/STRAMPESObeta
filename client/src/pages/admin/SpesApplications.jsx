import { useCallback, useEffect, useMemo, useState } from "react";
import { newsAPI, spesAPI } from "../../services/api";
import SecureFileLink from "../../components/SecureFileLink";
import { useToast } from "../../components/feedback/context";
import AdminHeader from "./AdminHeader";
import "../../styles/admin.css";
import "../../styles/spes.css";

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

const OUTCOME_OPTIONS = ["pending", "accepted", "waitlisted", "not_accepted"];

function EvalRow({ app, onSaved }) {
  const toast = useToast();
  const [examScore, setExamScore] = useState(app.evaluation?.examScore ?? "");
  const [interviewScore, setInterviewScore] = useState(app.evaluation?.interviewScore ?? "");
  const [outcome, setOutcome] = useState(app.result?.outcome || "pending");
  const [remarks, setRemarks] = useState(app.result?.remarks || "");
  const [status, setStatus] = useState(app.status);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await spesAPI.adminRecordEvaluation(app._id, {
        examScore,
        interviewScore,
        outcome,
        remarks,
        status: ["under_review", "for_exam", "for_interview", "evaluated"].includes(status) ? status : undefined,
      });
      toast.success("Evaluation saved.");
      onSaved(data?.application);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr>
      <td>
        <div className="admin-stack-cell">
          <strong>{app.applicant?.name || "Applicant"}</strong>
          <span className="admin-muted">{app.applicant?.email}</span>
        </div>
      </td>
      <td>{app.school || "—"}</td>
      <td>
        <div className="admin-doc-links">
          {(app.documents || []).length === 0 ? (
            <span className="admin-muted">No documents</span>
          ) : (
            app.documents.map((doc, i) => (
              <SecureFileLink key={i} className="admin-inline-btn" value={doc.fileUrl}>
                {doc.label || `Doc ${i + 1}`}
              </SecureFileLink>
            ))
          )}
        </div>
      </td>
      <td>
        <div className="spes-eval-row">
          <input
            type="number"
            placeholder="Exam"
            value={examScore}
            onChange={(e) => setExamScore(e.target.value)}
          />
          <input
            type="number"
            placeholder="Interview"
            value={interviewScore}
            onChange={(e) => setInterviewScore(e.target.value)}
          />
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {OUTCOME_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            type="text"
            style={{ width: "10rem" }}
            placeholder="Remarks"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
          <button className="admin-inline-btn" type="button" disabled={saving} onClick={save}>
            {saving ? "…" : "Save"}
          </button>
        </div>
      </td>
    </tr>
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
                {s}
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
                <th>School</th>
                <th>Documents</th>
                <th>Evaluation &amp; outcome</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="admin-empty-state">
                    <p>Loading…</p>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="admin-empty-state">
                    <p>No applications found.</p>
                  </td>
                </tr>
              ) : (
                items.map((app) => <EvalRow key={app._id} app={app} onSaved={patchItem} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
