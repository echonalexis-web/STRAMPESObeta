// The six municipalities of Marinduque and the "Other" bucket, with the matching
// rules the admin screens already use. Moved here unchanged from adminController
// so analytics, job monitoring and the report generator share one definition.

const MUNICIPALITY_LABELS = [
  "Boac (Capital)",
  "Santa Cruz",
  "Gasan",
  "Mogpog",
  "Torrijos",
  "Buenavista",
  "Other / Outside Province",
];

const escapeRegExp = (value = "") => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeMunicipality = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const lower = raw.toLowerCase();
  if (lower.includes("other") && (lower.includes("outside") || lower.includes("province") || lower.includes("marinduque"))) {
    return "Other / Outside Province";
  }
  if (lower.includes("boac") || lower.includes("capital")) return "Boac (Capital)";
  if (lower.includes("santa cruz")) return "Santa Cruz";
  if (lower.includes("gasan")) return "Gasan";
  if (lower.includes("mogpog")) return "Mogpog";
  if (lower.includes("torrijos")) return "Torrijos";
  if (lower.includes("buenavista")) return "Buenavista";
  return raw;
};

const normalizeMunicipalityLabel = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "Other / Outside Province";

  const normalized = normalizeMunicipality(raw);
  if (normalized && MUNICIPALITY_LABELS.includes(normalized)) {
    return normalized;
  }

  return "Other / Outside Province";
};

const getMunicipalityFilterPattern = (value = "") => {
  const normalizedMunicipality = normalizeMunicipalityLabel(value);

  const patternMap = {
    "Boac (Capital)": "boac|capital",
    "Santa Cruz": "santa\\s*cruz",
    "Gasan": "gasan",
    "Mogpog": "mogpog",
    "Torrijos": "torrijos",
    "Buenavista": "buenavista",
    "Other / Outside Province": "^(?!.*(?:boac|santa\\s*cruz|gasan|mogpog|torrijos|buenavista)).*$",
  };

  return patternMap[normalizedMunicipality] || escapeRegExp(normalizedMunicipality);
};

const normalizeApplicantMunicipality = (municipality = "", province = "") => {
  const rawMunicipality = String(municipality || "").trim();
  const rawProvince = String(province || "").trim();
  const normalizedProvince = rawProvince.toLowerCase();

  if (!rawMunicipality && !rawProvince) {
    return "Other";
  }

  if (!normalizedProvince.includes("marinduque")) {
    return "Other";
  }

  const normalizedMunicipality = normalizeMunicipality(rawMunicipality);
  return MUNICIPALITY_LABELS.includes(normalizedMunicipality) ? normalizedMunicipality : "Other";
};

module.exports = {
  MUNICIPALITY_LABELS,
  escapeRegExp,
  normalizeMunicipality,
  normalizeMunicipalityLabel,
  getMunicipalityFilterPattern,
  normalizeApplicantMunicipality,
};
