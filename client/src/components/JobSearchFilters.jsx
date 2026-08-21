import React, { useState, useEffect, useRef, useMemo } from 'react';
import '../styles/jobSearchFilters.css';
import { FaSearch } from 'react-icons/fa';   

const JOB_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship', 'Temporary', 'Remote'];

const SALARY_GRADES = Array.from({ length: 33 }, (_, i) => ({
  value: `SG-${i + 1}`,
  label: `Salary Grade ${i + 1}`,
}));

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

  // UI-only state (input buffers, dropdown visibility)
  const [skillInput, setSkillInput] = useState('');
  const [locationQuery, setLocationQuery] = useState(filters.location || '');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const locationRef = useRef(null);

  // Keep location input in sync when parent resets filters externally
  useEffect(() => {
    setLocationQuery(filters.location || '');
  }, [filters.location]);

  // Derive skills array from filters.skills (stored as comma-separated string)
  const skills = useMemo(() => {
    if (!filters.skills) return [];
    return String(filters.skills)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }, [filters.skills]);

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

  /* ─── Skills tag logic ─── */
  const addSkill = () => {
    const trimmed = skillInput.trim();
    if (trimmed && !skills.includes(trimmed)) {
      updateFilter('skills', [...skills, trimmed].join(','));
    }
    setSkillInput('');
  };

  const handleSkillKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addSkill();
    } else if (e.key === 'Backspace' && skillInput === '' && skills.length > 0) {
      updateFilter('skills', skills.slice(0, -1).join(','));
    }
  };

  const removeSkill = (skill) => {
    updateFilter(
      'skills',
      skills.filter((s) => s !== skill).join(',')
    );
  };

  /* ─── Submit / Reset ─── */
  const handleSubmit = (e) => {
    e.preventDefault();
    if (onSearch) onSearch();
  };

  const handleResetClick = () => {
    setLocationQuery('');
    setSkillInput('');
    setShowSuggestions(false);
    if (onReset) onReset();
  };

  return (
    <form className="job-search-filters" onSubmit={handleSubmit} autoComplete="off">
      <label htmlFor="q" className="search-label">
        <FaSearch /> Search Jobs
      </label>
      
      {/* ═══════════════════════════════════════
          ROW 1 — Primary Search
          ═══════════════════════════════════════ */}
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

      {/* ═══════════════════════════════════════
          ROW 2 — Core Refinements
          ═══════════════════════════════════════ */}
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

        <select
          name="salaryGrade"
          className="filter-select"
          value={filters.salaryGrade || ''}
          onChange={(e) => updateFilter('salaryGrade', e.target.value)}
        >
          <option value="">Any Salary Grade</option>
          {SALARY_GRADES.map((sg) => (
            <option key={sg.value} value={sg.value}>
              {sg.label}
            </option>
          ))}
        </select>

        <div className="filter-skills-wrapper">
          <div className="skills-tags">
            {skills.map((skill) => (
              <span key={skill} className="skill-tag">
                {skill}
                <button
                  type="button"
                  onClick={() => removeSkill(skill)}
                  aria-label={`Remove ${skill}`}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              type="text"
              className="skills-input"
              placeholder={skills.length === 0 ? 'Add skills (press Enter)' : ''}
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              onKeyDown={handleSkillKeyDown}
            />
          </div>
        </div>

        <button
          type="button"
          className="filter-submit-btn btn-reset"
          onClick={handleResetClick}
        >
          Reset
        </button>
      </div>

      {/* ═══════════════════════════════════════
          ROW 3 — Industry Preferences (NEW)
          ═══════════════════════════════════════ */}
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