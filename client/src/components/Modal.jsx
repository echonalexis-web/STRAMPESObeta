import React from "react";
import "../styles/modal.css";
import { FaTimes, FaMapMarkerAlt, FaMoneyBillWave, FaBuilding, FaBriefcase, FaCalendarAlt } from "react-icons/fa";

export default function Modal({ isOpen, onClose, job }) {
  if (!isOpen || !job) return null;

  const formatDate = (date) => {
    if (!date) return "Not specified";
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <div
      className="job-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="job-dialog-card" role="dialog" aria-modal="true" aria-label="Job details">
        <button className="job-dialog-close" onClick={onClose} type="button" aria-label="Close">
          <FaTimes />
        </button>

        {/* Header */}
        <div className="job-dialog-header">
          <div className="job-dialog-title-section">
            <h2>{job.title}</h2>
            <span className="job-dialog-status">● Open</span>
          </div>
          <div className="job-dialog-company">
            <FaBuilding />
            <span>{job.employer?.companyName || job.employer?.name || "Company"}</span>
          </div>
        </div>

        {/* Quick Info Chips */}
        <div className="job-dialog-chips">
          <span className="job-dialog-chip">
            <FaMapMarkerAlt /> {job.location || "Not specified"}
          </span>
          <span className="job-dialog-chip">
            <FaMoneyBillWave /> {job.salary || "Salary negotiable"}
          </span>
          <span className="job-dialog-chip">
            <FaBriefcase /> {job.jobType || "Full-time"}
          </span>
          <span className="job-dialog-chip">
            <FaCalendarAlt /> Posted {formatDate(job.createdAt)}
          </span>
        </div>

        {/* Description */}
        <div className="job-dialog-section">
          <h3>About this position</h3>
          <p>{job.description || "No description provided."}</p>
        </div>

        {/* Requirements */}
        {job.requirements && (
          <div className="job-dialog-section job-dialog-section-light">
            <h3>Requirements</h3>
            <p>{job.requirements}</p>
          </div>
        )}

        {/* Footer Actions */}
        <div className="job-dialog-footer">
          <button className="job-dialog-apply-btn" onClick={() => window.location.href = `/jobs/${job._id}`}>
            Apply Now
          </button>
          <button className="job-dialog-close-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}