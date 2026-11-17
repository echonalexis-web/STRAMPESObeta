// Display labels for stored profile values, including the "Not applicable"
// options. Pure; `t` is the i18next translate function (optional).
import { UNEMPLOYMENT_REASON_OPTIONS } from "../constants/unemploymentReasons.js";
import {
  EMPLOYMENT_STATUS_NOT_APPLICABLE,
  EMPLOYMENT_STATUS_PREFER_NOT_TO_SAY,
  UNEMPLOYMENT_REASON_NOT_APPLICABLE,
  WORK_EXPERIENCE_NOT_APPLICABLE,
} from "../constants/profileOptions.js";

const translate = (t, key, fallback) => {
  if (typeof t !== "function") return fallback;
  const text = t(key);
  return text && text !== key ? text : fallback;
};

export const isNotApplicableExperience = (value) => value === WORK_EXPERIENCE_NOT_APPLICABLE;

export const employmentStatusLabel = (status, t) => {
  if (!status) return "";
  if (status === EMPLOYMENT_STATUS_NOT_APPLICABLE) {
    return translate(t, "profileOptions.employmentStatusNotApplicable", "Not applicable (still studying / not yet graduated)");
  }
  if (status === EMPLOYMENT_STATUS_PREFER_NOT_TO_SAY) return translate(t, "profileOptions.preferNotToSay", "Prefer not to say");
  return String(status).charAt(0).toUpperCase() + String(status).slice(1);
};

export const unemploymentReasonLabel = (reason, t) => {
  if (!reason) return "";
  if (reason === UNEMPLOYMENT_REASON_NOT_APPLICABLE) {
    return translate(t, "profileOptions.unemploymentReasonNotApplicable", "Not applicable (not yet graduated)");
  }
  const found = UNEMPLOYMENT_REASON_OPTIONS.find((option) => option.value === reason);
  return found ? found.label : String(reason).replace(/_/g, " ");
};

// Text for the cover letter {years} placeholder: the stated band, or "" when it
// is "Not applicable" (that is not a number of years).
export const experienceYearsText = (value) => (!value || isNotApplicableExperience(value) ? "" : value);

// "Years of experience" text for a profile line; empty for "Not applicable".
export const workExperienceLabel = (value, t) => {
  if (!value) return "";
  if (isNotApplicableExperience(value)) return translate(t, "profileOptions.workExperienceNotApplicable", "Not applicable");
  return value;
};
