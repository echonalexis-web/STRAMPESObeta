// Minimum age to hold a STRAM PESO account. Lowered from 18 to 15 so SPES
// (Special Program for Employment of Students) applicants, who may be 15–30,
// can register and complete the NSRP profile.
const MIN_ACCOUNT_AGE = 15;

// Whole years between `dateOfBirth` and now. Returns null for an unparseable
// or future date so callers can decide how strict to be.
const getAgeFromDate = (dateOfBirth) => {
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

const isAdultAge = (dateOfBirth) => {
  const age = getAgeFromDate(dateOfBirth);
  return age !== null && age >= MIN_ACCOUNT_AGE;
};

// SPES (Special Program for Employment of Students) is a DOLE program for
// applicants aged 15-30. The account-level floor above already guarantees
// 15+; this only needs to enforce the 30-and-under ceiling. An unknown DOB
// can't be proven eligible, so it fails closed (false).
const SPES_MAX_AGE = 30;
const isSpesEligibleAge = (dateOfBirth) => {
  const age = getAgeFromDate(dateOfBirth);
  return age !== null && age <= SPES_MAX_AGE;
};

// Job vacancy browsing/applying is restricted to 18+ jobseekers; 15-17
// account holders are limited to SPES and News. An unknown DOB fails closed.
const JOB_VACANCY_MIN_AGE = 18;
const isJobVacancyEligibleAge = (dateOfBirth) => {
  const age = getAgeFromDate(dateOfBirth);
  return age !== null && age >= JOB_VACANCY_MIN_AGE;
};

module.exports = {
  MIN_ACCOUNT_AGE,
  SPES_MAX_AGE,
  JOB_VACANCY_MIN_AGE,
  getAgeFromDate,
  isAdultAge,
  isSpesEligibleAge,
  isJobVacancyEligibleAge,
};
