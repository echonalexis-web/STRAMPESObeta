// client/src/constants/civilStatus.js
// Mirrors server/models/JobseekerProfile.js's civilStatus enum. Shared by
// EditProfile.jsx and JobSeekerOnboarding.jsx — previously two independently
// hardcoded copies (only one of which had been alphabetized).
export const CIVIL_STATUS_OPTIONS = [
  "Divorced",
  "Live-in",
  "Married",
  "Separated",
  "Single",
  "Widowed",
  "Prefer not to say",
];
