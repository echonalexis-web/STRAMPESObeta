// Helpers for the structured "basic requirements" slice of a job posting
// (age / education / experience / language). Kept out of the component file so
// Fast Refresh stays happy and so PostJob / EmployerDashboard can share them.

import { EDUCATION_LEVELS } from "../data/jobRequirements";

export const EMPTY_BASIC_REQUIREMENTS = {
  minAge: "",
  maxAge: "",
  minEducationLevel: "",
  educationOrEquivalentExperience: false,
  minExperienceYears: "",
  languageRequirements: [],
};

// Pull just the basic-requirements slice out of an arbitrary object (a job from
// the API, or a persisted form draft), coercing to the string-based shape the
// editor uses.
export const pickBasicRequirements = (source = {}) => ({
  minAge: source.minAge === 0 || source.minAge ? String(source.minAge) : "",
  maxAge: source.maxAge === 0 || source.maxAge ? String(source.maxAge) : "",
  minEducationLevel: EDUCATION_LEVELS.includes(source.minEducationLevel)
    ? source.minEducationLevel
    : "",
  educationOrEquivalentExperience: Boolean(source.educationOrEquivalentExperience),
  minExperienceYears:
    source.minExperienceYears === 0 || source.minExperienceYears
      ? String(source.minExperienceYears)
      : "",
  languageRequirements: Array.isArray(source.languageRequirements)
    ? source.languageRequirements
        .filter((entry) => entry && entry.language)
        .map((entry) => ({
          language: entry.language,
          read: Boolean(entry.read),
          write: Boolean(entry.write),
          speak: Boolean(entry.speak),
          understand: Boolean(entry.understand),
          required: entry.required !== false,
        }))
    : [],
});

// Convert the editor's string-based state into the API payload (numbers / null).
export const serializeBasicRequirements = (form = EMPTY_BASIC_REQUIREMENTS) => {
  const num = (raw) => (raw === "" || raw === null || raw === undefined ? null : Number(raw));
  return {
    minAge: num(form.minAge),
    maxAge: num(form.maxAge),
    minEducationLevel: form.minEducationLevel || null,
    educationOrEquivalentExperience: Boolean(form.educationOrEquivalentExperience),
    minExperienceYears: num(form.minExperienceYears),
    languageRequirements: (form.languageRequirements || [])
      .filter((entry) => entry && entry.language)
      .map((entry) => ({
        language: entry.language,
        read: Boolean(entry.read),
        write: Boolean(entry.write),
        speak: Boolean(entry.speak),
        understand: Boolean(entry.understand),
        required: entry.required !== false,
      })),
  };
};

// Local, non-blocking validation. Returns an array of message strings.
export const validateBasicRequirements = (form = EMPTY_BASIC_REQUIREMENTS, minAccountAge = 15) => {
  const issues = [];
  const min = form.minAge === "" ? null : Number(form.minAge);
  const max = form.maxAge === "" ? null : Number(form.maxAge);
  const exp = form.minExperienceYears === "" ? null : Number(form.minExperienceYears);
  if (min !== null && (!Number.isFinite(min) || min < minAccountAge)) {
    issues.push(`Minimum age can't be below ${minAccountAge}.`);
  }
  if (max !== null && !Number.isFinite(max)) issues.push("Maximum age must be a number.");
  if (min !== null && max !== null && min > max) {
    issues.push("Minimum age can't be greater than maximum age.");
  }
  if (exp !== null && (!Number.isFinite(exp) || exp < 0)) {
    issues.push("Minimum experience must be zero or more.");
  }
  return issues;
};
