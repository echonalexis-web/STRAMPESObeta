import React from "react";
import { FaStar, FaUsers, FaEnvelope, FaPhone, FaGlobe, FaMapMarkerAlt, FaBriefcase, FaRegClock } from "react-icons/fa";
import "../styles/EmployerModal.css"; // or create a separate employerModal.css

export default function EmployerModal({ isOpen, onClose, employer }) {
  if (!isOpen || !employer) return null;

  return (
    <div className="employer-modal-overlay" onClick={onClose}>
      <div className="employer-modal" onClick={(e) => e.stopPropagation()}>
        {/* Close Button */}
        <button className="employer-modal-close" onClick={onClose}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Header */}
        <div className="employer-modal-header">
          <div className="employer-avatar">
            <span className="employer-avatar-text">
              {employer.companyName?.charAt(0) || "E"}
            </span>
          </div>
          <div className="employer-header-info">
            <h2>{employer.companyName || "Unknown Employer"}</h2>
            <div className="employer-badge">
              <FaStar className="badge-icon" />
              <span>Verified Employer</span>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="employer-stats">
          <div className="stat-item">
            <FaUsers className="stat-icon" />
            <div>
              <span className="stat-value">{employer.companySize || "N/A"}</span>
              <span className="stat-label">Company Size</span>
            </div>
          </div>
          <div className="stat-item">
            <FaBriefcase className="stat-icon" />
            <div>
              <span className="stat-value">{employer.industry || "N/A"}</span>
              <span className="stat-label">Industry</span>
            </div>
          </div>
          <div className="stat-item">
            <FaRegClock className="stat-icon" />
            <div>
              <span className="stat-value">Active</span>
              <span className="stat-label">Status</span>
            </div>
          </div>
        </div>

        {/* Contact Information */}
        <div className="employer-section">
          <h3 className="employer-section-title">Contact Information</h3>
          <div className="employer-contact-grid">
            {employer.email && (
              <div className="contact-item">
                <FaEnvelope className="contact-icon" />
                <div>
                  <span className="contact-label">Email</span>
                  <span className="contact-value">{employer.email}</span>
                </div>
              </div>
            )}
            {employer.phone && (
              <div className="contact-item">
                <FaPhone className="contact-icon" />
                <div>
                  <span className="contact-label">Phone</span>
                  <span className="contact-value">{employer.phone}</span>
                </div>
              </div>
            )}
            {employer.website && (
              <div className="contact-item">
                <FaGlobe className="contact-icon" />
                <div>
                  <span className="contact-label">Website</span>
                  <a href={employer.website} target="_blank" rel="noopener noreferrer" className="contact-link">
                    {employer.website.replace(/^https?:\/\//, '')}
                  </a>
                </div>
              </div>
            )}
            {employer.businessAddress && (
              <div className="contact-item">
                <FaMapMarkerAlt className="contact-icon" />
                <div>
                  <span className="contact-label">Business Address</span>
                  <span className="contact-value">{employer.businessAddress}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* About */}
        <div className="employer-section">
          <h3 className="employer-section-title">About</h3>
          <p className="employer-description">
            {employer.companyDescription || "No company description available."}
          </p>
        </div>

        {/* Footer */}
        <div className="employer-modal-footer">
          <span className="footer-verification">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1zm-1 16.5l-4.5-4.5 1.5-1.5 3 3 6-6 1.5 1.5-7.5 7.5z"/>
            </svg>
            Verified Employer - Strampeso Certified
          </span>
        </div>
      </div>
    </div>
  );
}