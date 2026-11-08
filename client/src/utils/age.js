// Mirrors server/utils/age.js so the UI can show the same age bands the backend
// enforces. DISPLAY ONLY: the server recomputes the age from the stored date of
// birth on every guarded request (Asia/Manila), so nothing here is a gate and
// nothing derived from it is cached in a token or localStorage.
//
// Tiers: under15 | minor15to17 | adult18to30 | adult31plus | unknown.

const MANILA_TZ = "Asia/Manila";
export const MIN_ACCOUNT_AGE = 15;
export const SPES_MIN_AGE = 15;
export const SPES_MAX_AGE = 30;
export const JOB_VACANCY_MIN_AGE = 18;

export const AGE_TIERS = Object.freeze({
  UNDER_15: "under15",
  MINOR: "minor15to17",
  ADULT: "adult18to30",
  SENIOR: "adult31plus",
  UNKNOWN: "unknown",
});

const manilaFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: MANILA_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Today's civil date in Asia/Manila as { year, month, day }.
export const getManilaToday = (now = new Date()) => {
  const parts = {};
  for (const p of manilaFormatter.formatToParts(now)) parts[p.type] = p.value;
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
};

// YYYY-MM-DD for today in Manila; used as the `max` of a date input.
export const getManilaTodayISO = (now = new Date()) => {
  const t = getManilaToday(now);
  return `${String(t.year).padStart(4, "0")}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
};

// A date of birth is a calendar date: read it from its date-only text, or from
// the UTC components of a Date (the server stores UTC midnight).
const getDobParts = (dateOfBirth) => {
  if (!dateOfBirth) return null;
  if (typeof dateOfBirth === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth);
    if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  }
  const dob = dateOfBirth instanceof Date ? dateOfBirth : new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  return { year: dob.getUTCFullYear(), month: dob.getUTCMonth() + 1, day: dob.getUTCDate() };
};

const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export const getAgeFromDate = (dateOfBirth, now = new Date()) => {
  const dob = getDobParts(dateOfBirth);
  if (!dob) return null;
  const today = getManilaToday(now);
  const dobKey = dob.year * 10000 + dob.month * 100 + dob.day;
  const todayKey = today.year * 10000 + today.month * 100 + today.day;
  if (dobKey > todayKey) return null;

  let age = today.year - dob.year;
  let bMonth = dob.month;
  let bDay = dob.day;
  if (bMonth === 2 && bDay === 29 && !isLeapYear(today.year)) {
    bMonth = 3;
    bDay = 1;
  }
  if (today.month < bMonth || (today.month === bMonth && today.day < bDay)) age -= 1;
  return age;
};

export const getAgeTier = (dateOfBirth, now = new Date()) => {
  const age = getAgeFromDate(dateOfBirth, now);
  if (age === null) return AGE_TIERS.UNKNOWN;
  if (age < MIN_ACCOUNT_AGE) return AGE_TIERS.UNDER_15;
  if (age < JOB_VACANCY_MIN_AGE) return AGE_TIERS.MINOR;
  if (age <= SPES_MAX_AGE) return AGE_TIERS.ADULT;
  return AGE_TIERS.SENIOR;
};

// 15 and older may browse jobs; unknown DOB fails closed.
export const canViewJobs = (dateOfBirth, now) => {
  const age = getAgeFromDate(dateOfBirth, now);
  return age !== null && age >= MIN_ACCOUNT_AGE;
};

// Applying to regular job vacancies needs 18+.
export const isJobVacancyEligibleAge = (dateOfBirth, now) => {
  const age = getAgeFromDate(dateOfBirth, now);
  return age !== null && age >= JOB_VACANCY_MIN_AGE;
};

// SPES: 15 to 30 at the time of application.
export const isSpesEligibleAge = (dateOfBirth, now) => {
  const age = getAgeFromDate(dateOfBirth, now);
  return age !== null && age >= SPES_MIN_AGE && age <= SPES_MAX_AGE;
};

// Client-side pre-check for a date typed into a form. Returns an error code or null.
export const checkDobInput = (value, now = new Date()) => {
  if (!value) return "DOB_REQUIRED";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return "DOB_INVALID";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    return "DOB_INVALID";
  }
  if (Number(m[1]) < 1900) return "DOB_INVALID";
  const age = getAgeFromDate(value, now);
  if (age === null) return "DOB_INVALID";
  if (age < MIN_ACCOUNT_AGE) return "AGE_UNDER_MINIMUM";
  return null;
};

// 15 or older: the minimum to hold an account. Unknown DOB fails closed.
export const meetsMinimumAccountAge = (dateOfBirth, now) => {
  const age = getAgeFromDate(dateOfBirth, now);
  return age !== null && age >= MIN_ACCOUNT_AGE;
};
