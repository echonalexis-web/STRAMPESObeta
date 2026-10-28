// client/src/utils/helpers.js

/**
 * Format a date to a readable string.
 * @param {string|Date} value - Date to format.
 * @returns {string} Formatted date (e.g., "Jan 15, 2025") or "N/A".
 */
export const formatDate = (value) => {
  if (!value) return "N/A";
  const date = new Date(value);
  if (isNaN(date.getTime())) return "N/A";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

/**
 * Normalize application status to a consistent set of values.
 * @param {string} status - Raw status string.
 * @returns {string} Normalized status.
 */
export const normalizeApplicationStatus = (status) => {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "applied") return "pending";
  if (normalized === "accepted") return "hired";
  // "reviewed" is the pre-cleanup name for "under_review" — tolerated here
  // for any row not yet migrated by server/scripts/migrateApplicationStatuses.js.
  if (normalized === "reviewed") return "under_review";
  if (normalized === "rejected") return "rejected";
  if (normalized === "shortlisted") return "shortlisted";
  if (normalized === "approved") return "approved";
  if (normalized === "withdrawn") return "withdrawn";
  return normalized || "pending";
};

/**
 * Return a CSS class for status styling.
 * @param {string} status - Status value.
 * @returns {string} CSS class name.
 */
export const statusClass = (status) => {
  const normalized = normalizeApplicationStatus(status);
  if (["active", "hired"].includes(normalized)) return "green";
  if (["pending"].includes(normalized)) return "gray";
  if (["under_review"].includes(normalized)) return "blue";
  if (["shortlisted"].includes(normalized)) return "amber";
  if (["approved"].includes(normalized)) return "teal";
  if (["rejected", "closed"].includes(normalized)) return "red";
  if (["withdrawn"].includes(normalized)) return "purple";
  return "gray";
};