import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, paginateList, parsePage, parsePageSize, reconcilePage } from "../utils/pagination";

// Client-side pagination for a list that is already in memory.
//
//   const pager = usePagination(filteredItems, { resetKey: `${filter}|${query}` });
//   pager.pageItems  -> the slice to render
//   <Pagination {...pager.paginationProps} />
//
// - resetKey: change it when a filter, the search or the sort changes; the list returns to page 1.
// - urlSync: keep page and pageSize in the query string (for pages that already sync filters there).
// - The page is clamped, so a list that shrinks never leaves you on an empty page.
export default function usePagination(items, { pageSize: initialSize = DEFAULT_PAGE_SIZE, pageSizes = PAGE_SIZES, resetKey = "", urlSync = false } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState({ page: 1, pageSize: initialSize, key: resetKey });

  const page = urlSync ? parsePage(searchParams.get("page")) : state.page;
  const pageSize = urlSync ? parsePageSize(searchParams.get("pageSize"), pageSizes, initialSize) : state.pageSize;

  // Adjusting state while rendering (no effect): a new resetKey means back to page 1.
  if (!urlSync && state.key !== resetKey) {
    setState((prev) => ({ ...prev, page: reconcilePage({ page: prev.page, resetKey, prevKey: prev.key }), key: resetKey }));
  }

  // URL mode: a new resetKey drops ?page (not on the first render, so a refresh keeps the page).
  const lastKey = useRef(resetKey);
  useEffect(() => {
    if (!urlSync || lastKey.current === resetKey) return;
    lastKey.current = resetKey;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("page");
        return next;
      },
      { replace: true }
    );
  }, [urlSync, resetKey, setSearchParams]);

  const setUrl = useCallback(
    (patch) =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          Object.entries(patch).forEach(([key, value]) => {
            const drop = (key === "page" && value === 1) || (key === "pageSize" && value === initialSize);
            if (drop) next.delete(key);
            else next.set(key, String(value));
          });
          return next;
        },
        { replace: false }
      ),
    [setSearchParams, initialSize]
  );

  const slice = useMemo(() => paginateList(items, page, pageSize), [items, page, pageSize]);

  const setPage = useCallback(
    (next) => (urlSync ? setUrl({ page: next }) : setState((prev) => ({ ...prev, page: next }))),
    [urlSync, setUrl]
  );
  const setPageSize = useCallback(
    (size) => (urlSync ? setUrl({ pageSize: size, page: 1 }) : setState((prev) => ({ ...prev, pageSize: size, page: 1 }))),
    [urlSync, setUrl]
  );

  return {
    ...slice,
    pageSize,
    setPage,
    setPageSize,
    paginationProps: {
      total: slice.total,
      page: slice.page,
      pageSize,
      pageSizes,
      onPageChange: setPage,
      onPageSizeChange: setPageSize,
    },
  };
}
