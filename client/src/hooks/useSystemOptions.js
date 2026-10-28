import { useEffect, useState } from "react";
import { systemOptionsAPI } from "../services/api";

// Module-scope cache — fetched once per category per page session, shared by
// every component using the same category (item 11: admin-maintainable
// industry/jobType/governmentIdType catalogs, markdowns/
// MOCK_DEFENSE_REVISION_STATUS.md). Already sorted by the server (order,
// then value) to match the alphabetization already done for these lists.
const cache = new Map(); // category -> { values: string[], configured: boolean }
const inflight = new Map(); // category -> Promise<{ values, configured }>

function fetchCategory(category) {
  if (cache.has(category)) return Promise.resolve(cache.get(category));
  if (inflight.has(category)) return inflight.get(category);

  const promise = systemOptionsAPI
    .list(category)
    .then(({ data }) => {
      const values = Array.isArray(data?.options) ? data.options.map((o) => o.value) : [];
      // An unseeded catalog responds with no rows. Keep the established list
      // available until the catalog is seeded. A configured catalog with all
      // options disabled must stay empty, so retired values do not reappear.
      const result = { values, configured: data?.configured === true || values.length > 0 };
      cache.set(category, result);
      inflight.delete(category);
      return result;
    })
    .catch((err) => {
      inflight.delete(category);
      throw err;
    });
  inflight.set(category, promise);
  return promise;
}

/**
 * Live, admin-maintainable option list for one SystemOption category
 * ("industry" | "jobType" | "governmentIdType"). `fallback` renders while the
 * first fetch is in flight (or if it fails) so a dropdown is never empty on
 * first paint — pass the old hardcoded constant array for a seamless
 * transition. `extra` appends values this category doesn't manage itself
 * (e.g. the legacy "Remote" jobType), re-sorted alphabetically alongside it.
 */
export function useSystemOptions(category, { fallback = [], extra = [] } = {}) {
  const [state, setState] = useState(() => ({ category, catalog: cache.get(category) || null, error: false }));
  const catalog = state.category === category ? state.catalog : cache.get(category) || null;
  const error = state.category === category && state.error;
  const loading = catalog === null && !error;

  useEffect(() => {
    let cancelled = false;
    if (cache.has(category)) return undefined;
    fetchCategory(category)
      .then((result) => {
        if (!cancelled) {
          setState({ category, catalog: result, error: false });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ category, catalog: null, error: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [category]);

  const resolved = catalog === null || (catalog.values.length === 0 && !catalog.configured)
    ? fallback
    : catalog.values;
  const combined = extra.length ? [...resolved, ...extra].sort((a, b) => a.localeCompare(b)) : resolved;

  return { options: combined, loading, error };
}
