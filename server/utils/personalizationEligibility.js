// Shared eligibility check for whether a job-board recommendation request
// should be personalized (ranked against the seeker's own signals) or fall
// back to the plain "requirements met" checklist branch.
//
// P0-03 (markdowns/MATCHMAKING_DEPLOYMENT_CHECKLIST.md): the original check
// only looked at skills/preferredIndustries/preferredOccupations/
// workHistory/educationalAttainment/desiredJobTitle, so a profile containing
// ONLY licenses, language, salary preference, location, or employment-type
// data silently fell into the non-personalized branch even though those are
// all supported matching dimensions (see server/services/semanticService.js).
//
// Each "has data" check below mirrors the exact condition the corresponding
// dimension in semanticService.js uses to tell "no data" apart from a scored
// mismatch (credentialScore(), languageScore(), locationScore(),
// employmentTypeScore()) — so eligibility here never disagrees with what the
// scoring engine itself would treat as usable. A completely empty profile
// (every signal below absent) must still fall through to `false`.
function canPersonalizeRecommendations({
  hasSkills = false,
  preferredIndustries = [],
  preferredOccupations = [],
  workHistory = [],
  educationalAttainment = null,
  desiredJobTitle = null,
  professionalLicenses = [],
  eligibilities = [],
  vocationalTrainings = [],
  languageProficiency = null,
  expectedSalaryMin = null,
  expectedSalaryMax = null,
  presentAddress = null,
  preferredWorkLocationLocal = [],
  preferredJobTypes = [],
  preferredWorkNature = [],
} = {}) {
  const hasLicenseSignal =
    (Array.isArray(professionalLicenses) && professionalLicenses.length > 0) ||
    (Array.isArray(eligibilities) && eligibilities.length > 0) ||
    (Array.isArray(vocationalTrainings) && vocationalTrainings.length > 0);

  const hasLanguageSignal = Boolean(
    languageProficiency &&
      typeof languageProficiency === 'object' &&
      Object.values(languageProficiency).some(
        (v) => v && typeof v === 'object' && ['read', 'write', 'speak', 'understand'].some((m) => v[m])
      )
  );

  const hasSalarySignal = expectedSalaryMin !== null || expectedSalaryMax !== null;

  const hasLocationSignal =
    (Array.isArray(preferredWorkLocationLocal) && preferredWorkLocationLocal.length > 0) ||
    Boolean(
      presentAddress &&
        (presentAddress.barangay || presentAddress.municipality || presentAddress.province || presentAddress.region)
    );

  const hasEmploymentTypeSignal =
    (Array.isArray(preferredJobTypes) && preferredJobTypes.length > 0) ||
    (Array.isArray(preferredWorkNature) && preferredWorkNature.length > 0);

  return Boolean(
    hasSkills ||
      (Array.isArray(preferredIndustries) && preferredIndustries.length > 0) ||
      (Array.isArray(preferredOccupations) && preferredOccupations.length > 0) ||
      (Array.isArray(workHistory) && workHistory.length > 0) ||
      educationalAttainment ||
      desiredJobTitle ||
      hasLicenseSignal ||
      hasLanguageSignal ||
      hasSalarySignal ||
      hasLocationSignal ||
      hasEmploymentTypeSignal
  );
}

module.exports = { canPersonalizeRecommendations };
