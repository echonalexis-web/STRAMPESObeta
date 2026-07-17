import React from "react";
import "../styles/qualifications-editor.css";

const TYPE_ICONS = {
  education: "🎓",
  experience: "💼",
  skill: "🔧",
  certification: "📜",
  license: "📄",
  other: "📌",
};

const TYPE_LABELS = {
  education: "Education",
  experience: "Experience",
  skill: "Skills",
  certification: "Certifications",
  license: "Licenses",
  other: "Other",
};

export default function QualificationsDisplay({ qualifications = [], maxBadges = 0, compact = false }) {
  if (!qualifications || qualifications.length === 0) {
    return <p className="qualifications-empty-text">No qualifications specified.</p>;
  }

  // For compact mode (e.g., job cards), show only first N qualifications
  let displayQuals = qualifications;
  if (compact && maxBadges > 0) {
    displayQuals = qualifications.slice(0, maxBadges);
  }

  // Group by type
  const groups = displayQuals.reduce((acc, q) => {
    const type = q.type || "other";
    if (!acc[type]) acc[type] = [];
    acc[type].push(q);
    return acc;
  }, {});

  // Sort types
  const typeOrder = ["education", "experience", "skill", "certification", "license", "other"];
  const sortedTypes = Object.keys(groups).sort((a, b) => {
    return typeOrder.indexOf(a) - typeOrder.indexOf(b);
  });

  if (compact) {
    // For compact display (badges), show as simple list
    return (
      <div className="qualifications-badges">
        {displayQuals.map((q, idx) => (
          <span key={idx} className="qualification-badge">
            {q.optional ? "🌟 " : ""}
            {q.value}
          </span>
        ))}
        {qualifications.length > maxBadges && (
          <span className="qualification-badge more">+{qualifications.length - maxBadges} more</span>
        )}
      </div>
    );
  }

  // Full display (grouped)
  return (
    <div className="qualifications-display">
      {sortedTypes.map((type) => (
        <div key={type} className="qualifications-group">
          <h4 className="qualifications-group-title">
            {TYPE_ICONS[type]} {TYPE_LABELS[type] || type}
          </h4>
          <ul className="qualifications-group-list">
            {groups[type].map((q, idx) => (
              <li key={idx} className="qualifications-group-item">
                <span className="qualifications-group-value">{q.value}</span>
                {q.optional && (
                  <span className="qualifications-group-optional">(Preferred)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}