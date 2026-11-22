// Pure helpers for the Home page jobs carousel (no React, no DOM), so they are unit-testable.

// How many newest jobs the carousel shows; a "See more" card follows when there are more.
export const HOME_JOBS_LIMIT = 4;

// Employer name: company name, then business name (the server already falls back to the
// business name for the public list), then a neutral label. Never the bare word "Employer".
export const employerName = (job, neutral = "") => {
  const emp = job?.employer;
  const company = String(emp?.companyName ?? "").trim();
  const business = String(emp?.tradeName ?? "").trim();
  return company || business || neutral;
};

// Poster-friendly relative date, like the other job cards.
export const postedAgo = (date, now = Date.now()) => {
  if (!date) return null;
  const then = new Date(date).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((now - then) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
};

// Salary as posted ("PHP 20,000", "15000"), or null when none was posted.
export const salaryAsPosted = (salary) => {
  const text = String(salary ?? "").trim();
  if (!text) return null;
  return /^\s*(₱|php)/i.test(text) ? text : `₱${text}`;
};

// Where the first part (usually the barangay) is dropped when the address is long.
export const locationLine = (address) => {
  const text = String(address ?? "").trim();
  if (!text) return "";
  const parts = text.split(", ").filter(Boolean);
  return parts.length > 2 ? parts.slice(1).join(", ") : text;
};

// What the carousel shows for a response: the newest jobs, and how many more there are.
// `total` is every publicly available job (the server's pagination total).
export const carouselModel = (jobs, total) => {
  const list = Array.isArray(jobs) ? jobs.slice(0, HOME_JOBS_LIMIT) : [];
  const count = Math.max(Number(total) || 0, list.length);
  const hasMore = count > HOME_JOBS_LIMIT;
  return {
    jobs: list,
    total: count,
    hasMore,
    moreCount: hasMore ? count - HOME_JOBS_LIMIT : 0,
    slideCount: list.length + (hasMore ? 1 : 0),
  };
};

// Position of the visible window, as 1-based slide numbers, from the scroller's metrics.
export const visibleRange = ({ scrollLeft = 0, clientWidth = 0, step = 0, slideCount = 0 }) => {
  if (!slideCount || !step) return { from: slideCount ? 1 : 0, to: slideCount };
  const first = Math.min(slideCount - 1, Math.max(0, Math.round(scrollLeft / step)));
  const visible = Math.max(1, Math.floor((clientWidth + 1) / step) || 1);
  return { from: first + 1, to: Math.min(slideCount, first + visible) };
};

// Whether each arrow can still move, with a 1px tolerance for sub-pixel scrolling.
export const arrowState = ({ scrollLeft = 0, clientWidth = 0, scrollWidth = 0 }) => ({
  canPrev: scrollLeft > 1,
  canNext: scrollLeft + clientWidth < scrollWidth - 1,
});
