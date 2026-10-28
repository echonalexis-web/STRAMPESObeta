// Whether a job (tagged with one or more industries) matches any industry
// in the given list. `job.industry` is an array, but a not-yet-migrated job
// may still come back from the API as a plain string.
export function jobMatchesAnyIndustry(job, industries) {
  if (!Array.isArray(industries) || industries.length === 0) return false;
  const jobIndustries = Array.isArray(job?.industry) ? job.industry : [job?.industry].filter(Boolean);
  return jobIndustries.some((ind) => industries.includes(ind));
}
