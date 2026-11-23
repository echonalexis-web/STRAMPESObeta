// Dashboard statistics filters <-> URL query string <-> API params, in one place so the
// bar, a shared link and the request always agree (same idea as userDirectoryParams.js).
// The server validates everything again; this module only keeps the URL tidy and
// strips a filter whose control is not shown for the current section.

export const SECTIONS = ["jobs", "employers", "applicants"];
export const PERIOD_TYPES = ["year", "quarter", "month", "custom"];
export const JOB_STATUSES = ["draft", "active", "closed", "archived"];
export const APPLICATION_STATUSES = ["pending", "under_review", "shortlisted", "approved", "rejected", "hired", "withdrawn"];
export const VERIFICATION_OPTIONS = ["unverified", "pending", "under_review", "verified", "resubmission_required", "rejected"];
export const VERIFICATION_PENDING_REVIEW = "pending,under_review";
export const ACCOUNT_STATUSES = ["active", "suspended", "banned", "deactivated"];
export const AGE_BRACKETS = ["15-17", "18-24", "25-30", "31+"];
export const WORK_NATURES = ["remote", "onsite", "hybrid"];

// Which filter controls each section shows (mirrors server SECTION_FIELDS).
export const SECTION_FIELDS = Object.freeze({
  jobs: ["municipality", "industry", "jobType", "workNature", "jobStatus", "dataset", "scope"],
  employers: ["municipality", "industry", "verification", "accountStatus", "scope"],
  applicants: ["municipality", "ageBracket", "accountStatus", "applicationStatus", "dateField", "dataset"],
});

const FILTER_KEYS = [
  "municipality", "industry", "jobType", "workNature", "jobStatus", "verification",
  "accountStatus", "ageBracket", "applicationStatus", "dateField", "dataset", "scope",
];

// Today's civil date in Asia/Manila, the same zone the server uses for periods.
export function manilaToday(now = new Date()) {
  const parts = {};
  for (const part of new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now)) {
    parts[part.type] = part.value;
  }
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

export const defaultState = (now = new Date()) => {
  const today = manilaToday(now);
  return {
    section: "jobs",
    period: "year",
    year: String(today.year),
    quarter: String(Math.floor((today.month - 1) / 3) + 1),
    month: String(today.month),
    from: "",
    to: "",
    municipality: "",
    industry: "",
    jobType: "",
    workNature: "",
    jobStatus: "",
    verification: "",
    accountStatus: "",
    ageBracket: "",
    applicationStatus: "",
    dateField: "applied",
    dataset: "regular",
    scope: "all",
  };
};

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const text = (value, max = 80) => String(value || "").trim().slice(0, max);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const parseVerification = (value) => {
  const wanted = String(value || "").split(",").map((part) => part.trim()).filter(Boolean);
  const known = VERIFICATION_OPTIONS.filter((option) => wanted.includes(option));
  if (known.length === 1) return known[0];
  if (known.length === 2 && known.join(",") === VERIFICATION_PENDING_REVIEW) return VERIFICATION_PENDING_REVIEW;
  return "";
};

// Filters this section shows; every other filter is reset to its default.
export const visibleFilters = (state) => {
  const shown = new Set(SECTION_FIELDS[state.section] || []);
  const base = defaultState();
  const out = { ...state };
  for (const key of FILTER_KEYS) if (!shown.has(key)) out[key] = base[key];
  // SPES postings belong to the office: no catalog filters.
  if (out.dataset === "spes") {
    out.industry = "";
    out.jobType = "";
    out.workNature = "";
  }
  // The application status only exists for applications, not registrations.
  if (out.section === "applicants" && out.dateField === "registered") out.applicationStatus = "";
  return out;
};

export function parseFilterState(searchParams, now = new Date()) {
  const base = defaultState(now);
  const get = (key) => searchParams.get(key) || "";
  const section = pick(get("section"), SECTIONS, base.section);
  const period = pick(get("period"), PERIOD_TYPES, base.period);
  const int = (key, min, max, fallback) => {
    const value = parseInt(get(key), 10);
    return Number.isInteger(value) && value >= min && value <= max ? String(value) : fallback;
  };
  const state = {
    ...base,
    section,
    period,
    year: int("year", 2000, 9999, base.year),
    quarter: int("quarter", 1, 4, base.quarter),
    month: int("month", 1, 12, base.month),
    from: DATE.test(get("from")) ? get("from") : "",
    to: DATE.test(get("to")) ? get("to") : "",
    municipality: text(get("municipality")),
    industry: text(get("industry")),
    jobType: text(get("jobType")),
    workNature: pick(get("workNature"), WORK_NATURES, ""),
    jobStatus: pick(get("jobStatus"), JOB_STATUSES, ""),
    verification: parseVerification(get("verification")),
    accountStatus: pick(get("accountStatus"), ACCOUNT_STATUSES, ""),
    ageBracket: pick(get("ageBracket"), AGE_BRACKETS, ""),
    applicationStatus: pick(get("applicationStatus"), APPLICATION_STATUSES, ""),
    dateField: pick(get("dateField"), ["applied", "registered"], base.dateField),
    dataset: pick(get("dataset"), ["regular", "spes"], base.dataset),
    scope: pick(get("scope"), ["all", "public"], base.scope),
  };
  return visibleFilters(state);
}

// Only values that differ from the defaults are written, so a clean URL means "defaults".
export function serializeFilterState(input, now = new Date()) {
  const base = defaultState(now);
  const state = visibleFilters({ ...base, ...input });
  const params = new URLSearchParams();
  if (state.section !== base.section) params.set("section", state.section);
  if (state.period !== base.period) params.set("period", state.period);
  if (state.period !== "custom") {
    if (state.year !== base.year) params.set("year", state.year);
    if (state.period === "quarter" && state.quarter !== base.quarter) params.set("quarter", state.quarter);
    if (state.period === "month" && state.month !== base.month) params.set("month", state.month);
  } else {
    if (state.from) params.set("from", state.from);
    if (state.to) params.set("to", state.to);
  }
  for (const key of FILTER_KEYS) if (state[key] !== base[key] && state[key]) params.set(key, state[key]);
  return params;
}

export function isCanonicalFilterQuery(searchParams, now = new Date()) {
  const normalise = (params) => [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("&");
  return normalise(searchParams) === normalise(serializeFilterState(parseFilterState(searchParams, now), now));
}

// Query for GET /admin/analytics/summary. A custom period with a missing end is not sent
// as custom (the bar shows the hint instead), so the request is always valid.
export function toApiParams(input, now = new Date()) {
  const state = visibleFilters({ ...defaultState(now), ...input });
  const params = { section: state.section, period: state.period };
  if (state.period === "custom") {
    params.from = state.from;
    params.to = state.to;
  } else {
    params.year = state.year;
    if (state.period === "quarter") params.quarter = state.quarter;
    if (state.period === "month") params.month = state.month;
  }
  for (const key of SECTION_FIELDS[state.section]) if (state[key]) params[key] = state[key];
  return params;
}

export const isPeriodReady = (state) => state.period !== "custom" || Boolean(state.from && state.to && state.from <= state.to);

// Filters other than the period; these are what "Clear filters" resets.
export function activeFilterKeys(input, now = new Date()) {
  const base = defaultState(now);
  const state = visibleFilters({ ...base, ...input });
  return FILTER_KEYS.filter((key) => state[key] && state[key] !== base[key]);
}

export const hasActiveFilters = (state, now) => activeFilterKeys(state, now).length > 0;

export function clearedState(state, now = new Date()) {
  const base = defaultState(now);
  const next = { ...state };
  for (const key of FILTER_KEYS) next[key] = base[key];
  return next;
}

// Shared filters (period, municipality, dataset) survive a section switch; the rest are shed
// by visibleFilters when the URL is written.
export const switchSection = (state, section) => ({ ...state, section });
