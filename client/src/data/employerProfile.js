// Shared option lists for the employer profile. The workforce-size bands follow
// the NSRP / DOLE MSME classification by headcount, and the same list backs both
// the "Company Size" and "Total Workforce Size" fields so the two attributes
// always carry identical values. Kept in sync with the server:
//   - `User.companySize` enum
//   - `EmployerProfile.totalWorkforceSize` enum

export const WORKFORCE_SIZE_OPTIONS = [
  { value: "micro", label: "Micro (1-9)" },
  { value: "small", label: "Small (10-99)" },
  { value: "medium", label: "Medium (100-199)" },
  { value: "large", label: "Large (200+)" },
];

export const WORKFORCE_SIZE_VALUES = WORKFORCE_SIZE_OPTIONS.map((o) => o.value);

const LABEL_BY_VALUE = WORKFORCE_SIZE_OPTIONS.reduce((acc, o) => {
  acc[o.value] = o.label;
  return acc;
}, {});

// Turn a stored band value ("micro") into its display label ("Micro (1-9)").
// Unknown / legacy values are returned unchanged so nothing disappears from view.
export const workforceSizeLabel = (value) => LABEL_BY_VALUE[value] || value || "";
