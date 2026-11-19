import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ELLIPSIS, PAGE_SIZES, clampPage, getPageItems, pageRange, totalPagesFor } from "../utils/pagination";
import "../styles/pagination.css";

// Shared pagination for every list and table. Controlled: the parent owns page and pageSize
// (client-side lists use hooks/usePagination; server-side lists keep them in state or the URL).
//
// It always renders, including with one page, no results, and while loading: the summary
// ("Showing 1 to 7 of 7" or "No results"), Previous and Next (disabled when unusable), the
// current page as a selected button, and the rows-per-page selector. Under 560px the numbered
// buttons collapse to "Page x of y".
//
//   <Pagination total={47} page={2} pageSize={10} onPageChange={...} onPageSizeChange={...}
//     label={t("pagination.items.applications")} scrollTargetRef={cardRef} />
export default function Pagination({
  total = 0,
  page = 1,
  pageSize = 10,
  pageSizes = PAGE_SIZES,
  onPageChange,
  onPageSizeChange,
  label = "",
  disabled = false,
  idPrefix = "pager",
  scrollTargetRef,
  variant = "inline", // "card": a standalone bar under a list (inline sits inside a table card)
  showPageSize = true, // false for a list with one fixed page size
  summaryExtra = null, // optional node shown right after the summary (for example a Clear filters button)
}) {
  const { t } = useTranslation();
  const summaryRef = useRef(null);
  const [announce, setAnnounce] = useState("");

  const totalPages = totalPagesFor(total, pageSize);
  const current = clampPage(page, totalPages);
  const { from, to } = pageRange(current, pageSize, total);
  const items = getPageItems(current, totalPages);

  const summary =
    total === 0
      ? t("pagination.noResults")
      : label
        ? t("pagination.showingWithLabel", { from, to, total, label })
        : t("pagination.showing", { from, to, total });

  // After a change: announce it, bring the list into view and put focus on the summary line.
  const afterChange = (nextPage) => {
    setAnnounce(t("pagination.pageOf", { page: nextPage, pages: totalPages }));
    requestAnimationFrame(() => {
      scrollTargetRef?.current?.scrollIntoView?.({ block: "start" });
      summaryRef.current?.focus({ preventScroll: true });
    });
  };

  const go = (next) => {
    const target = Math.min(Math.max(next, 1), totalPages);
    if (target === current) return;
    onPageChange?.(target);
    afterChange(target);
  };

  const changeSize = (size) => {
    onPageSizeChange?.(size);
    afterChange(1);
  };

  return (
    <div className={`pager${variant === "card" ? " pager--card" : ""}`}>
      {showPageSize ? (
        <label className="pager__size" htmlFor={`${idPrefix}-size`}>
          <span>{t("pagination.rowsPerPage")}</span>
          <select id={`${idPrefix}-size`} value={pageSize} disabled={disabled} onChange={(event) => changeSize(Number(event.target.value))}>
            {pageSizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <p className="pager__summary" ref={summaryRef} tabIndex={-1}>
        {summary}
      </p>
      {summaryExtra ? <div className="pager__extra">{summaryExtra}</div> : null}

      <nav className="pager__nav" aria-label={t("pagination.label")}>
        <button type="button" className="pager__btn pager__btn--step" disabled={disabled || current <= 1} onClick={() => go(current - 1)}>
          <ChevronLeft size={16} aria-hidden="true" />
          <span className="pager__step-text">{t("pagination.previous")}</span>
        </button>

        <ul className="pager__pages">
          {items.map((item, index) =>
            item === ELLIPSIS ? (
              <li key={`gap-${index}`} className="pager__gap" aria-hidden="true">
                …
              </li>
            ) : (
              <li key={item}>
                <button
                  type="button"
                  className={`pager__btn pager__btn--page${item === current ? " is-current" : ""}`}
                  aria-current={item === current ? "page" : undefined}
                  aria-label={t("pagination.page", { page: item })}
                  disabled={disabled && item !== current}
                  onClick={() => go(item)}
                >
                  {item}
                </button>
              </li>
            )
          )}
        </ul>
        <span className="pager__compact" aria-hidden="true">
          {t("pagination.pageOf", { page: current, pages: totalPages })}
        </span>

        <button type="button" className="pager__btn pager__btn--step" disabled={disabled || current >= totalPages} onClick={() => go(current + 1)}>
          <span className="pager__step-text">{t("pagination.next")}</span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </nav>

      <span className="ds-sr-only" role="status" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}
