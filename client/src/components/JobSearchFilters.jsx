import React, { useState, useEffect, useRef, useMemo, useId } from 'react';
import { useTranslation } from 'react-i18next';
import '../styles/jobSearchFilters.css';
import { FaSearch, FaSlidersH } from 'react-icons/fa';
import { useSystemOptions } from '../hooks/useSystemOptions';
import { JOB_TYPES as JOB_TYPES_FALLBACK } from '../constants/jobTypes';
import { VALID_INDUSTRIES as INDUSTRIES_FALLBACK } from '../constants/industries';
import IndustriesFilterModal from './IndustriesFilterModal';
import { normalizeIndustries } from '../utils/industrySelection';
import {
  SALARY_CHIPS,
  cleanSalaryInput,
  salaryValue,
  isSalaryRangeInvalid,
  activeSalaryChip,
  salarySummaryParts,
} from '../utils/salaryRange';
import { activeFilterKeys, clearedFilters } from '../utils/jobFilters';

const SORT_OPTIONS = [
  { value: '', key: 'best' },
  { value: 'newest', key: 'newest' },
  { value: 'salary', key: 'salary' },
];

const formatPeso = (value) => `₱${Number(value).toLocaleString('en-PH')}`;

/* ─── Flatten PH locations JSON ─── */
function flattenLocations(rawData) {
  const locations = [];
  try {
    Object.entries(rawData).forEach(([regionCode, regionData]) => {
      const regionName = regionData?.region_name || regionCode;
      const provinces = regionData?.province_list || {};
      Object.entries(provinces).forEach(([provinceName, provinceData]) => {
        const municipalities = provinceData?.municipality_list || {};
        Object.keys(municipalities).forEach((municipalityName) => {
          const city = municipalityName
            .split(' ')
            .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
            .join(' ');
          locations.push(`${city}, ${provinceName}, ${regionName}`);
        });
      });
    });
  } catch (e) {
    console.error('Error parsing PH locations:', e);
  }
  return locations;
}

/* ─── Typed salary range: Min / Max boxes plus common-range chips ─── */
function SalaryRangeSetter({ min, max, onChange, minRef }) {
  const { t } = useTranslation();
  const labelId = useId();
  const chipsLabelId = useId();
  const errorId = useId();
  const lo = salaryValue(min);
  const hi = salaryValue(max);
  const invalid = isSalaryRangeInvalid(lo, hi);
  const pressed = activeSalaryChip(lo, hi);
  const parts = salarySummaryParts(lo, hi);
  const summary = parts.kind === 'any'
    ? t('jobBoard.filters.summary.any')
    : parts.kind === 'from'
      ? t('jobBoard.filters.summary.from', { min: formatPeso(parts.min) })
      : parts.kind === 'upTo'
        ? t('jobBoard.filters.summary.upTo', { max: formatPeso(parts.max) })
        : t('jobBoard.filters.summary.between', { min: formatPeso(parts.min), max: formatPeso(parts.max) });

  const box = (value, which, ariaKey, placeholderKey, ref) => (
    <span className={`jsf-money ${invalid ? 'is-invalid' : ''}`}>
      <span className="jsf-money__sign" aria-hidden="true">₱</span>
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={7}
        className="jsf-money__input"
        placeholder={t(placeholderKey)}
        aria-label={t(ariaKey)}
        aria-invalid={invalid ? 'true' : undefined}
        aria-describedby={invalid ? errorId : undefined}
        value={value}
        onChange={(e) => onChange(
          which === 'min' ? cleanSalaryInput(e.target.value) : lo,
          which === 'max' ? cleanSalaryInput(e.target.value) : hi,
        )}
      />
    </span>
  );

  return (
    <>
      <div className="jsf-field jsf-field--salary">
        <div className="jsf-label-row">
          <span className="jsf-label" id={labelId}>{t('jobBoard.filters.salary')}</span>
          <span className="jsf-salary-summary">{summary}</span>
        </div>
        <div className="jsf-salary-boxes" role="group" aria-labelledby={labelId}>
          {box(lo, 'min', 'jobBoard.filters.minAria', 'jobBoard.filters.min', minRef)}
          <span className="jsf-salary-to">{t('jobBoard.filters.to')}</span>
          {box(hi, 'max', 'jobBoard.filters.maxAria', 'jobBoard.filters.max')}
        </div>
        {invalid && (
          <p className="ds-field__error jsf-salary-error" id={errorId} role="alert">
            {t('jobBoard.filters.salaryInvalid')}
          </p>
        )}
      </div>

      <div className="jsf-ranges" role="group" aria-labelledby={chipsLabelId}>
        <span className="jsf-ranges__label" id={chipsLabelId}>{t('jobBoard.filters.ranges.title')}</span>
        <div className="jsf-ranges__chips">
          {SALARY_CHIPS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={`jsf-chip ${pressed === chip.id ? 'is-pressed' : ''}`}
              aria-pressed={pressed === chip.id}
              onClick={() => onChange(chip.min, chip.max)}
            >
              {t(`jobBoard.filters.ranges.${chip.id}`)}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/* ─── Component ─── */
const JobSearchFilters = ({ filters = {}, onChange, onSearch, phLocationsData, preferredIndustries = [], mustHaveHiddenCount = 0 }) => {
  const { t } = useTranslation();
  // Admin-maintainable catalogs (item 11) — live from the server, with the
  // old hardcoded lists as a fallback for first paint / offline.
  const { options: JOB_TYPES } = useSystemOptions('jobType', { fallback: JOB_TYPES_FALLBACK, extra: ['Remote'] });
  const { options: INDUSTRIES } = useSystemOptions('industry', { fallback: INDUSTRIES_FALLBACK });

  const locations = useMemo(
    () => (phLocationsData ? flattenLocations(phLocationsData) : []),
    [phLocationsData]
  );

  const ids = {
    keyword: useId(),
    location: useId(),
    jobType: useId(),
    sort: useId(),
    industriesLabel: useId(),
    industriesBtn: useId(),
    panel: useId(),
  };

  const [locationQuery, setLocationQuery] = useState(filters.location || '');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const locationRef = useRef(null);
  const minRef = useRef(null);
  // Narrow containers: everything except the keyword search lives in a
  // collapsible panel (always shown when wide, via CSS).
  const [panelOpen, setPanelOpen] = useState(false);
  const toggleRef = useRef(null);

  // Keep location input in sync when parent resets filters externally
  useEffect(() => {
    setLocationQuery(filters.location || '');
  }, [filters.location]);

  // Location autocomplete suggestions
  const suggestions = useMemo(() => {
    if (!locationQuery.trim()) return [];
    const query = locationQuery.toLowerCase();
    return locations
      .filter((loc) => loc.toLowerCase().includes(query))
      .slice(0, 8);
  }, [locationQuery, locations]);

  // Close suggestions on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (locationRef.current && !locationRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  /* ─── Helpers ─── */
  const updateFilter = (key, value) => {
    if (onChange) onChange({ ...filters, [key]: value });
  };

  const selectedIndustries = normalizeIndustries(filters.industry);
  const [industriesOpen, setIndustriesOpen] = useState(false);

  // Every search goes through here: an inverted salary range never reaches
  // the server (the error under the salary boxes explains why).
  const runSearch = (nextFilters) => {
    if (isSalaryRangeInvalid(nextFilters.salaryMin, nextFilters.salaryMax)) {
      setPanelOpen(true);
      minRef.current?.focus();
      return;
    }
    if (onSearch) onSearch(nextFilters);
  };

  // Apply takes effect straight away (like the must-haves switch), so the
  // chosen industries are never left half-applied behind a closed dialog.
  const applyIndustries = (next) => {
    const nextFilters = { ...filters, industry: next };
    if (onChange) onChange(nextFilters);
    setIndustriesOpen(false);
    runSearch(nextFilters);
  };

  const handleLocationChange = (e) => {
    const val = e.target.value;
    setLocationQuery(val);
    updateFilter('location', val);
    setShowSuggestions(true);
  };

  const pickLocation = (loc) => {
    setLocationQuery(loc);
    updateFilter('location', loc);
    setShowSuggestions(false);
  };

  /* ─── Submit / Clear ─── */
  // Return focus to the toggle after collapsing, but only when the toggle is
  // actually on screen (it is display:none when the container is wide).
  const closePanel = () => {
    setPanelOpen(false);
    const toggle = toggleRef.current;
    if (toggle && toggle.offsetParent !== null) toggle.focus();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (panelOpen && !isSalaryRangeInvalid(filters.salaryMin, filters.salaryMax)) closePanel();
    runSearch(filters);
  };

  // Esc: first dismiss the location suggestions, then collapse the panel.
  const handleKeyDown = (e) => {
    if (e.key !== 'Escape') return;
    if (showSuggestions && suggestions.length > 0) {
      setShowSuggestions(false);
      return;
    }
    if (panelOpen) {
      e.stopPropagation();
      closePanel();
    }
  };

  const handleClear = () => {
    setLocationQuery('');
    setShowSuggestions(false);
    const next = clearedFilters(filters);
    if (onChange) onChange(next);
    if (onSearch) onSearch(next);
  };

  const mustHavesOn = filters.onlyMeetsRequired === true || filters.onlyMeetsRequired === 'true';
  // How many refinements are set (the badge on the narrow Filters button, and
  // whether Clear filters shows). The keyword and sort order are not filters.
  const activeCount = activeFilterKeys(filters).length;

  return (
    <>
    <form
      className="job-search-filters"
      role="search"
      aria-label={t('jobBoard.filtersLabel')}
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      autoComplete="off"
    >
      <label htmlFor={ids.keyword} className="ds-sr-only">{t('jobBoard.filters.search')}</label>

      {/* Primary search — always visible, at every width */}
      <div className="jsf-bar">
        <div className="jsf-search">
          <FaSearch className="jsf-search-icon" aria-hidden="true" />
          <input
            id={ids.keyword}
            type="text"
            name="q"
            enterKeyHint="search"
            className="ds-input filter-input filter-keyword"
            placeholder={t('jobBoard.filters.keywordPlaceholder')}
            value={filters.q || ''}
            onChange={(e) => updateFilter('q', e.target.value)}
          />
        </div>

        <button type="submit" className="ds-btn ds-btn--primary filter-submit-btn">
          <span className="jsf-submit-long">{t('jobBoard.filters.search')}</span>
          <span className="jsf-submit-short">{t('jobBoard.filters.searchShort')}</span>
        </button>
      </div>

      <button
        type="button"
        ref={toggleRef}
        className="ds-btn ds-btn--secondary jsf-toggle"
        aria-expanded={panelOpen}
        aria-controls={ids.panel}
        onClick={() => setPanelOpen((open) => !open)}
      >
        <FaSlidersH aria-hidden="true" />
        <span>{t('jobBoard.filters.filtersButton')}</span>
        {activeCount > 0 && (
          <span className="ds-badge ds-badge--gold jsf-count">
            {activeCount}
            <span className="ds-sr-only"> {t('jobBoard.filters.selectedSr')}</span>
          </span>
        )}
      </button>

      {/* Refinements — collapsible in narrow containers, static when wide */}
      <div id={ids.panel} className={`jsf-panel ${panelOpen ? 'is-open' : ''}`}>
        <div className="jsf-grid">
          <div className="jsf-field jsf-field--location" ref={locationRef}>
            <label className="jsf-label" htmlFor={ids.location}>{t('jobBoard.filters.location')}</label>
            <div className="filter-location-wrapper">
              <input
                id={ids.location}
                type="text"
                name="location"
                className="ds-input filter-input filter-location"
                placeholder={t('jobBoard.filters.locationPlaceholder')}
                value={locationQuery}
                onChange={handleLocationChange}
                onFocus={() => locationQuery.trim() && setShowSuggestions(true)}
              />
              {showSuggestions && suggestions.length > 0 && (
                <ul className="location-suggestions">
                  {suggestions.map((loc) => (
                    <li key={loc} onMouseDown={() => pickLocation(loc)}>
                      {loc}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="jsf-field jsf-field--jobtype">
            <label className="jsf-label" htmlFor={ids.jobType}>{t('jobBoard.filters.jobType')}</label>
            <select
              id={ids.jobType}
              name="jobType"
              className="ds-input filter-select"
              value={filters.jobType || ''}
              onChange={(e) => updateFilter('jobType', e.target.value)}
            >
              <option value="">{t('jobBoard.filters.allJobTypes')}</option>
              {JOB_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          <div className="jsf-field jsf-field--sort">
            <label className="jsf-label" htmlFor={ids.sort}>{t('jobBoard.filters.sortBy')}</label>
            <select
              id={ids.sort}
              name="sortBy"
              className="ds-input filter-select"
              value={filters.sortBy || ''}
              onChange={(e) => updateFilter('sortBy', e.target.value)}
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.value}>
                  {t(`jobBoard.filters.sort.${opt.key}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="jsf-field jsf-field--industries">
            <span className="jsf-label" id={ids.industriesLabel}>{t('jobBoard.filters.industries')}</span>
            <button
              type="button"
              id={ids.industriesBtn}
              className="ds-btn ds-btn--secondary filter-industries-btn"
              aria-haspopup="dialog"
              aria-labelledby={`${ids.industriesLabel} ${ids.industriesBtn}`}
              onClick={() => setIndustriesOpen(true)}
            >
              <FaSlidersH aria-hidden="true" />
              <span>{t('jobBoard.industries.button')}</span>
              {selectedIndustries.length > 0 && (
                <span className="ds-badge ds-badge--gold jsf-count">
                  {selectedIndustries.length}
                  <span className="ds-sr-only"> {t('jobBoard.filters.selectedSr')}</span>
                </span>
              )}
            </button>
          </div>

          <SalaryRangeSetter
            min={filters.salaryMin}
            max={filters.salaryMax}
            minRef={minRef}
            onChange={(nextMin, nextMax) => {
              if (onChange) onChange({ ...filters, salaryMin: nextMin, salaryMax: nextMax });
            }}
          />
        </div>

        <div className="jsf-footer">
          <label className="must-haves-switch">
            <input
              type="checkbox"
              checked={mustHavesOn}
              onChange={(e) => {
                const next = { ...filters, onlyMeetsRequired: e.target.checked };
                if (onChange) onChange(next);
                // A yes/no toggle reads as broken if it doesn't take effect
                // immediately, unlike the other filters above which are still
                // being composed until "Search Jobs" is pressed.
                runSearch(next);
              }}
            />
            <span>{t('jobBoard.filters.mustHaves')}</span>
          </label>
          {mustHavesOn && mustHaveHiddenCount > 0 && (
            <span className="must-haves-hidden-count">
              {t('jobBoard.filters.hiddenCount', { count: mustHaveHiddenCount })}
            </span>
          )}
          {activeCount > 0 && (
            <button type="button" className="jsf-clear" onClick={handleClear}>
              {t('jobBoard.clearFilters')}
            </button>
          )}
          {/* Second submit for the collapsed layout, where the main Search
              button may have scrolled out of view. Hidden when wide. */}
          <button type="submit" className="ds-btn ds-btn--primary jsf-apply">
            {t('jobBoard.filters.showResults')}
          </button>
        </div>
      </div>
    </form>
    <IndustriesFilterModal
      isOpen={industriesOpen}
      onClose={() => setIndustriesOpen(false)}
      selected={selectedIndustries}
      preferred={preferredIndustries}
      options={INDUSTRIES}
      onApply={applyIndustries}
    />
    </>
  );
};

export default JobSearchFilters;
