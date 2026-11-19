// Pure helpers behind Browse Jobs live filtering and search suggestions.
import { normalizeIndustries } from "./industrySelection.js";
import { salaryValue } from "./salaryRange.js";

export const TYPED_DEBOUNCE_MS = 300;
export const SUGGEST_DEBOUNCE_MS = 250;
export const SUGGEST_MIN_CHARS = 2;

/* ─── URL <-> filters ─── */

// Only set filters are written, so a clean board has a clean URL.
export const serializeFilters = (filters = {}, page = 1) => {
  const params = new URLSearchParams();
  const q = String(filters.q || "").trim();
  if (q) params.set("q", q);
  const location = String(filters.location || "").trim();
  if (location) params.set("location", location);
  if (filters.jobType) params.set("jobType", filters.jobType);
  if (filters.sortBy) params.set("sortBy", filters.sortBy);
  normalizeIndustries(filters.industry).forEach((industry) => params.append("industry", industry));
  const min = salaryValue(filters.salaryMin);
  const max = salaryValue(filters.salaryMax);
  if (min) params.set("salaryMin", min);
  if (max) params.set("salaryMax", max);
  if (filters.onlyMeetsRequired === true || filters.onlyMeetsRequired === "true") {
    params.set("onlyMeetsRequired", "true");
  }
  if (Number(page) > 1) params.set("page", String(Math.floor(Number(page))));
  return params;
};

export const parseFilters = (searchParams) => {
  const params = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams || "");
  const filters = {};
  const q = params.get("q");
  if (q) filters.q = q;
  const location = params.get("location");
  if (location) filters.location = location;
  const jobType = params.get("jobType");
  if (jobType) filters.jobType = jobType;
  const sortBy = params.get("sortBy");
  if (sortBy) filters.sortBy = sortBy;
  const industry = params.getAll("industry").filter(Boolean);
  if (industry.length) filters.industry = industry;
  const min = salaryValue(params.get("salaryMin"));
  const max = salaryValue(params.get("salaryMax"));
  if (min) filters.salaryMin = min;
  if (max) filters.salaryMax = max;
  if (params.get("onlyMeetsRequired") === "true") filters.onlyMeetsRequired = true;
  const page = Math.floor(Number(params.get("page")));
  return { filters, page: Number.isFinite(page) && page > 1 ? page : 1 };
};

/* ─── Timing ─── */

// One pending callback at a time; scheduling again replaces it.
export const createDebouncer = (delay = TYPED_DEBOUNCE_MS) => {
  let timer = null;
  return {
    schedule(fn) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, delay);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
    pending: () => timer !== null,
  };
};

// Starting a request aborts the previous one; isCurrent() is false for any
// request that a newer one has superseded, so out-of-order responses are ignored.
export const createRequestGate = () => {
  let controller = null;
  return {
    begin() {
      if (controller) controller.abort();
      const mine = new AbortController();
      controller = mine;
      return { signal: mine.signal, isCurrent: () => controller === mine };
    },
    abort() {
      if (controller) controller.abort();
      controller = null;
    },
  };
};

/* ─── Suggestions ─── */

// Splits text into [{ text, match }] around case-insensitive matches of query.
export const highlightParts = (text, query) => {
  const value = String(text ?? "");
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return [{ text: value, match: false }];
  const lower = value.toLowerCase();
  const parts = [];
  let from = 0;
  let at = lower.indexOf(needle, from);
  while (at !== -1) {
    if (at > from) parts.push({ text: value.slice(from, at), match: false });
    parts.push({ text: value.slice(at, at + needle.length), match: true });
    from = at + needle.length;
    at = lower.indexOf(needle, from);
  }
  if (from < value.length) parts.push({ text: value.slice(from), match: false });
  return parts;
};

// Next highlighted option for ArrowDown / ArrowUp; -1 means "none" (back in the input).
export const nextActiveIndex = (index, count, key) => {
  if (!count) return -1;
  if (key === "ArrowDown") return index >= count - 1 ? 0 : index + 1;
  if (key === "ArrowUp") return index <= 0 ? count - 1 : index - 1;
  return index;
};
