import React from "react";
import "../styles/modal.css";
import { FaTimes, FaMapMarkerAlt, FaMoneyBillWave, FaBuilding, FaBriefcase, FaCalendarAlt, FaEnvelope } from "react-icons/fa";
import QualificationsDisplay from "./QualificationsDisplay";
import "../styles/qualifications-editor.css";

const formatAddress = (address) => {
  if (!address) return "Not specified";
  const parts = address.split(", ");
  if (parts.length >= 2) {
    return (
      <>
        <span>{parts[0]}</span><br /><span className="text-muted">{parts.slice(1).join(", ")}</span>
      </>
    );
  }
  return address;
};

const getMatchClass = (score) => {
  const percent = Math.round((score || 0) * 100);
  if (percent >= 60) return 'match-high';
  if (percent >= 30) return 'match-medium';
  return 'match-low';
};

export default function Modal({ isOpen, onClose, job, onMessageEmployer, applications = [], onViewApplication }) {
  if (!isOpen || !job) return null;

  const isAlreadyApplied = applications.some((app) => String(app.vacancy?._id) === String(job._id));
  const application = applications.find((app) => String(app.vacancy?._id) === String(job._id));

  const formatDate = (date) => {
    if (!date) return "Not specified";
    return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  };

  const handleMessageClick = () => {
    if (onMessageEmployer) {
      onMessageEmployer(job);
    } else {
      console.warn("onMessageEmployer prop is missing – please pass it to Modal.");
    }
  };

  const handleViewApplication = () => {
    if (onViewApplication && application) {
      onViewApplication(application);
      onClose();
    }
  };

  const handleApplyClick = () => {
    window.location.href = `/jobs/${job._id}`;
  };

  return (
    <div className="job-dialog-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="job-dialog-card" role="dialog" aria-modal="true" aria-label="Job details">
        <button className="job-dialog-close" onClick={onClose} type="button" aria-label="Close">
          <FaTimes />
        </button>

        <div className="job-dialog-header">
          <div className="job-dialog-title-section">
            <h2>{job.title}</h2>
            <span className="job-dialog-status">● Open</span>
            <div className={`match-badge ${getMatchClass(job.relevanceScore)}`}>
              {Math.round((job.relevanceScore || 0) * 100)}%
            </div>
          </div>
          <div className="job-dialog-company"><FaBuilding /><span>{job.employer?.companyName || job.employer?.name || "Company"}</span></div>
        </div>

        <div className="job-dialog-chips">
          <span className="job-dialog-chip"><FaMapMarkerAlt /> {formatAddress(job.location)}</span>
          <span className="job-dialog-chip"><FaMoneyBillWave /> {job.salary || "Salary negotiable"}</span>
          <span className="job-dialog-chip"><FaBriefcase /> {job.jobType || "Full-time"}</span>
          <span className="job-dialog-chip"><FaCalendarAlt /> Posted {formatDate(job.createdAt)}</span>
        </div>

        <div className="job-dialog-section"><h3>About this position</h3><p>{job.description || "No description provided."}</p></div>
        
        {job.qualifications && job.qualifications.length > 0 ? (
          <div className="job-dialog-section job-dialog-section-light">
            <h3>Qualifications / Requirements</h3>
            <QualificationsDisplay qualifications={job.qualifications} />
          </div>
        ) : (
          <div className="job-dialog-section job-dialog-section-light">
            <h3>Requirements</h3>
            <p>No requirements provided.</p>
          </div>
        )}

        <div className="job-dialog-footer">
          {isAlreadyApplied ? (
            <button className="job-dialog-apply-btn job-dialog-apply-btn--applied" onClick={handleViewApplication}>
              View Application
            </button>
          ) : (
            <button className="job-dialog-apply-btn" onClick={handleApplyClick}>Apply Now</button>
          )}
          <button className="job-dialog-message-btn" onClick={handleMessageClick}>
            <FaEnvelope /> Message Employer
          </button>
          <button className="job-dialog-close-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}