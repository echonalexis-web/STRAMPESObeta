// client/src/constants/civilStatus.js
// Mirrors server/models/JobseekerProfile.js's civilStatus enum. Shared by
// EditProfile.jsx and JobSeekerOnboarding.jsx — previously two independently
// hardcoded copies (only one of which had been alphabetized).
export const CIVIL_STATUS_OPTIONS = [
  "Divorced",
  "Live-in",
  "Married",
  "Other",
  "Separated",
  "Single",
  "Widowed",
  "Prefer not to say",
];

// Mirrors governmentIdTypes.js's GOVERNMENT_ID_TYPE_OTHER sentinel — items
// 14/15's "Other, please specify" fallback, this time for civil status.
export const CIVIL_STATUS_OTHER = "Other";
