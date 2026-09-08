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

module.exports = { MIN_ACCOUNT_AGE, getAgeFromDate, isAdultAge };
