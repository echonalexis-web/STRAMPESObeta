// Directory filters <-> URL query string <-> API params, in one place so the
// page, the reload and the CSV export all agree.

export const PAGE_SIZE = 20;
export const MOBILE_PAGE_SIZE = 4;
export const STATUS_OPTIONS = ["active", "suspended", "banned", "deactivated", "deleted"];
export const VERIFICATION_OPTIONS = ["unverified", "pending", "under_review", "verified", "resubmission_required", "rejected"];

// "Pending review" is pending plus under review: one value, written as a list
// in the URL and the API (the server accepts a comma-separated list).
export const VERIFICATION_PENDING_REVIEW = "pending,under_review";

// The merged "Sort by" select. Each choice maps to the sort and order params
// the URL and the API already use, so links and exports keep working.
export const SORT_CHOICES = ["newest", "oldest", "nameAsc", "nameDesc", "recent", "leastRecent"];
export const SORT_CHOICE_PARAMS = Object.freeze({
  newest: { sort: "joined", order: "" },
  oldest: { sort: "joined", order: "asc" },
  nameAsc: { sort: "name", order: "" },
  nameDesc: { sort: "name", order: "desc" },
  recent: { sort: "lastActive", order: "" },
  leastRecent: { sort: "lastActive", order: "asc" },
});
const SORT_KEYS = ["joined", "lastActive", "name"];

// Toggle chips per tab. Lockout applies to jobseekers only and every employer
// has an email, so those two chips do not exist on the Employers tab.
export const CHIPS_BY_TAB = Object.freeze({
  employers: ["pendingReview", "idle90"],
  jobseekers: ["noEmail", "idle90", "lockedNow"],
});

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

// One status, or exactly the pending-review pair. Anything else is dropped.
const parseVerification = (value) => {
  const wanted = String(value || "").split(",").map((part) => part.trim()).filter(Boolean);
  const known = VERIFICATION_OPTIONS.filter((option) => wanted.includes(option));
  if (known.length === 1) return known[0];
  if (known.length === 2 && known.join(",") === VERIFICATION_PENDING_REVIEW) return VERIFICATION_PENDING_REVIEW;
  return "";
};

export function parseDirectoryState(searchParams) {
  const get = (key) => searchParams.get(key) || "";
  const page = parseInt(get("page"), 10);
  const tab = get("tab") === "jobseekers" ? "jobseekers" : "employers";
  const jobseekers = tab === "jobseekers";
  return {
    tab,
    q: get("q").slice(0, 100),
    status: pick(get("status"), STATUS_OPTIONS, ""),
    // A param whose control is not on this tab is ignored, so a filter you
    // cannot see can never be hiding rows.
    verification: jobseekers ? "" : parseVerification(get("verification")),
    noEmail: jobseekers && get("noEmail") === "1",
    idle90: get("idle90") === "1",
    lockedNow: jobseekers && get("lockedNow") === "1",
    sort: pick(get("sort"), SORT_KEYS, "joined"),
    order: pick(get("order"), ["asc", "desc"], ""),
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

// Only values that differ from the defaults are written, so a clean URL means
// "no filters".
export function serializeDirectoryState(state) {
  const params = new URLSearchParams();
  const s = { ...DEFAULT_STATE, ...state };
  const jobseekers = s.tab === "jobseekers";
  if (s.tab !== DEFAULT_STATE.tab) params.set("tab", s.tab);
  if (s.q.trim()) params.set("q", s.q.trim());
  if (s.status) params.set("status", s.status);
  if (!jobseekers && s.verification) params.set("verification", s.verification);
  if (jobseekers && s.noEmail) params.set("noEmail", "1");
  if (s.idle90) params.set("idle90", "1");
  if (jobseekers && s.lockedNow) params.set("lockedNow", "1");
  if (s.sort !== DEFAULT_STATE.sort) params.set("sort", s.sort);
  if (s.order) params.set("order", s.order);
  if (s.page > 1) params.set("page", String(s.page));
  return params;
}

// True when the URL already is what the page would write for it. When it is not
// (a stale or hand-edited link), the page rewrites it once.
export function isCanonicalQuery(searchParams) {
  const normalise = (params) => [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("&");
  return normalise(searchParams) === normalise(serializeDirectoryState(parseDirectoryState(searchParams)));
}

// Params for GET /admin/users (and the CSV export, which ignores page/limit).
export function toApiParams(state, { withPaging = true, pageSize = PAGE_SIZE, details = false } = {}) {
  const s = { ...DEFAULT_STATE, ...state };
  const jobseekers = s.tab === "jobseekers";
  const params = { role: jobseekers ? "jobseeker" : "employer" };
  if (s.q.trim()) params.search = s.q.trim();
  if (s.status) params.status = s.status;
  if (!jobseekers && s.verification) params.verificationStatus = s.verification;
  if (jobseekers && s.noEmail) params.noEmail = "true";
  if (s.idle90) params.idle90 = "true";
  if (jobseekers && s.lockedNow) params.lockedNow = "true";
  if (s.sort !== DEFAULT_STATE.sort) params.sort = s.sort;
  if (s.order) params.order = s.order;
  if (withPaging) {
    params.page = s.page;
    params.limit = pageSize;
  }
  if (details) params.details = "true";
  return params;
}

// The state as this tab sees it: a filter whose control is not on the tab does
// not count (and is never sent), however the state was built.
const forTab = (state) => {
  const s = { ...DEFAULT_STATE, ...state };
  const jobseekers = s.tab === "jobseekers";
  return {
    ...s,
    verification: jobseekers ? "" : s.verification,
    noEmail: jobseekers && s.noEmail,
    lockedNow: jobseekers && s.lockedNow,
  };
};

export function hasActiveFilters(state) {
  const s = forTab(state);
  return Boolean(s.q.trim() || s.status || s.verification || s.noEmail || s.idle90 || s.lockedNow);
}

// Filters inside the collapsible panel on a phone (the search box is outside it).
export function activeFilterCount(state) {
  const s = forTab(state);
  return [s.status, s.verification, s.noEmail, s.idle90, s.lockedNow].filter(Boolean).length;
}

// ---- merged sort select ------------------------------------------------

export function sortChoiceOf(state) {
  const s = { ...DEFAULT_STATE, ...state };
  // The default order is newest first for dates and A to Z for names.
  const effective = (sort, order) => order || (sort === "name" ? "asc" : "desc");
  const order = effective(s.sort, s.order);
  for (const choice of SORT_CHOICES) {
    const params = SORT_CHOICE_PARAMS[choice];
    if (params.sort === s.sort && effective(params.sort, params.order) === order) return choice;
  }
  return "newest";
}

export function sortPatchFor(choice) {
  return { ...(SORT_CHOICE_PARAMS[choice] || SORT_CHOICE_PARAMS.newest) };
}

// ---- chips ---------------------------------------------------------------

export function isChipActive(state, chip) {
  const s = forTab(state);
  if (chip === "pendingReview") return s.verification === VERIFICATION_PENDING_REVIEW;
  return Boolean(s[chip]);
}

// The patch a chip click applies (pressing an active chip turns it off).
export function chipPatch(state, chip) {
  const active = isChipActive(state, chip);
  if (chip === "pendingReview") return { verification: active ? "" : VERIFICATION_PENDING_REVIEW };
  return { [chip]: !active };
}

export const CLEAR_PATCH = Object.freeze({
  q: "",
  status: "",
  verification: "",
  noEmail: false,
  idle90: false,
  lockedNow: false,
});
