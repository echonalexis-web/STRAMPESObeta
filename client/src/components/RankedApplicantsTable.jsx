import React from "react";
import { formatDate, normalizeApplicationStatus, statusClass } from "../utils/helpers";

const getMatchClass = (score) => {
  const percent = Math.round((score || 0) * 100);
  if (percent >= 60) return "match-high";
  if (percent >= 30) return "match-medium";
  return "match-low";
};

export default function RankedApplicantsTable({
  applicants,
  onViewApplicant,
  onMessageApplicant,
  loading = false,
}) {
  if (loading) return <p className="empty-muted">Loading ranked applicants...</p>;
  if (!applicants || applicants.length === 0) return <p className="empty-muted">No applicants yet.</p>;

  return (
    <div className="ranked-applicants-wrapper">
      <div className="applicant-row-header">
        <span className="header-rank">#</span>
        <span className="header-info">Applicant</span>
        <span className="header-match">Match</span>
        <span className="header-date">Applied</span>
        <span className="header-status">Status</span>
        <span className="header-actions">Actions</span>
      </div>

      <div className="applicant-list">
        {applicants.map((application, index) => {
          const applicant = application.applicant || {};
          const hasSkills = applicant.skills && applicant.skills.length > 0;

          return (
            <div key={application._id} className="applicant-row">
              <span className="applicant-rank">{index + 1}</span>
              <div className="applicant-identity">
                <span className="applicant-avatar">
                  {(applicant.name || "U").trim().charAt(0).toUpperCase()}
                </span>
                <div className="applicant-info">
                  <strong>{applicant.name || "Unknown"}</strong>
                  <p className="applicant-email">{applicant.email || "No email"}</p>
                  {hasSkills && (
                    <div className="applicant-skills">
                      {applicant.skills.slice(0, 3).map((skill) => (
                        <span key={skill} className="skill-tag">{skill}</span>
                      ))}
                      {applicant.skills.length > 3 && (
                        <span className="skill-tag">+{applicant.skills.length - 3}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="applicant-match">
                {hasSkills ? (
                  <div className={`match-badge ${getMatchClass(application.relevanceScore)}`}>
                    {Math.round((application.relevanceScore || 0) * 100)}%
                  </div>
                ) : (
                  <div className="no-skills-badge">No skills</div>
                )}
              </div>
              <div className="applicant-date">{formatDate(application.appliedAt)}</div>
              <span className={`status-pill ${statusClass(application.status)}`}>
                {normalizeApplicationStatus(application.status)}
              </span>
              <div className="applicant-row-actions">
                <button type="button" className="text-action-btn" onClick={() => onViewApplicant(application)}>View Details</button>
                <button type="button" className="text-action-btn" onClick={() => onMessageApplicant(applicant._id)}>Message</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}