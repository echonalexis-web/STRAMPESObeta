import { hasSalaryFilter } from "./salaryRange.js";
import { normalizeIndustries } from "./industrySelection.js";

// "Filters" are the refinements under the search row. The keyword and the
// sort order are not counted: sort only orders results.
export const activeFilterKeys = (filters = {}) => {
  const keys = [];
  if (String(filters.location || "").trim()) keys.push("location");
  if (filters.jobType) keys.push("jobType");
  if (normalizeIndustries(filters.industry).length > 0) keys.push("industry");
  if (hasSalaryFilter(filters.salaryMin, filters.salaryMax)) keys.push("salary");
  if (filters.onlyMeetsRequired === true || filters.onlyMeetsRequired === "true") keys.push("mustHaves");
  return keys;
};

// Resets every filter above and leaves the keyword and sort order alone.
export const clearedFilters = (filters = {}) => ({
  ...filters,
  location: "",
  jobType: "",
  industry: [],
  salaryMin: "",
  salaryMax: "",
  onlyMeetsRequired: false,
});
