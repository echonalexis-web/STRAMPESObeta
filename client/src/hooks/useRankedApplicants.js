import { useState, useEffect } from "react";
import { employerAPI } from "../services/api";

// `sortBy` ('match' | 'mustHaves' | 'date' | 'name') and `onlyMeetsRequired`
// are forwarded to the server, which sorts/filters the applicant's FULL pool
// before slicing to a page — see server/services/semanticService.js
// rankApplicantsByJob(). Re-fetches whenever jobId or either of those
// changes; a plain refetch() (no args) reuses whatever was passed in last,
// so status-change actions elsewhere in the dashboard don't silently reset
// the employer's current sort/filter choice.
export const useRankedApplicants = (jobId, { sortBy = "match", onlyMeetsRequired = false } = {}) => {
  const [applicants, setApplicants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);
  const [filteredTotal, setFilteredTotal] = useState(0);
  // Applicants outside this job's age range — see §B.3: a hard gate should
  // never be a silent deletion from the list.
  const [disqualifiedCount, setDisqualifiedCount] = useState(0);

  const fetchRankedApplicants = async (params) => {
    if (!jobId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await employerAPI.getRankedApplicants(jobId, params || { sortBy, onlyMeetsRequired });
      setApplicants(response.data.applicants || []);
      setTotal(response.data.total || 0);
      setFilteredTotal(response.data.filteredTotal ?? response.data.total ?? 0);
      setDisqualifiedCount(response.data.disqualifiedCount || 0);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to fetch ranked applicants");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRankedApplicants({ sortBy, onlyMeetsRequired });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, sortBy, onlyMeetsRequired]);

  return { applicants, loading, error, total, filteredTotal, disqualifiedCount, refetch: fetchRankedApplicants };
};
