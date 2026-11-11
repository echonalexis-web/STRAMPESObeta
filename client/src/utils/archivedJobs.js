// View helpers for the Archived tab. The server computes every rule (status, close
// reason, funnel, duration, stats); these only decide how a value is presented.

export const FILTER_IDS = ["all", "filled", "closed_manually", "expired", "no_applicants"];
export const SORT_IDS = ["recent", "applicants"];

// Status chip: text always, tone only as a visual aid.
const STATUS_TONES = { filled: "success", closed_manually: "neutral", expired: "warning", auto_closed: "warning", closed: "neutral" };
export const statusTone = (status) => STATUS_TONES[status] || "neutral";
export const statusKey = (status) => (STATUS_TONES[status] ? status : "closed");

// A posting nobody applied to is a compact, muted, non-expandable row.
export const hasApplicants = (item) => Number(item?.funnel?.applicants) > 0;
export const canExpand = hasApplicants;

// Duration text parts: under a day, a count of days, or nothing when unknown.
export const durationParts = (days) => {
  if (typeof days !== "number" || Number.isNaN(days)) return null;
  return days < 1 ? { key: "lessThanDay" } : { key: "daysOpen", count: days };
};

// "x of y" share as a whole percentage; empty when there is nothing to divide.
export const percentOf = (part, total) => (Number(total) > 0 ? Math.round((Number(part) / Number(total)) * 100) : null);

// Bars add nothing for a handful of applicants, so they appear from five up.
export const showFunnelBars = (funnel) => Number(funnel?.applicants) >= 5;

// Query for GET /employer/jobs/archived: defaults are left out.
export const buildArchivedQuery = ({ page = 1, pageSize = 10, filter = "all", sort = "recent", q = "" } = {}) => {
  const params = { page, limit: pageSize };
  if (FILTER_IDS.includes(filter) && filter !== "all") params.filter = filter;
  if (SORT_IDS.includes(sort) && sort !== "recent") params.sort = sort;
  const query = String(q || "").trim();
  if (query) params.q = query;
  return params;
};

// Which empty state to show: nothing archived at all, or nothing left after a filter or search.
export const emptyKind = ({ total, counts, filter, q }) => {
  if (total > 0) return null;
  const nothingArchived = !counts || Number(counts.all) === 0;
  if (nothingArchived && (!filter || filter === "all") && !String(q || "").trim()) return "none";
  return "filtered";
};

// Whether a hired person can be linked (a deleted account cannot).
export const candidateLink = (candidate) => (candidate && !candidate.former && candidate.id ? `/employer/applicants/${candidate.id}` : null);

// Stat values: null means "no data", shown as an em dash.
export const statText = (value, suffix = "") => (value === null || value === undefined ? "—" : `${value}${suffix}`);
