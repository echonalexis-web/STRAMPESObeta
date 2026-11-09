// One password policy for register, change, reset, set-password and recovery
// set-password. Pure: no database, never logs, never returns the password.
//
// The new rules (blocklist, username, date of birth, 10-character minimum for
// username-only accounts, composition on every flow) are applied only while
// USERNAME_SIGNUP_ENABLED is on, so deploying with the flag off changes no
// existing behavior. Callers use `enforce`, which checks the flag.
//
// One special-character set: the one register already used. It is a superset
// of the one "change password" used, so no password that was valid before is
// rejected for its special character now.

const commonPasswords = require("../data/commonPasswords.json");
const { isUsernameSignupEnabled } = require("./usernameSignup");

const SPECIAL_CHARS = `!@#$%^&*(),.?":{}|<>`;
const SPECIAL_CLASS = /[!@#$%^&*(),.?":{}|<>]/;
const MIN_LENGTH = 8;
const MIN_LENGTH_USERNAME_ONLY = 10;
const MAX_LENGTH = 128;

const COMMON = new Set(commonPasswords.map((p) => String(p).toLowerCase()));

const MESSAGES = {
  PASSWORD_WEAK: "Password must be at least 8 characters with uppercase, lowercase, a number and a special character.",
  PASSWORD_TOO_SHORT_USERNAME_MODE: "Passwords for accounts without an email must be at least 10 characters.",
  PASSWORD_TOO_COMMON: "That password is too common. Choose something harder to guess.",
  PASSWORD_SAME_AS_USERNAME: "Your password cannot be your username or contain it.",
  PASSWORD_SAME_AS_BIRTHDATE: "Your password cannot be your date of birth.",
};

// The forms of a date of birth people actually use as a password.
const dobForms = (dateOfBirth) => {
  let y;
  let m;
  let d;
  if (dateOfBirth instanceof Date && !Number.isNaN(dateOfBirth.getTime())) {
    y = dateOfBirth.getUTCFullYear();
    m = dateOfBirth.getUTCMonth() + 1;
    d = dateOfBirth.getUTCDate();
  } else if (typeof dateOfBirth === "string" && /^\d{4}-\d{2}-\d{2}/.test(dateOfBirth)) {
    [y, m, d] = dateOfBirth.slice(0, 10).split("-").map(Number);
  } else {
    return null;
  }
  const yyyy = String(y).padStart(4, "0");
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return {
    // Equal to any of these is refused (dashed forms only make sense as equality).
    exact: [`${yyyy}-${mm}-${dd}`, `${dd}-${mm}-${yyyy}`, `${mm}-${dd}-${yyyy}`, `${yyyy}${mm}${dd}`, `${dd}${mm}${yyyy}`, `${mm}${dd}${yyyy}`],
    // Containing any of these digit runs is refused too ("Juan01012000!").
    digitRuns: [`${yyyy}${mm}${dd}`, `${dd}${mm}${yyyy}`, `${mm}${dd}${yyyy}`],
  };
};

// "Password1!" -> also try "password", so common words with the usual
// composition tricks are caught.
const commonCandidates = (password) => {
  const lower = password.toLowerCase();
  const stripped = lower.replace(/^[^a-z]+/, "").replace(/[^a-z]+$/, "");
  const noSymbols = lower.replace(/[^a-z0-9]/g, "");
  return new Set([lower, stripped, noSymbols, noSymbols.replace(/\d+$/, "")]);
};

// Returns { ok: true } or { ok: false, code, message }.
//   usernameOnly: the account has no email (10-character minimum applies).
const validatePassword = ({ password, username, dateOfBirth, usernameOnly = false }) => {
  const value = typeof password === "string" ? password : "";
  const fail = (code) => ({ ok: false, code, message: MESSAGES[code] });

  if (value.length > MAX_LENGTH) return fail("PASSWORD_WEAK");

  if (value.length < MIN_LENGTH) return fail("PASSWORD_WEAK");
  if (usernameOnly && value.length < MIN_LENGTH_USERNAME_ONLY) return fail("PASSWORD_TOO_SHORT_USERNAME_MODE");

  const lower = value.toLowerCase();

  const name = typeof username === "string" ? username.trim().toLowerCase() : "";
  if (name && lower.includes(name)) return fail("PASSWORD_SAME_AS_USERNAME");

  const forms = dobForms(dateOfBirth);
  if (forms) {
    if (forms.exact.includes(lower) || forms.digitRuns.some((run) => value.includes(run))) {
      return fail("PASSWORD_SAME_AS_BIRTHDATE");
    }
  }

  for (const candidate of commonCandidates(value)) {
    if (candidate && COMMON.has(candidate)) return fail("PASSWORD_TOO_COMMON");
  }

  const composed = /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && SPECIAL_CLASS.test(value);
  if (!composed) return fail("PASSWORD_WEAK");

  return { ok: true };
};

// Flag-aware entry point for the controllers and validators. With the flag off
// it always says ok: the existing per-flow checks stay exactly as they were.
const enforce = (input) => (isUsernameSignupEnabled() ? validatePassword(input) : { ok: true });

module.exports = {
  SPECIAL_CHARS,
  MIN_LENGTH,
  MIN_LENGTH_USERNAME_ONLY,
  MESSAGES,
  validatePassword,
  enforce,
};
