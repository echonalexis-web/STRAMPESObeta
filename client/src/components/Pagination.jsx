import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ELLIPSIS, PAGE_SIZES, getPageItems } from "../utils/pagination";
import "../styles/pagination.css";

// Generic table pagination: rows per page, a "showing x to y of z" summary, Previous and
// Next, and numbered pages with ellipses. Controlled: the parent owns page and pageSize
// (the SPES Monitoring page keeps them in the URL).
//
//   <Pagination page={2} totalPages={5} pageSize={10} total={47} summary="Showing 11 to 20 of 47"
//     onPageChange={...} onPageSizeChange={...} />
export default function Pagination({
  page,
  totalPages,
  pageSize,
  pageSizes = PAGE_SIZES,
  summary,
  disabled = false,
  onPageChange,
  onPageSizeChange,
  idPrefix = "pager",
}) {
  const { t } = useTranslation();
  const items = getPageItems(page, totalPages);
  const first = page <= 1;
  const last = page >= totalPages;

  return (
    <div className="pager">
      <label className="pager__size" htmlFor={`${idPrefix}-size`}>
        <span>{t("pagination.rowsPerPage")}</span>
        <select
          id={`${idPrefix}-size`}
          value={pageSize}
          disabled={disabled}
          onChange={(event) => onPageSizeChange?.(Number(event.target.value))}
        >
          {pageSizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>

      {summary ? <p className="pager__summary">{summary}</p> : null}

      <nav className="pager__nav" aria-label={t("pagination.label")}>
        <button type="button" className="pager__btn pager__btn--step" disabled={disabled || first} onClick={() => onPageChange?.(page - 1)}>
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
                  className={`pager__btn pager__btn--page${item === page ? " is-current" : ""}`}
                  aria-current={item === page ? "page" : undefined}
                  aria-label={t("pagination.page", { page: item })}
                  disabled={disabled}
                  onClick={() => (item === page ? undefined : onPageChange?.(item))}
                >
                  {item}
                </button>
              </li>
            )
          )}
        </ul>

        <button type="button" className="pager__btn pager__btn--step" disabled={disabled || last} onClick={() => onPageChange?.(page + 1)}>
          <span className="pager__step-text">{t("pagination.next")}</span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </nav>
    </div>
  );
}
