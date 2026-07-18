import React, { useState, useEffect } from 'react';
import "../styles/jobSearchFilters.css";

const JobSearchFilters = ({ initialFilters = {}, onSearch }) => {
  const [filters, setFilters] = useState({
    q: '',
    industry: '',
    workNature: '',
    location: '',
    salaryMin: '',
    salaryMax: '',
    ...initialFilters,
  });

  // Trigger search whenever filters change (debounced) or on submit
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Clean empty values
    const cleaned = {};
    for (const key in filters) {
      if (filters[key] !== '' && filters[key] !== undefined) {
        cleaned[key] = filters[key];
      }
    }
    onSearch(cleaned);
  };

  // Optional: auto‑search on every change (uncomment if you want instant)
  // useEffect(() => {
  //   const timer = setTimeout(() => handleSubmit(new Event('submit')), 300);
  //   return () => clearTimeout(timer);
  // }, [filters]);

  return (
    <form className="job-search-filters" onSubmit={handleSubmit}>
      <div className="filter-row">
        <input
          type="text"
          name="q"
          placeholder="Search jobs..."
          value={filters.q}
          onChange={handleChange}
          className="filter-input"
        />
        <input
          type="text"
          name="location"
          placeholder="Location (e.g. Manila)"
          value={filters.location}
          onChange={handleChange}
          className="filter-input"
        />
      </div>

      <div className="filter-row">
        <select name="industry" value={filters.industry} onChange={handleChange} className="filter-select">
          <option value="">All Industries</option>
          <option value="IT">IT & Software</option>
          <option value="Finance">Finance</option>
          <option value="Healthcare">Healthcare</option>
          <option value="Education">Education</option>
          <option value="Construction">Construction</option>
          <option value="Retail">Retail</option>
          <option value="Manufacturing">Manufacturing</option>
          <option value="Other">Other</option>
        </select>

        <select name="workNature" value={filters.workNature} onChange={handleChange} className="filter-select">
          <option value="">All Work Types</option>
          <option value="remote">Remote</option>
          <option value="onsite">On‑site</option>
          <option value="hybrid">Hybrid</option>
        </select>
      </div>

      <div className="filter-row salary-row">
        <input
          type="number"
          name="salaryMin"
          placeholder="Min salary"
          value={filters.salaryMin}
          onChange={handleChange}
          className="filter-input salary"
        />
        <span>–</span>
        <input
          type="number"
          name="salaryMax"
          placeholder="Max salary"
          value={filters.salaryMax}
          onChange={handleChange}
          className="filter-input salary"
        />
      </div>

      <button type="submit" className="filter-submit-btn">Search</button>
    </form>
  );
};

export default JobSearchFilters;