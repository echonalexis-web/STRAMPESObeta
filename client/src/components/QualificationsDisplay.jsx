import React from "react";
import "../styles/qualifications-editor.css";
import {
  TYPE_ICONS,
  TYPE_LABELS,
  foldType,
  groupQualificationsByType,
} from "../utils/qualifications";

export default function QualificationsDisplay({ qualifications = [], maxBadges = 0, compact = false }) {
  if (!qualifications || qualifications.length === 0) {
    return <p className="qualifications-empty-text">No qualifications specified.</p>;
  }

  if (compact) {
    // Job cards etc. — a flat list of badges, optionally capped.
    const displayQuals = maxBadges > 0 ? qualifications.slice(0, maxBadges) : qualifications;
    return (
      <div className="qualifications-badges">
        {displayQuals.map((q, idx) => (
          <span key={idx} className="qualification-badge">
            {q.optional ? "🌟 " : ""}
            {q.value}
          </span>
        ))}
        {maxBadges > 0 && qualifications.length > maxBadges && (
          <span className="qualification-badge more">+{qualifications.length - maxBadges} more</span>
        )}
      </div>
    );
  }

  // Full display — grouped by type, with the legacy "other" folded into "skill".
  // Non-skill groups read as clean lines; the skills bucket renders as chips.
  const groups = groupQualificationsByType(qualifications);

  return (
    <div className="qualifications-display">
      {groups.map(({ type, items }) => {
        const folded = foldType(type);
        const asChips = folded === "skill";
        return (
          <div key={type} className={`qualifications-group qualifications-group--${folded}`}>
            <div className="qualifications-group-head">
              <span className="qualifications-group-icon" aria-hidden="true">{TYPE_ICONS[folded]}</span>
              <span className="qualifications-group-label">{TYPE_LABELS[folded] || type}</span>
            </div>

            {asChips ? (
              <div className="qualifications-chips">
                {items.map((q, idx) => (
                  <span key={idx} className={`qualification-chip ${q.optional ? "is-optional" : ""}`}>
                    {q.value}
                    {q.optional && <em> · preferred</em>}
                  </span>
                ))}
              </div>
            ) : (
              <ul className="qualifications-lines">
                {items.map((q, idx) => (
                  <li key={idx} className="qualifications-line">
                    {q.value}
                    {q.optional && <span className="qualifications-line-opt"> (preferred)</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
