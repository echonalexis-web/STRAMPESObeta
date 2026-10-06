// Mirrors server/utils/age.js so the UI can hide/redirect on the same age
// bands the backend enforces, without a round-trip. An unknown/unparseable
// dateOfBirth fails closed (ineligible) on both checks, matching the server.

export const getAgeFromDate = (dateOfBirth) => {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;

  const now = new Date();
  if (dob > now) return null;

  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
};

const SPES_MAX_AGE = 30;
export const isSpesEligibleAge = (dateOfBirth) => {
  const age = getAgeFromDate(dateOfBirth);
  return age !== null && age <= SPES_MAX_AGE;
};

const JOB_VACANCY_MIN_AGE = 18;
export const isJobVacancyEligibleAge = (dateOfBirth) => {
  const age = getAgeFromDate(dateOfBirth);
  return age !== null && age >= JOB_VACANCY_MIN_AGE;
};
