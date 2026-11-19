import { useTranslation } from "react-i18next";
import { Download, SlidersHorizontal } from "lucide-react";
import {
  CHIPS_BY_TAB,
  SORT_CHOICES,
  STATUS_OPTIONS,
  VERIFICATION_OPTIONS,
  VERIFICATION_PENDING_REVIEW,
  activeFilterCount,
  chipPatch,
  isChipActive,
  sortChoiceOf,
  sortPatchFor,
} from "../utils/userDirectoryParams";

// Search, Status, Verification (employers only), Sort by, the toggle chips and
// Export. One shared control style (styles/user-management.css). On a phone only
// the search box stays in view; a Filters button reveals the rest.
//
// `counts` is the server's per-tab count for each chip, for example
// { pendingReview: 4, idle90: 11 }; a missing number just hides the count.
export default function UserDirectoryToolbar({
  state,
  searchText,
  onSearchChange,
  updateState,
  counts,
  lockouts,
  isMobile,
  filtersOpen,
  onFiltersOpenChange,
  onExport,
  exporting,
}) {
  const { t } = useTranslation();
  const chips = CHIPS_BY_TAB[state.tab] || [];
  const employers = state.tab === "employers";
  const activeCount = activeFilterCount(state);
  const panelOpen = !isMobile || filtersOpen;

  return (
    <form className="um-toolbar" role="search" aria-label={t("superadmin.users.filters.label")} onSubmit={(event) => event.preventDefault()}>
      <div className="um-field um-field--search">
        <label htmlFor="um-search">{t("superadmin.users.filters.search")}</label>
        <input
          id="um-search"
          type="search"
          value={searchText}
          maxLength={100}
          placeholder={t("superadmin.users.filters.searchPlaceholder")}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>

      {isMobile ? (
        <button
          type="button"
          className="um-filters-toggle"
          aria-expanded={filtersOpen}
          aria-controls="um-filter-panel"
          aria-label={activeCount > 0 ? t("superadmin.users.filters.toggleActive", { count: activeCount }) : undefined}
          onClick={() => onFiltersOpenChange(!filtersOpen)}
        >
          <SlidersHorizontal size={18} aria-hidden="true" />
          <span>{t("superadmin.users.filters.toggle")}</span>
          {activeCount > 0 ? (
            <span className="um-filters-toggle__count" aria-hidden="true">{activeCount}</span>
          ) : null}
        </button>
      ) : null}

      {panelOpen ? (
        <div className="um-panel" id="um-filter-panel">
          <div className="um-field">
            <label htmlFor="um-status">{t("superadmin.users.filters.status")}</label>
            <select id="um-status" value={state.status} onChange={(event) => updateState({ status: event.target.value })}>
              <option value="">{t("superadmin.users.filters.statusAll")}</option>
              {STATUS_OPTIONS.map((key) => (
                <option key={key} value={key}>{t(`superadmin.users.status.${key}`)}</option>
              ))}
            </select>
          </div>

          {employers ? (
            <div className="um-field">
              <label htmlFor="um-verification">{t("superadmin.users.filters.verification")}</label>
              <select id="um-verification" value={state.verification} onChange={(event) => updateState({ verification: event.target.value })}>
                <option value="">{t("superadmin.users.filters.verificationAll")}</option>
                <option value={VERIFICATION_PENDING_REVIEW}>{t("superadmin.users.filters.verificationOptions.pendingReview")}</option>
                {VERIFICATION_OPTIONS.map((key) => (
                  <option key={key} value={key}>{t(`superadmin.users.filters.verificationOptions.${key}`)}</option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="um-field">
            <label htmlFor="um-sort">{t("superadmin.users.filters.sort")}</label>
            <select
              id="um-sort"
              value={sortChoiceOf(state)}
              onChange={(event) => updateState(sortPatchFor(event.target.value))}
            >
              {SORT_CHOICES.map((choice) => (
                <option key={choice} value={choice}>{t(`superadmin.users.filters.sortChoices.${choice}`)}</option>
              ))}
            </select>
          </div>

          <div className="um-chiprow">
            <div className="um-chips" role="group" aria-label={t("superadmin.users.filters.chipsLabel")}>
              {chips.map((chip) => {
                const active = isChipActive(state, chip);
                const count = counts && Number.isFinite(counts[chip]) ? counts[chip] : null;
                return (
                  <button
                    key={chip}
                    type="button"
                    className="um-chip"
                    aria-pressed={active}
                    onClick={() => updateState(chipPatch(state, chip))}
                  >
                    <span>{t(`superadmin.users.filters.chips.${chip}`)}</span>
                    {count !== null ? <span className="um-chip__count">({count})</span> : null}
                  </button>
                );
              })}
            </div>

            {lockouts ? (
              <p className="um-lockouts">
                {t("superadmin.users.lockoutLine", { day: lockouts.locksLast24h, week: lockouts.locksLast7d })}
              </p>
            ) : null}

            <button type="button" className="um-btn um-btn--export" onClick={onExport} disabled={exporting} aria-describedby="um-export-hint">
              <Download size={16} aria-hidden="true" />
              <span>{exporting ? t("superadmin.users.export.exporting") : t("superadmin.users.export.button")}</span>
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
