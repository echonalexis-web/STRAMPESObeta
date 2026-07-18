import { useState, useEffect } from "react";
import { employerAPI } from "../services/api";

export const useRankedApplicants = (jobId) => {
  const [applicants, setApplicants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);

  const fetchRankedApplicants = async (params = {}) => {
    if (!jobId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await employerAPI.getRankedApplicants(jobId, params);
      setApplicants(response.data.applicants || []);
      setTotal(response.data.total || 0);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to fetch ranked applicants");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRankedApplicants();
  }, [jobId]);

  return { applicants, loading, error, total, refetch: fetchRankedApplicants };
};