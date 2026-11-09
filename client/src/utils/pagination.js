// Generic pagination helpers (no React): URL parameter parsing, page ranges and the numbered
// page list with ellipses. Used by components/Pagination.jsx and the admin SPES Monitoring table.

export const ELLIPSIS = "ellipsis";
export const PAGE_SIZES = [10, 25, 50];
export const DEFAULT_PAGE_SIZE = 10;

// A positive integer from a query-string value, or the fallback.
export const parsePage = (value, fallback = 1) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
};

export const parsePageSize = (value, allowed = PAGE_SIZES, fallback = DEFAULT_PAGE_SIZE) => {
  const n = Number.parseInt(value, 10);
  return allowed.includes(n) ? n : fallback;
};

export const totalPagesFor = (total, pageSize) => Math.max(Math.ceil(Math.max(total, 0) / Math.max(pageSize, 1)), 1);

// Keeps a page number inside 1..totalPages (used after filtering or when data shrinks).
export const clampPage = (page, totalPages) => Math.min(Math.max(parsePage(page, 1), 1), Math.max(totalPages, 1));

// "Showing from to of total": both bounds are 0 when there is nothing to show.
export const pageRange = (page, pageSize, total) => {
  if (!total || total < 1) return { from: 0, to: 0 };
  const from = (page - 1) * pageSize + 1;
  return { from: Math.min(from, total), to: Math.min(page * pageSize, total) };
};

const range = (start, end) => Array.from({ length: end - start + 1 }, (_, i) => start + i);

// Page numbers to show: always the first and last, the current page with `siblings` on each
// side, and an ellipsis marker where pages are skipped. Few pages are all listed.
export const getPageItems = (current, totalPages, siblings = 1) => {
  const slots = siblings * 2 + 5;
  if (totalPages <= slots) return range(1, totalPages);

  const left = Math.max(current - siblings, 1);
  const right = Math.min(current + siblings, totalPages);
  const showLeft = left > 2;
  const showRight = right < totalPages - 1;

  if (!showLeft && showRight) return [...range(1, 3 + siblings * 2), ELLIPSIS, totalPages];
  if (showLeft && !showRight) return [1, ELLIPSIS, ...range(totalPages - (2 + siblings * 2), totalPages)];
  return [1, ELLIPSIS, ...range(left, right), ELLIPSIS, totalPages];
};
