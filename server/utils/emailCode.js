// Six-digit email codes for adding an email to a username-only account.
// Pure helpers: no database, no mail. The pepper comes in as an argument.

const crypto = require("crypto");

const CODE_LENGTH = 6;
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
const SENDS_PER_WINDOW = 5;
const SEND_WINDOW_MS = 60 * 60 * 1000;
const PER_ADDRESS_DAILY_CAP = 3;

// CSPRNG, uniform over 000000-999999, zero padded.
const generateCode = () => String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");

// Accepts what a person might paste: spaces and dashes are stripped. Returns
// the six digits, or null when it is not exactly six digits.
const parseCode = (input) => {
  const digits = String(input ?? "").replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
};

// HMAC, never a bare hash: a six-digit code has only a million values, so a
// plain hash is brute-forceable from a database leak. The user id and target
// address are bound in, so a hash cannot be replayed for another account or
// another address.
const hashCode = ({ pepper, userId, target, code }) =>
  crypto.createHmac("sha256", pepper).update(`${userId}:${target}:${code}`).digest("hex");

// Constant-time comparison of two hex digests; false on any length mismatch.
const safeEqualHex = (a, b) => {
  const left = Buffer.from(String(a || ""), "hex");
  const right = Buffer.from(String(b || ""), "hex");
  if (left.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
};

// Decides whether a new code may be sent, from what is stored on the account.
//   state: { lastSentAt, windowStart, sendCount } (any may be missing)
// Returns { ok: true, windowStart, sendCount } (the values to store), or
// { ok: false, code, retryAfter } with retryAfter in whole seconds.
const planSend = (state, now = Date.now()) => {
  const lastSentAt = state?.lastSentAt ? new Date(state.lastSentAt).getTime() : 0;
  if (lastSentAt && now - lastSentAt < RESEND_COOLDOWN_MS) {
    return {
      ok: false,
      code: "EMAIL_CODE_COOLDOWN",
      retryAfter: Math.ceil((RESEND_COOLDOWN_MS - (now - lastSentAt)) / 1000),
    };
  }

  const windowStart = state?.windowStart ? new Date(state.windowStart).getTime() : 0;
  const windowOpen = windowStart && now - windowStart < SEND_WINDOW_MS;
  const sendCount = windowOpen ? Number(state.sendCount) || 0 : 0;
  if (sendCount >= SENDS_PER_WINDOW) {
    return {
      ok: false,
      code: "EMAIL_CODE_LIMIT",
      retryAfter: Math.ceil((windowStart + SEND_WINDOW_MS - now) / 1000),
    };
  }

  return { ok: true, windowStart: windowOpen ? windowStart : now, sendCount: sendCount + 1 };
};

// A stored code is usable only while it has a hash, is unexpired, and has not
// used up its attempts. `attempts` counts the try being evaluated (the
// controller increments before comparing), so the 5th try is still evaluated
// and the 6th is refused.
const isUsable = (emailCode, now = Date.now()) =>
  Boolean(emailCode?.hash) &&
  Boolean(emailCode.expiresAt) &&
  new Date(emailCode.expiresAt).getTime() > now &&
  (Number(emailCode.attempts) || 0) <= MAX_ATTEMPTS;

// Short, non-identifying label for audit logs: the domain only.
const emailDomain = (email) => {
  const at = String(email || "").lastIndexOf("@");
  return at >= 0 ? String(email).slice(at + 1).toLowerCase() : null;
};

// Key for the per-address counter. The address itself is never stored there.
const addressKey = (email) => crypto.createHash("sha256").update(String(email).toLowerCase()).digest("hex");

module.exports = {
  CODE_LENGTH,
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  SENDS_PER_WINDOW,
  SEND_WINDOW_MS,
  PER_ADDRESS_DAILY_CAP,
  generateCode,
  parseCode,
  hashCode,
  safeEqualHex,
  planSend,
  isUsable,
  emailDomain,
  addressKey,
};
