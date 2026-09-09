import { useState, useRef, useEffect } from "react";
import { normalizeApplicationStatus, statusClass } from "../utils/helpers";
import { FaStar, FaCheck, FaTimes, FaClock, FaBan, FaEllipsisH } from "react-icons/fa";

const getStatusIcon = (status) => {
  switch (normalizeApplicationStatus(status)) {
    case "shortlisted":
      return <FaStar className="status-icon" />;
    case "hired":
      return <FaCheck className="status-icon" />;
    case "rejected":
      return <FaTimes className="status-icon" />;
    case "pending":
      return <FaClock className="status-icon" />;
    default:
      return <FaBan className="status-icon" />;
  }
};

const matchTier = (score) => {
  const percent = Math.round((score || 0) * 100);
  if (percent >= 60) return { cls: "match-high", label: "High", percent };
  if (percent >= 30) return { cls: "match-medium", label: "Medium", percent };
  return { cls: "match-low", label: "Low", percent };
};

const DIMENSION_LABELS = {
  skills: "Skills",
  title: "Job title fit",
  experience: "Experience",
  education: "Education",
  credentials: "Certifications / licenses",
  industry: "Industry",
  language: "Language",
  salary: "Salary fit",
};

// Turn the matchBreakdown object into a readable hover summary.
const breakdownSummary = (breakdown) => {
  if (!breakdown || typeof breakdown !== "object") return "";
  if (breakdown.ageEligible === false) return "Outside the job's age range";
  const parts = Object.entries(DIMENSION_LABELS)
    .filter(([key]) => typeof breakdown[key] === "number")
    .map(([key, label]) => `${label}: ${Math.round(breakdown[key] * 100)}%`);
  if (breakdown.ageUnknown) parts.push("Age: not on file");
  return parts.join("  •  ");
};

function RowMenu({ onShortlist, onReject, onViewProfile, onMessage }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", () => setOpen(false), true);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggle = (e) => {
    if (open) { setOpen(false); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: Math.max(8, r.right - 176) });
    setOpen(true);
  };

  return (
    <div className="rt-menu" ref={ref}>
      <button
        type="button"
        className="rt-menu-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="More actions"
        onClick={toggle}
      >
        <FaEllipsisH />
      </button>
      {open && (
        <div className="rt-menu-list rt-menu-floating" role="menu" style={{ top: pos.top, left: pos.left }}>
          {onShortlist && (
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onShortlist(); }}>
              Shortlist
            </button>
          )}
          {onReject && (
            <button type="button" role="menuitem" className="danger" onClick={() => { setOpen(false); onReject(); }}>
              Reject
            </button>
          )}
          {(onShortlist || onReject) && (onViewProfile || onMessage) && <div className="rt-menu-sep" />}
          {onViewProfile && (
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onViewProfile(); }}>
              View full profile
            </button>
          )}
          {onMessage && (
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onMessage(); }}>
              Send message
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function RankedApplicantsTable({
  applicants,
  onViewApplicant,
  onMessageApplicant,
  onViewProfile,
  loading = false,
  selectedApplicants = [],
  onSelectApplicant,
  onSelectAll,
  isAllSelected = false,
  onQuickStatusChange,
  emptyStateMessage = "No applicants yet.",
  emptyStateIcon = "📋",
}) {
  if (loading) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">⏳</div>
        <p className="empty-state-text">Loading ranked applicants...</p>
      </div>
    );
  }

  if (!applicants || applicants.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">{emptyStateIcon}</div>
        <p className="empty-state-text">{emptyStateMessage}</p>
      </div>
    );
  }

  return (
    <div className="ranked-applicants-wrapper">
      <div className="rt-scroll">
        <table className="rt-table">
          <colgroup>
            <col style={{ width: "40px" }} />
            <col style={{ width: "86px" }} />
            <col />
            <col style={{ width: "142px" }} />
            <col style={{ width: "196px" }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="rt-c-check">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={(e) => onSelectAll(e.target.checked, applicants)}
                  aria-label="Select all applicants"
                />
              </th>
              <th scope="col" className="rt-c-match">Match</th>
              <th scope="col" className="rt-c-identity">Applicant</th>
              <th scope="col" className="rt-c-status">Status</th>
              <th scope="col" className="rt-c-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {applicants.map((application, index) => {
              const applicant = application.applicant || {};
              const isSelected = selectedApplicants.includes(application._id);
              const tier = matchTier(application.relevanceScore);
              const normalized = normalizeApplicationStatus(application.status);
              const isDisqualified = application.disqualified === "age";
              const matchHint = breakdownSummary(application.matchBreakdown);

              return (
                <tr
                  key={application._id}
                  className={`rt-row ${isSelected ? "selected" : ""} ${normalized === "pending" ? "is-new" : ""} ${isDisqualified ? "rt-row-dq" : ""}`}
                  onClick={() => onViewApplicant(application)}
                >
                  <td className="rt-c-check" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => onSelectApplicant(application._id, e.target.checked)}
                      aria-label={`Select ${applicant.name || "applicant"}`}
                    />
                  </td>

                  <td className="rt-c-match">
                    {isDisqualified ? (
                      <span className="rt-dq-badge" title="Outside the job's age requirement">
                        <FaBan /> Age
                      </span>
                    ) : (
                      <span
                        className={`rt-gauge ${tier.cls}`}
                        style={{ "--pct": tier.percent }}
                        title={matchHint || `${tier.label} match (${tier.percent}%)`}
                      >
                        <span className="rt-gauge-val">{tier.percent}%</span>
                      </span>
                    )}
                    <span className="rt-rank">#{index + 1}</span>
                  </td>

                  <td className="rt-c-identity">
                    <div className="rt-identity">
                      <span className="rt-avatar">
                        {(applicant.name || "U").trim().charAt(0).toUpperCase()}
                      </span>
                      <div className="rt-identity-text">
                        <strong className="rt-name" title={applicant.name || "Unknown"}>
                          {applicant.name || "Unknown"}
                        </strong>
                        <span className="rt-email" title={applicant.email || "No email"}>
                          {applicant.email || "No email"}
                        </span>
                      </div>
                    </div>
                  </td>

                  <td className="rt-c-status" onClick={(e) => e.stopPropagation()}>
                    {onQuickStatusChange ? (
                      <select
                        className={`rt-status-select status-pill ${statusClass(application.status)}`}
                        value={normalized}
                        onChange={(e) => onQuickStatusChange(application._id, e.target.value)}
                        aria-label={`Status for ${applicant.name || "applicant"}`}
                      >
                        <option value="pending">Pending</option>
                        <option value="reviewed">Reviewed</option>
                        <option value="shortlisted">Shortlisted</option>
                        <option value="hired">Hired</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    ) : (
                      <span className={`status-pill ${statusClass(application.status)}`}>
                        {getStatusIcon(application.status)}
                        {normalized}
                      </span>
                    )}
                  </td>

                  <td className="rt-c-actions" onClick={(e) => e.stopPropagation()}>
                    <div className="rt-actions">
                      <button
                        type="button"
                        className="rt-review-btn"
                        onClick={() => onViewApplicant(application)}
                      >
                        Review
                      </button>
                      {onQuickStatusChange && (
                        <>
                          <button
                            type="button"
                            className="rt-icon-btn shortlist"
                            title="Shortlist"
                            aria-label="Shortlist applicant"
                            onClick={() => onQuickStatusChange(application._id, "shortlisted")}
                          >
                            <FaStar />
                          </button>
                          <button
                            type="button"
                            className="rt-icon-btn reject"
                            title="Reject"
                            aria-label="Reject applicant"
                            onClick={() => onQuickStatusChange(application._id, "rejected")}
                          >
                            <FaTimes />
                          </button>
                        </>
                      )}
                      <RowMenu
                        onShortlist={onQuickStatusChange ? () => onQuickStatusChange(application._id, "shortlisted") : null}
                        onReject={onQuickStatusChange ? () => onQuickStatusChange(application._id, "rejected") : null}
                        onViewProfile={onViewProfile ? () => onViewProfile(applicant._id) : null}
                        onMessage={onMessageApplicant ? () => onMessageApplicant(applicant._id) : null}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
