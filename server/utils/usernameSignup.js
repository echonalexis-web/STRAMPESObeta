// Feature flag and small shared helpers for username-only jobseeker sign-up.
// Read at call time (not import time) so tests and a restart-free env change
// behave the same way.

const PEPPER_ENV = "EMAIL_CODE_PEPPER";
const PEPPER_MIN_LENGTH = 32;

const isUsernameSignupEnabled = () => String(process.env.USERNAME_SIGNUP_ENABLED || "").trim().toLowerCase() === "true";

// `email` only ever holds a proven address (an unverified one lives in
// pendingEmail). Legacy accounts have `isEmailVerified === undefined`, which
// login() already treats as verified, so only a literal `false` counts as
// unverified.
const hasVerifiedEmail = (user) => Boolean(user && user.email) && user.isEmailVerified !== false;

// Server secret mixed into every email-code hash (and, later, the sign-up form
// token). Never log it, never print it.
const getEmailCodePepper = () => {
  const value = process.env[PEPPER_ENV] || "";
  if (value.length < PEPPER_MIN_LENGTH) {
    throw new Error(`${PEPPER_ENV} is missing or shorter than ${PEPPER_MIN_LENGTH} characters.`);
  }
  return value;
};

// Startup check. With the flag off nothing is required. With it on, the
// server must not start without a usable pepper: a code hashed with an empty
// or short secret would be trivially brute-forceable. The message names the
// variable and NEVER includes its value.
const assertUsernameSignupConfig = (env = process.env) => {
  const enabled = String(env.USERNAME_SIGNUP_ENABLED || "").trim().toLowerCase() === "true";
  if (!enabled) return;
  const value = env[PEPPER_ENV] || "";
  if (value.length < PEPPER_MIN_LENGTH) {
    throw new Error(
      `USERNAME_SIGNUP_ENABLED is on but ${PEPPER_ENV} is missing or shorter than ${PEPPER_MIN_LENGTH} characters. ` +
        `Set ${PEPPER_ENV} to a random string of at least ${PEPPER_MIN_LENGTH} characters, or turn the flag off.`
    );
  }
};

module.exports = {
  PEPPER_ENV,
  PEPPER_MIN_LENGTH,
  isUsernameSignupEnabled,
  hasVerifiedEmail,
  getEmailCodePepper,
  assertUsernameSignupConfig,
};
