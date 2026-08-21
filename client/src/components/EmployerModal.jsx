import React, { useContext } from "react";
import { FaStar, FaUsers, FaEnvelope, FaPhone, FaGlobe, FaMapMarkerAlt, FaBriefcase, FaRegClock, FaTimes } from "react-icons/fa";
import { AuthContext } from "../context/AuthContext";
import { useFollow } from "../hooks/useFollow";
import "../styles/EmployerModal.css";

const formatAddress = (address) => {
  if (!address) return "Not provided";
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

export default function EmployerModal({ isOpen, onClose, employer }) {
  const { user } = useContext(AuthContext);

  const employerId = employer?._id || employer?.id || employer?.userId || null;
  const currentUserId = user?._id || user?.id;
  const isOwnProfile = Boolean(employerId && currentUserId && String(employerId) === String(currentUserId));

  const {
    isFollowing,
    followerCount,
    followingCount,
    loading: followLoading,
    error: followError,
    toggleFollow,
  } = useFollow(employerId);

  if (!isOpen || !employer) return null;

  return (
    <div className="employer-modal-overlay" onClick={onClose}>
      <div className="employer-modal" onClick={(e) => e.stopPropagation()}>
        <button className="employer-modal-close" onClick={onClose} type="button" aria-label="Close">
          <FaTimes />
        </button>

        <div className="employer-modal-header">
          <div className="employer-avatar"><span className="employer-avatar-text">{employer.companyName?.charAt(0) || "E"}</span></div>
          <div className="employer-header-info">
            <h2>{employer.companyName || "Unknown Employer"}</h2>
            <div className="employer-badge"><FaStar className="badge-icon" /><span>Verified Employer</span></div>
            {employerId && !isOwnProfile ? (
              <div className="employer-follow-bar">
                <button
                  type="button"
                  className={`employer-follow-btn ${isFollowing ? "following" : ""}`}
                  onClick={toggleFollow}
                  disabled={followLoading}
                >
                  {followLoading ? "Please wait..." : isFollowing ? "Following" : "Follow"}
                </button>
                <div className="employer-follow-counts">
                  <span>{Number(followerCount || 0)} followers</span>
                  <span>{Number(followingCount || 0)} following</span>
                </div>
              </div>
            ) : null}
            {followError ? <p className="employer-follow-error">{followError}</p> : null}
          </div>
        </div>

        <div className="employer-stats">
          <div className="stat-item"><FaUsers className="stat-icon" /><div><span className="stat-value">{employer.companySize || "N/A"}</span><span className="stat-label">Company Size</span></div></div>
          <div className="stat-item"><FaBriefcase className="stat-icon" /><div><span className="stat-value">{employer.industry || "N/A"}</span><span className="stat-label">Industry</span></div></div>
          <div className="stat-item"><FaRegClock className="stat-icon" /><div><span className="stat-value">Active</span><span className="stat-label">Status</span></div></div>
        </div>

        <div className="employer-section">
          <h3 className="employer-section-title">Contact Information</h3>
          <div className="employer-contact-grid">
            {employer.email && <div className="contact-item"><FaEnvelope className="contact-icon" /><div><span className="contact-label">Email</span><span className="contact-value">{employer.email}</span></div></div>}
            {employer.phone && <div className="contact-item"><FaPhone className="contact-icon" /><div><span className="contact-label">Phone</span><span className="contact-value">{employer.phone}</span></div></div>}
            {employer.website && <div className="contact-item"><FaGlobe className="contact-icon" /><div><span className="contact-label">Website</span><a href={employer.website} target="_blank" rel="noopener noreferrer" className="contact-link">{employer.website.replace(/^https?:\/\//, '')}</a></div></div>}
            {employer.businessAddress && (
              <div className="contact-item">
                <FaMapMarkerAlt className="contact-icon" />
                <div><span className="contact-label">Business Address</span><span className="contact-value">{formatAddress(employer.businessAddress)}</span></div>
              </div>
            )}
          </div>
        </div>

        <div className="employer-section">
          <h3 className="employer-section-title">About</h3>
          <p className="employer-description">{employer.companyDescription || "No company description available."}</p>
        </div>

        <div className="employer-modal-footer">
          <span className="footer-verification">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1zm-1 16.5l-4.5-4.5 1.5-1.5 3 3 6-6 1.5 1.5-7.5 7.5z"/></svg>
            Verified Employer - Strampeso Certified
          </span>
        </div>
      </div>
    </div>
  );
}