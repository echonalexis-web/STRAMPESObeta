import React, { useState, useEffect, useRef, useMemo } from 'react';
import '../styles/jobSearchFilters.css';
import { FaSearch } from 'react-icons/fa';

const JOB_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship', 'Temporary', 'Remote'];

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
const JobSearchFilters = ({ filters = {}, onChange, onSearch, onReset, phLocationsData, preferredIndustries = [] }) => {
  const locations = useMemo(
    () => (phLocationsData ? flattenLocations(phLocationsData) : []),
    [phLocationsData]
  );

  const [locationQuery, setLocationQuery] = useState(filters.location || '');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const locationRef = useRef(null);

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
  const handleSubmit = (e) => {
    e.preventDefault();
    if (onSearch) onSearch();
  };

  const handleResetClick = () => {
    setLocationQuery('');
    setShowSuggestions(false);
    if (onReset) onReset();
  };

  return (
    <form className="job-search-filters" onSubmit={handleSubmit} autoComplete="off">
      <label htmlFor="q" className="search-label">
        <FaSearch /> Search Jobs
      </label>

      {/* ROW 1 — Primary Search */}
      <div className="filter-row primary-row">
        <input
          type="text"
          name="q"
          className="filter-input filter-keyword"
          placeholder="Search jobs, keywords, titles..."
          value={filters.q || ''}
          onChange={(e) => updateFilter('q', e.target.value)}
        />

        <div className="filter-location-wrapper" ref={locationRef}>
          <input
            type="text"
            name="location"
            className="filter-input filter-location"
            placeholder="City, province, or region"
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

        <button type="submit" className="filter-submit-btn">
          Search Jobs
        </button>
      </div>

      {/* ROW 2 — Refinements */}
      <div className="filter-row refinement-row">
        <select
          name="jobType"
          className="filter-select"
          value={filters.jobType || ''}
          onChange={(e) => updateFilter('jobType', e.target.value)}
        >
          <option value="">All Job Types</option>
          {JOB_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

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

        <button
          type="button"
          className="filter-submit-btn btn-reset"
          onClick={handleResetClick}
        >
          Reset
        </button>
      </div>

      {/* ROW 3 — Industry Preferences */}
      {preferredIndustries.length > 0 && (
        <div className="filter-row preferred-industries-row">
          <span className="preferred-label">Your Industries:</span>
          <div className="industry-chips">
            <button
              type="button"
              className={`industry-chip ${!filters.industry ? 'active' : ''}`}
              onClick={() => updateFilter('industry', '')}
            >
              All Industries
            </button>
            {preferredIndustries.map((ind) => (
              <button
                key={ind}
                type="button"
                className={`industry-chip ${filters.industry === ind ? 'active' : ''}`}
                onClick={() => updateFilter('industry', ind)}
              >
                {ind}
              </button>
            ))}
          </div>
        </div>
      )}
    </form>
  );
};

export default JobSearchFilters;
