import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import '../styles/jobSearchFilters.css';
import { FaSearch, FaSlidersH } from 'react-icons/fa';
import { useSystemOptions } from '../hooks/useSystemOptions';
import { JOB_TYPES as JOB_TYPES_FALLBACK } from '../constants/jobTypes';
import { VALID_INDUSTRIES as INDUSTRIES_FALLBACK } from '../constants/industries';
import IndustriesFilterModal from './IndustriesFilterModal';
import { normalizeIndustries } from '../utils/industrySelection';

const SORT_OPTIONS = [
  { value: '', label: 'Best match' },
  { value: 'newest', label: 'Newest' },
  { value: 'salary', label: 'Highest pay' },
];

const SALARY_MIN_BOUND = 0;
const SALARY_MAX_BOUND = 100000;
const SALARY_STEP = 1000;

const formatSalaryTick = (value) => {
  if (value >= SALARY_MAX_BOUND) return `₱${SALARY_MAX_BOUND.toLocaleString('en-PH')}+`;
  return `₱${value.toLocaleString('en-PH')}`;
};

/* ─── Dual-handle salary range slider ─── */
function SalaryRangeSlider({ min, max, onChange }) {
  const currentMin = Number.isFinite(min) ? min : SALARY_MIN_BOUND;
  const currentMax = Number.isFinite(max) ? max : SALARY_MAX_BOUND;

  const handleMinChange = (e) => {
    const next = Math.min(Number(e.target.value), currentMax);
    onChange(next, currentMax);
  };

  const handleMaxChange = (e) => {
    const next = Math.max(Number(e.target.value), currentMin);
    onChange(currentMin, next);
  };

  const minPct = ((currentMin - SALARY_MIN_BOUND) / (SALARY_MAX_BOUND - SALARY_MIN_BOUND)) * 100;
  const maxPct = ((currentMax - SALARY_MIN_BOUND) / (SALARY_MAX_BOUND - SALARY_MIN_BOUND)) * 100;

  return (
    <div className="salary-range-field">
      <div className="salary-range-header">
        <span className="salary-range-label">Salary Range (per month)</span>
        <span className="salary-range-value">
          {formatSalaryTick(currentMin)} – {formatSalaryTick(currentMax)}
        </span>
      </div>
      <div className="salary-range-track-wrap">
        <div className="salary-range-track" />
        <div
          className="salary-range-fill"
          style={{ left: `${minPct}%`, right: `${100 - maxPct}%` }}
        />
        <input
          type="range"
          className="salary-range-input salary-range-input--min"
          min={SALARY_MIN_BOUND}
          max={SALARY_MAX_BOUND}
          step={SALARY_STEP}
          value={currentMin}
          onChange={handleMinChange}
          aria-label="Minimum salary"
        />
        <input
          type="range"
          className="salary-range-input salary-range-input--max"
          min={SALARY_MIN_BOUND}
          max={SALARY_MAX_BOUND}
          step={SALARY_STEP}
          value={currentMax}
          onChange={handleMaxChange}
          aria-label="Maximum salary"
        />
      </div>
    </div>
  );
}

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

/* ─── Component ─── */
const JobSearchFilters = ({ filters = {}, onChange, onSearch, onReset, phLocationsData, preferredIndustries = [], mustHaveHiddenCount = 0 }) => {
  const { t } = useTranslation();
  // Admin-maintainable catalogs (item 11) — live from the server, with the
  // old hardcoded lists as a fallback for first paint / offline.
  const { options: JOB_TYPES } = useSystemOptions('jobType', { fallback: JOB_TYPES_FALLBACK, extra: ['Remote'] });
  const { options: INDUSTRIES } = useSystemOptions('industry', { fallback: INDUSTRIES_FALLBACK });

  const locations = useMemo(
    () => (phLocationsData ? flattenLocations(phLocationsData) : []),
    [phLocationsData]
  );

  const [locationQuery, setLocationQuery] = useState(filters.location || '');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const locationRef = useRef(null);
  // Mobile: everything except the keyword search lives in a collapsible
  // panel (always shown >=768px via CSS). Desktop ignores this state.
  const [panelOpen, setPanelOpen] = useState(false);
  const toggleRef = useRef(null);
  const panelId = 'job-filters-panel';

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

  // Apply takes effect straight away (like the must-haves switch), so the
  // chosen industries are never left half-applied behind a closed dialog.
  const applyIndustries = (next) => {
    const nextFilters = { ...filters, industry: next };
    if (onChange) onChange(nextFilters);
    setIndustriesOpen(false);
    if (panelOpen) setPanelOpen(false);
    if (onSearch) onSearch(nextFilters);
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

  /* ─── Submit / Reset ─── */
  // Return focus to the toggle after collapsing, but only when the toggle is
  // actually on screen (it is display:none >=768px, where the panel is static).
  const closePanel = () => {
    setPanelOpen(false);
    const toggle = toggleRef.current;
    if (toggle && toggle.offsetParent !== null) toggle.focus();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (panelOpen) closePanel();
    if (onSearch) onSearch();
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

  const handleResetClick = () => {
    setLocationQuery('');
    setShowSuggestions(false);
    if (onReset) onReset();
  };

  const mustHavesOn = filters.onlyMeetsRequired === true || filters.onlyMeetsRequired === 'true';
  const hasSalaryMin = filters.salaryMin !== undefined && filters.salaryMin !== '' && filters.salaryMin !== null;
  const hasSalaryMax = filters.salaryMax !== undefined && filters.salaryMax !== '' && filters.salaryMax !== null;
  // How many refinements are set (shown on the mobile toggle so a collapsed
  // panel still tells the user filters are active).
  const activeFilterCount = [
    Boolean(String(filters.location || '').trim()),
    Boolean(filters.jobType),
    Boolean(filters.sortBy),
    hasSalaryMin || hasSalaryMax,
    selectedIndustries.length > 0,
    mustHavesOn,
  ].filter(Boolean).length;

  // The keyword counts for Clear filters, but not for the Filters badge.
  const hasAnyFilter = activeFilterCount > 0 || Boolean(String(filters.q || '').trim());

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
      <label htmlFor="q" className="ds-sr-only">Search Jobs</label>

      {/* Primary search — always visible, at every width */}
      <div className="jsf-bar">
        <div className="jsf-search">
          <FaSearch className="jsf-search-icon" aria-hidden="true" />
          <input
            id="q"
            type="text"
            name="q"
            enterKeyHint="search"
            className="ds-input filter-input filter-keyword"
            placeholder="Search jobs, keywords, titles..."
            value={filters.q || ''}
            onChange={(e) => updateFilter('q', e.target.value)}
          />
        </div>

        <button type="submit" className="ds-btn ds-btn--primary filter-submit-btn">
          Search Jobs
        </button>

        <button
          type="button"
          ref={toggleRef}
          className="ds-btn ds-btn--secondary jsf-toggle"
          aria-expanded={panelOpen}
          aria-controls={panelId}
          onClick={() => setPanelOpen((open) => !open)}
        >
          <FaSlidersH aria-hidden="true" />
          <span>Filters</span>
          {activeFilterCount > 0 && (
            <span className="ds-badge ds-badge--gold jsf-count">
              {activeFilterCount}
              <span className="ds-sr-only"> selected</span>
            </span>
          )}
        </button>
      </div>

      {/* Refinements — collapsible below 768px, static above */}
      <div id={panelId} className={`jsf-panel ${panelOpen ? 'is-open' : ''}`}>
        <div className="jsf-fields">
          <div className="filter-location-wrapper" ref={locationRef}>
            <input
              type="text"
              name="location"
              className="ds-input filter-input filter-location"
              placeholder="City, province, or region"
              aria-label="Location"
              value={locationQuery}
              onChange={handleLocationChange}
              onFocus={() => locationQuery.trim() && setShowSuggestions(true)}
            />
            {showSuggestions && suggestions.length > 0 && (
              <ul className="location-suggestions">
                {suggestions.map((loc, idx) => (
                  <li key={idx} onMouseDown={() => pickLocation(loc)}>
                    {loc}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <select
            name="jobType"
            className="ds-input filter-select"
            aria-label="Job type"
            value={filters.jobType || ''}
            onChange={(e) => updateFilter('jobType', e.target.value)}
          >
            <option value="">All Job Types</option>
            {JOB_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>

          <select
            name="sortBy"
            className="ds-input filter-select"
            value={filters.sortBy || ''}
            onChange={(e) => updateFilter('sortBy', e.target.value)}
            aria-label="Sort jobs by"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value || 'match'} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="ds-btn ds-btn--secondary filter-industries-btn"
            aria-haspopup="dialog"
            onClick={() => setIndustriesOpen(true)}
          >
            {selectedIndustries.length > 0
              ? t('jobBoard.industries.buttonCount', { count: selectedIndustries.length })
              : t('jobBoard.industries.button')}
          </button>

          <SalaryRangeSlider
            min={filters.salaryMin !== undefined && filters.salaryMin !== '' ? Number(filters.salaryMin) : SALARY_MIN_BOUND}
            max={filters.salaryMax !== undefined && filters.salaryMax !== '' ? Number(filters.salaryMax) : SALARY_MAX_BOUND}
            onChange={(nextMin, nextMax) => {
              if (onChange) {
                onChange({
                  ...filters,
                  salaryMin: nextMin > SALARY_MIN_BOUND ? nextMin : '',
                  salaryMax: nextMax < SALARY_MAX_BOUND ? nextMax : '',
                });
              }
            }}
          />
        </div>

        {/* Only jobs I fully qualify for */}
        <div className="filter-row must-haves-row">
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
                if (onSearch) onSearch(next);
              }}
            />
            <span>Only show jobs where I meet every must-have</span>
          </label>
          {mustHavesOn && mustHaveHiddenCount > 0 && (
            <span className="must-haves-hidden-count">
              Hiding {mustHaveHiddenCount} job{mustHaveHiddenCount === 1 ? "" : "s"} you don't fully qualify for
            </span>
          )}
        </div>

        <div className="jsf-actions">
          {/* Shown only while a refinement is set. */}
          {hasAnyFilter && (
            <button
              type="button"
              className="ds-btn ds-btn--secondary btn-reset"
              onClick={handleResetClick}
            >
              {t('jobBoard.clearFilters')}
            </button>
          )}
          {/* Second submit for the collapsed-panel layout, where the main
              Search button may have scrolled out of view. Hidden >=768px. */}
          <button type="submit" className="ds-btn ds-btn--primary jsf-apply">
            Show results
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
