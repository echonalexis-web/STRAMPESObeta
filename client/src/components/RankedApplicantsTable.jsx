import React from "react";
import { formatDate, normalizeApplicationStatus, statusClass } from "../utils/helpers";
import { FaStar, FaCheck, FaTimes, FaClock, FaBan } from "react-icons/fa";

const getStatusIcon = (status) => {
  const normalized = normalizeApplicationStatus(status);
  switch (normalized) {
    case 'shortlisted':
      return <FaStar className="status-icon" />;
    case 'hired':
      return <FaCheck className="status-icon" />;
    case 'rejected':
      return <FaTimes className="status-icon" />;
    case 'pending':
      return <FaClock className="status-icon" />;
    default:
      return <FaBan className="status-icon" />;
  }
};

const getMatchClass = (score) => {
  const percent = Math.round((score || 0) * 100);
  if (percent >= 60) return "match-high";
  if (percent >= 30) return "match-medium";
  return "match-low";
};

const getMatchLabel = (score) => {
  const percent = Math.round((score || 0) * 100);
  if (percent >= 60) return "High";
  if (percent >= 30) return "Medium";
  return "Low";
};

export default function RankedApplicantsTable({
  applicants,
  onViewApplicant,
  onMessageApplicant,
  loading = false,
  selectedApplicants = [],
  onSelectApplicant,
  onSelectAll,
  isAllSelected = false,
  onQuickStatusChange,
  emptyStateMessage = "No applicants yet.",
  emptyStateIcon = "📋",
}) {
  if (loading) return (
    <div className="empty-state">
      <div className="empty-state-icon">⏳</div>
      <p className="empty-state-text">Loading ranked applicants...</p>
    </div>
  );

  if (!applicants || applicants.length === 0) return (
    <div className="empty-state">
      <div className="empty-state-icon">{emptyStateIcon}</div>
      <p className="empty-state-text">{emptyStateMessage}</p>
    </div>
  );

  const handleSelectAll = (e) => {
    onSelectAll(e.target.checked);
  };

  const handleSelectApplicant = (applicationId, checked) => {
    onSelectApplicant(applicationId, checked);
  };

  return (
    <div className="ranked-applicants-wrapper">
      <div className="ranked-applicants-scroll">
        <div className="applicant-row-header">
          <span className="header-checkbox">
            <input
              type="checkbox"
              checked={isAllSelected}
              onChange={handleSelectAll}
              aria-label="Select all applicants"
            />
          </span>
          <span className="header-rank">#</span>
          <span className="header-info">APPLICANT</span>
          <span className="header-match">MATCH</span>
          <span className="header-date">APPLIED</span>
          <span className="header-status">STATUS</span>
          <span className="header-actions">ACTIONS</span>
        </div>

        <div className="applicant-list">
          {applicants.map((application, index) => {
            const applicant = application.applicant || {};
            const hasSkills = applicant.skills && applicant.skills.length > 0;
            const isSelected = selectedApplicants.includes(application._id);

            return (
              <div key={application._id} className="applicant-row">
                <span className="applicant-checkbox">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => handleSelectApplicant(application._id, e.target.checked)}
                    aria-label={`Select ${applicant.name || 'applicant'}`}
                  />
                </span>
                <span className="applicant-rank">{index + 1}</span>

                <div className="applicant-identity">
                  <span className="applicant-avatar">
                    {(applicant.name || "U").trim().charAt(0).toUpperCase()}
                  </span>
                  <div className="applicant-info">
                    <strong>{applicant.name || "Unknown"}</strong>
                    <p
                      className="applicant-email"
                      title={applicant.email || "No email"}
                    >
                      {applicant.email || "No email"}
                    </p>
                    {hasSkills && (
                      <div className="applicant-skills">
                        {applicant.skills.slice(0, 3).map((skill) => (
                          <span key={skill} className="skill-tag">{skill}</span>
                        ))}
                        {applicant.skills.length > 3 && (
                          <span className="skill-tag overflow-tag">
                            +{applicant.skills.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="applicant-match">
                  <div className={`match-badge ${getMatchClass(application.relevanceScore)}`}>
                    <span className="match-percent">
                      {Math.round((application.relevanceScore || 0) * 100)}%
                    </span>
                    <span className="match-label">
                      {getMatchLabel(application.relevanceScore)}
                    </span>
                  </div>
                </div>

                <div className="applicant-date">{formatDate(application.appliedAt)}</div>

                <span className={`status-pill ${statusClass(application.status)}`}>
                  {getStatusIcon(application.status)}
                  {normalizeApplicationStatus(application.status)}
                </span>

                <div className="applicant-row-actions">
                  {onQuickStatusChange && (
                    <div className="quick-status-actions">
                      <button
                        type="button"
                        className="quick-status-btn quick-shortlist"
                        onClick={() => onQuickStatusChange(application._id, 'shortlisted')}
                        title="Shortlist"
                      >
                        <FaStar />
                      </button>
                      <button
                        type="button"
                        className="quick-status-btn quick-reject"
                        onClick={() => onQuickStatusChange(application._id, 'rejected')}
                        title="Reject"
                      >
                        <FaTimes />
                      </button>
                    </div>
                  )}

                  <div className="applicant-main-actions">
                    <button
                      type="button"
                      className="text-action-btn"
                      onClick={() => onViewApplicant(application)}
                    >
                      View Details
                    </button>
                    <button
                      type="button"
                      className="text-action-btn"
                      onClick={() => onMessageApplicant(applicant._id)}
                    >
                      Message
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}