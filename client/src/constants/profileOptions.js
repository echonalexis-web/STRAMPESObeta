// Choices shared by the jobseeker wizard and Edit profile (they used to keep two
// hardcoded copies). Values match server/utils/enumValues.js. Existing labels
// stay plain English as before; the new "Not applicable" options carry an i18n key.
// "Not applicable" is for students and people who have not graduated yet.

export const WORK_EXPERIENCE_NOT_APPLICABLE = "Not applicable";
export const EMPLOYMENT_STATUS_NOT_APPLICABLE = "not_applicable";
export const UNEMPLOYMENT_REASON_NOT_APPLICABLE = "not_applicable";

export const WORK_EXPERIENCE_OPTIONS = [
  { value: "Fresh Graduate", label: "Fresh Graduate" },
  { value: "Less than 1 year", label: "Less than 1 year" },
  { value: "1–3 years", label: "1–3 years" },
  { value: "3–5 years", label: "3–5 years" },
  { value: "5+ years", label: "5+ years" },
  { value: WORK_EXPERIENCE_NOT_APPLICABLE, labelKey: "profileOptions.workExperienceNotApplicable" },
];

export const EMPLOYMENT_STATUS_OPTIONS = [
  { value: "employed", label: "Employed" },
  { value: "unemployed", label: "Unemployed" },
  { value: EMPLOYMENT_STATUS_NOT_APPLICABLE, labelKey: "profileOptions.employmentStatusNotApplicable" },
];

// Edit profile also offers "Prefer not to say" (the schema has always allowed it).
export const EMPLOYMENT_STATUS_PREFER_NOT_TO_SAY = "Prefer not to say";

export const optionLabel = (option, t) =>
  option.labelKey && typeof t === "function" ? t(option.labelKey) : option.label;
