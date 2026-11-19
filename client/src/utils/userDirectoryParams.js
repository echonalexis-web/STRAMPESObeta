// Directory filters <-> URL query string <-> API params, in one place so the
// page, the reload and the CSV export all agree.

export const PAGE_SIZE = 20;
export const STATUS_OPTIONS = ["active", "suspended", "banned", "deactivated", "deleted"];
export const VERIFICATION_OPTIONS = ["unverified", "pending", "under_review", "verified", "resubmission_required", "rejected"];
export const SORT_OPTIONS = ["joined", "lastActive", "name"];

export const DEFAULT_STATE = Object.freeze({
  tab: "employers",
  q: "",
  status: "",
  verification: "",
  noEmail: false,
  idle90: false,
  lockedNow: false,
  sort: "joined",
  order: "",
  page: 1,
});

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

export function parseDirectoryState(searchParams) {
  const get = (key) => searchParams.get(key) || "";
  const page = parseInt(get("page"), 10);
  return {
    tab: get("tab") === "jobseekers" ? "jobseekers" : "employers",
    q: get("q").slice(0, 100),
    status: pick(get("status"), STATUS_OPTIONS, ""),
    verification: pick(get("verification"), VERIFICATION_OPTIONS, ""),
    noEmail: get("noEmail") === "1",
    idle90: get("idle90") === "1",
    lockedNow: get("lockedNow") === "1",
    sort: pick(get("sort"), SORT_OPTIONS, "joined"),
    order: pick(get("order"), ["asc", "desc"], ""),
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

// Only values that differ from the defaults are written, so a clean URL means
// "no filters".
export function serializeDirectoryState(state) {
  const params = new URLSearchParams();
  const s = { ...DEFAULT_STATE, ...state };
  if (s.tab !== DEFAULT_STATE.tab) params.set("tab", s.tab);
  if (s.q.trim()) params.set("q", s.q.trim());
  if (s.status) params.set("status", s.status);
  if (s.tab === "employers" && s.verification) params.set("verification", s.verification);
  if (s.noEmail) params.set("noEmail", "1");
  if (s.idle90) params.set("idle90", "1");
  if (s.lockedNow) params.set("lockedNow", "1");
  if (s.sort !== DEFAULT_STATE.sort) params.set("sort", s.sort);
  if (s.order) params.set("order", s.order);
  if (s.page > 1) params.set("page", String(s.page));
  return params;
}

// Params for GET /admin/users (and the CSV export, which ignores page/limit).
export function toApiParams(state, { withPaging = true } = {}) {
  const s = { ...DEFAULT_STATE, ...state };
  const params = { role: s.tab === "jobseekers" ? "jobseeker" : "employer" };
  if (s.q.trim()) params.search = s.q.trim();
  if (s.status) params.status = s.status;
  if (s.tab === "employers" && s.verification) params.verificationStatus = s.verification;
  if (s.noEmail) params.noEmail = "true";
  if (s.idle90) params.idle90 = "true";
  if (s.lockedNow) params.lockedNow = "true";
  if (s.sort !== DEFAULT_STATE.sort) params.sort = s.sort;
  if (s.order) params.order = s.order;
  if (withPaging) {
    params.page = s.page;
    params.limit = PAGE_SIZE;
  }
  return params;
}

export function hasActiveFilters(state) {
  const s = { ...DEFAULT_STATE, ...state };
  return Boolean(s.q.trim() || s.status || s.verification || s.noEmail || s.idle90 || s.lockedNow);
}
