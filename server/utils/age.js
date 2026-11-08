// Age rules for STRAM PESO. The server is the source of truth: every guarded
// request recomputes the age from the stored date of birth, in the Asia/Manila
// civil calendar. Nothing here is cached in a token or a client store, so a
// 17-year-old unlocks automatically on the 18th birthday.
//
// Tiers (by whole years):
//   under15      -> may not hold an account
//   minor15to17  -> may sign in and view jobs; may apply only to SPES
//   adult18to30  -> all core features
//   adult31plus  -> all core features, but not new SPES applications
//   unknown      -> no usable date of birth (fails closed on guarded actions)

const MANILA_TZ = "Asia/Manila";

// Minimum age to hold a STRAM PESO account (SPES applicants may be 15-30).
const MIN_ACCOUNT_AGE = 15;
const SPES_MIN_AGE = 15;
const SPES_MAX_AGE = 30;
const JOB_VACANCY_MIN_AGE = 18;
const EARLIEST_DOB_YEAR = 1900;

const TIERS = Object.freeze({
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
const getManilaToday = (now = new Date()) => {
  const parts = {};
  for (const p of manilaFormatter.formatToParts(now)) parts[p.type] = p.value;
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
};

// A date of birth is a calendar date. It is stored as UTC midnight of that
// date, so it is read back through its UTC components (never local time).
const getDobParts = (dateOfBirth) => {
  if (!dateOfBirth) return null;
  const dob = dateOfBirth instanceof Date ? dateOfBirth : new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  return { year: dob.getUTCFullYear(), month: dob.getUTCMonth() + 1, day: dob.getUTCDate() };
};

const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// Whole years between the date of birth and today (Manila). Returns null for
// a missing, unparseable, or future date. On the birthday itself the new age
// applies. A Feb 29 birthday is reached on Mar 1 in non-leap years.
const getAgeFromDate = (dateOfBirth, now = new Date()) => {
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

const getAgeTier = (dateOfBirth, now = new Date()) => {
  const age = getAgeFromDate(dateOfBirth, now);
  if (age === null) return TIERS.UNKNOWN;
  if (age < MIN_ACCOUNT_AGE) return TIERS.UNDER_15;
  if (age < JOB_VACANCY_MIN_AGE) return TIERS.MINOR;
  if (age <= SPES_MAX_AGE) return TIERS.ADULT;
  return TIERS.SENIOR;
};

const isAdultAge = (dateOfBirth, now) => {
  const age = getAgeFromDate(dateOfBirth, now);
  return age !== null && age >= MIN_ACCOUNT_AGE;
};

// SPES: ages 15-30 at the time of application. Unknown DOB fails closed.
const isSpesEligibleAge = (dateOfBirth, now) => {
  const age = getAgeFromDate(dateOfBirth, now);
  return age !== null && age >= SPES_MIN_AGE && age <= SPES_MAX_AGE;
};

// Applying to regular job vacancies needs 18+. Viewing needs only an account.
const isJobVacancyEligibleAge = (dateOfBirth, now) => {
  const age = getAgeFromDate(dateOfBirth, now);
  return age !== null && age >= JOB_VACANCY_MIN_AGE;
};

// Parses a strict YYYY-MM-DD string into a Date at UTC midnight. Rejects
// impossible dates such as 2023-02-30. Returns null when invalid.
const parseDateOnly = (value) => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$/.exec(value.trim());
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d;
};

// Validates a user-supplied date of birth for registration. Never logs or
// echoes the value. Returns { ok: true, date, tier } or { ok: false, code }.
//   DOB_REQUIRED       missing
//   DOB_INVALID        malformed, impossible, future, or before 1900
//   AGE_UNDER_MINIMUM  younger than 15
const validateDobInput = (value, now = new Date()) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return { ok: false, code: "DOB_REQUIRED" };
  }
  const date = parseDateOnly(value);
  if (!date || date.getUTCFullYear() < EARLIEST_DOB_YEAR) return { ok: false, code: "DOB_INVALID" };
  const age = getAgeFromDate(date, now);
  if (age === null) return { ok: false, code: "DOB_INVALID" };
  if (age < MIN_ACCOUNT_AGE) return { ok: false, code: "AGE_UNDER_MINIMUM" };
  return { ok: true, date, tier: getAgeTier(date, now) };
};

module.exports = {
  MANILA_TZ,
  MIN_ACCOUNT_AGE,
  SPES_MIN_AGE,
  SPES_MAX_AGE,
  JOB_VACANCY_MIN_AGE,
  TIERS,
  getManilaToday,
  getAgeFromDate,
  getAgeTier,
  isAdultAge,
  isSpesEligibleAge,
  isJobVacancyEligibleAge,
  parseDateOnly,
  validateDobInput,
};
