// client/src/constants/unemploymentReasons.js
// Shared by EditProfile.jsx and JobSeekerOnboarding.jsx — previously two
// independently hardcoded, un-alphabetized copies. Alphabetized by label;
// `value` strings are unchanged (already persisted on existing profiles).
export const UNEMPLOYMENT_REASON_OPTIONS = [
  { value: "finished_contract", label: "Finished Contract" },
  { value: "fresh_grad", label: "Fresh Graduate" },
  { value: "laidoff_abroad", label: "Laid off (Abroad)" },
  { value: "laidoff_local", label: "Laid off (Local)" },
  { value: "resigned", label: "Resigned" },
  { value: "retired", label: "Retired" },
];
