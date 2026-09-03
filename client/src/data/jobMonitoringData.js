const MUNICIPALITY_LABELS = [
  "Boac (Capital)",
  "Santa Cruz",
  "Gasan",
  "Mogpog",
  "Torrijos",
  "Buenavista",
];

const normalizeMunicipalityLabel = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "Other / Outside Province";

  const lower = raw.toLowerCase();
  if (lower.includes("boac") || lower.includes("capital")) return "Boac (Capital)";
  if (lower.includes("santa cruz")) return "Santa Cruz";
  if (lower.includes("gasan")) return "Gasan";
  if (lower.includes("mogpog")) return "Mogpog";
  if (lower.includes("torrijos")) return "Torrijos";
  if (lower.includes("buenavista")) return "Buenavista";

  return MUNICIPALITY_LABELS.includes(raw) ? raw : "Other / Outside Province";
};

const normalizeJobStatus = (value = "") => {
  const status = String(value || "").trim().toLowerCase();

  if (status === "draft" || status === "pending" || status === "review") return "pending";
  if (status === "urgent") return "urgent";
  if (status === "active") return "active";
  if (["closed", "filled", "hired", "completed"].includes(status)) return "closed";
  if (["rejected", "declined", "denied"].includes(status)) return "rejected";

  return "pending";
};

export const normalizeJobMonitoringRecord = (job = {}) => {
  const status = normalizeJobStatus(job.status);
  const employer = typeof job.employer === "object" && job.employer !== null
    ? job.employer.companyName || job.employer.name || "Unknown Employer"
    : typeof job.employer === "string"
      ? job.employer
      : "Unknown Employer";

  const qualificationValues = Array.isArray(job.qualifications)
    ? job.qualifications
        .map((qualification) => {
          if (typeof qualification === "string") return qualification;
          if (qualification && typeof qualification === "object") {
            return qualification.value || qualification.name || qualification.label || "";
          }
          return "";
        })
        .filter(Boolean)
    : [];

  const normalizedMunicipality = normalizeMunicipalityLabel(job.location || job.municipality || "");

  return {
    id: String(job._id || job.id || ""),
    title: job.title || "Untitled Job",
    description: job.description || "No description provided.",
    employer,
    category: job.industry || job.category || "General",
    type: job.jobType || job.type || "Full-Time",
    municipality: normalizedMunicipality,
    slots: Number(job.slots || 0),
    applicants: Number(job.applicantCount ?? job.applicants ?? 0),
    status,
    isVerified: Boolean(job.isVerified || job.employer?.verificationStatus === "verified"),
    salary: job.salary || (job.salaryMin && job.salaryMax ? `₱${job.salaryMin} - ₱${job.salaryMax}` : "Not specified"),
    datePosted: job.createdAt || job.datePosted || new Date().toISOString(),
    qualifications: qualificationValues,
    location: job.location || job.municipality || normalizedMunicipality,
    severity: job.severity || "Standard",
  };
};
