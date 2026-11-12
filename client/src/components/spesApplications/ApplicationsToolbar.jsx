import { useTranslation } from "react-i18next";
import useSegmentedRail from "../../hooks/useSegmentedRail";
import { Search } from "lucide-react";
import { APPLICATION_FILTERS } from "../../utils/spesApplications";

export const SEARCH_THRESHOLD = 5;

// Filter chips, sort control and (with more than five applications) a search box.
export default function ApplicationsToolbar({ filter, onFilter, sort, onSort, query, onQuery, total, counts }) {
  const railRef = useSegmentedRail();
  const { t } = useTranslation();
  return (
    <div className="spes-toolbar">
      <div ref={railRef} className="spes-chips seg-rail" role="group" aria-label={t("spes.my.filterLabel")}>
        {APPLICATION_FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            className={`spes-filter${filter === key ? " is-active" : ""}`}
            aria-pressed={filter === key}
            onClick={() => onFilter(key)}
          >
            {t(`spes.my.filter.${key}`)} <span className="spes-filter__count">{counts[key]}</span>
          </button>
        ))}
      </div>

      <div className="spes-toolbar__controls">
        {total > SEARCH_THRESHOLD ? (
          <label className="spes-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              placeholder={t("spes.my.searchPlaceholder")}
              aria-label={t("spes.my.searchLabel")}
            />
          </label>
        ) : null}
        <label className="spes-sort">
          <span className="ds-sr-only">{t("spes.my.sortLabel")}</span>
          <select value={sort} onChange={(event) => onSort(event.target.value)} aria-label={t("spes.my.sortLabel")}>
            <option value="newest">{t("spes.my.sort.newest")}</option>
            <option value="oldest">{t("spes.my.sort.oldest")}</option>
          </select>
        </label>
      </div>
    </div>
  );
}
