// Feature flag and small shared helpers for username-only jobseeker sign-up.
// Read at call time (not import time) so tests and a restart-free env change
// behave the same way.

const isUsernameSignupEnabled = () => String(process.env.USERNAME_SIGNUP_ENABLED || "").trim().toLowerCase() === "true";

// `email` only ever holds a proven address (an unverified one lives in
// pendingEmail). Legacy accounts have `isEmailVerified === undefined`, which
// login() already treats as verified, so only a literal `false` counts as
// unverified.
const hasVerifiedEmail = (user) => Boolean(user && user.email) && user.isEmailVerified !== false;

module.exports = { isUsernameSignupEnabled, hasVerifiedEmail };
