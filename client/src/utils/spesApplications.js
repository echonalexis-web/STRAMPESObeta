// Pure helpers for the applicant "My SPES Applications" page: which group a status
// belongs to, counts for the stat tiles, filtering, sorting and which row opens first.
import { normalizeSpesStatus } from "./spesSlots.js";

export const APPLICATION_FILTERS = ["all", "inProgress", "needsAction", "released", "closed"];

// inProgress   submitted, documents under review, qualified, evaluated, result recorded
// needsAction  needs resubmission (the applicant's move)
// released     results released (accepted, waitlisted or not accepted)
// closed       withdrawn or disqualified
export const groupOf = (status) => {
  const s = normalizeSpesStatus(status);
  if (s === "needs_resubmission") return "needsAction";
  if (s === "results_released") return "released";
  if (s === "withdrawn" || s === "disqualified") return "closed";
  return "inProgress";
};

export const countGroups = (items) => {
  const counts = { all: items.length, inProgress: 0, needsAction: 0, released: 0, closed: 0 };
  items.forEach((app) => {
    counts[groupOf(app.status)] += 1;
  });
  return counts;
};

export const matchesFilter = (app, filter) => filter === "all" || groupOf(app.status) === filter;

// Documents staff asked the applicant to replace.
export const replacementCount = (app) =>
  (app?.documents || []).filter((doc) => doc?.verification?.state === "needs_replacement").length;

const time = (value) => {
  const n = new Date(value).getTime();
  return Number.isNaN(n) ? 0 : n;
};

// Applications that need action come first, then the chosen date order.
export const sortApplications = (items, sort = "newest") =>
  [...items].sort((a, b) => {
    const pa = groupOf(a.status) === "needsAction" ? 0 : 1;
    const pb = groupOf(b.status) === "needsAction" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const diff = time(a.createdAt) - time(b.createdAt);
    return sort === "oldest" ? diff : -diff;
  });

export const searchApplications = (items, query, titleOf) => {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return items;
  return items.filter((app) => String(titleOf(app) || "").toLowerCase().includes(q));
};

// Which row is open on first load. `sorted` is newest first with action-needed rows on top.
// Rule: the first application that needs action; otherwise the most recent one when there
// are few applications (three or fewer); otherwise none.
export const FEW_APPLICATIONS = 3;
export const initialOpenId = (sorted) => {
  if (!sorted.length) return null;
  const needs = sorted.find((app) => groupOf(app.status) === "needsAction");
  if (needs) return String(needs._id);
  return sorted.length <= FEW_APPLICATIONS ? String(sorted[0]._id) : null;
};
