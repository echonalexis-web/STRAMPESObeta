/**
 * username — validation, normalization and availability for the optional
 * second sign-in identifier (see
 * markdowns/NOTIF_EMAIL_ID_OCR_AND_ACCOUNT_RECOVERY_PLAN.md §3).
 *
 * Every public function here is pure except isAvailable/getChangeCooldown,
 * which hit the DB — kept in one file so authController's login/register/
 * set-username call sites can't drift out of sync on what "a valid
 * username" even means.
 */
const User = require("../models/User");
const ReservedUsername = require("../models/ReservedUsername");

const MIN_LENGTH = 3;
const MAX_LENGTH = 30;
const CHANGE_COOLDOWN_DAYS = 30;

// Names that would be confusing or impersonation-prone if a regular account
// could claim them. Deliberately generous rather than exhaustive — this is
// a UX/trust guard, not the uniqueness mechanism (the DB index is).
const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "superadmin",
  "peso",
  "lmdpeso",
  "strampeso",
  "support",
  "help",
  "security",
  "system",
  "root",
  "null",
  "undefined",
  "me",
  "api",
]);

// First/last character must be a letter or digit (no leading/trailing "."
// or "_"); the body allows "." and "_" too. Length is enforced by the
// {MIN-2,MAX-2} repeat count on the middle segment, not checked separately.
const USERNAME_SHAPE_RE = new RegExp(`^[a-z0-9][a-z0-9._]{${MIN_LENGTH - 2},${MAX_LENGTH - 2}}[a-z0-9]$`);
const DOUBLED_PUNCTUATION_RE = /[._]{2,}/;
const ALL_DIGITS_RE = /^[0-9]+$/;

/**
 * Normalize raw input the same way on every call site: Unicode
 * compatibility-decompose (NFKC — folds e.g. fullwidth Latin letters to
 * their plain ASCII form), trim, lowercase.
 *
 * NFKC is NOT a general homoglyph/confusables defense — it does nothing for
 * look-alikes from an unrelated script (Cyrillic "а" stays a distinct code
 * point from Latin "a"). What actually blocks those is USERNAME_SHAPE_RE
 * below being ASCII-only: anything NFKC doesn't fold into [a-z0-9._] simply
 * fails validation rather than silently normalizing to something else.
 */
const normalize = (raw) => String(raw ?? "").normalize("NFKC").trim().toLowerCase();

/**
 * Format/policy validation only — does not check availability or the
 * change cooldown (see isAvailable / getChangeCooldown for those; they need
 * the DB and a would-be-a-mistake-to-run-on-every-keystroke query).
 * @returns {{ ok: true, normalized: string } | { ok: false, error: string }}
 */
const validateFormat = (raw) => {
  const normalized = normalize(raw);

  if (normalized.length < MIN_LENGTH || normalized.length > MAX_LENGTH) {
    return { ok: false, error: `Username must be ${MIN_LENGTH}-${MAX_LENGTH} characters.` };
  }
  if (normalized.includes("@")) {
    return { ok: false, error: "Username can't contain \"@\" — that would be ambiguous with an email address." };
  }
  if (!USERNAME_SHAPE_RE.test(normalized)) {
    return {
      ok: false,
      error: "Username can only use lowercase letters, numbers, \".\" and \"_\", and can't start or end with \".\" or \"_\".",
    };
  }
  if (DOUBLED_PUNCTUATION_RE.test(normalized)) {
    return { ok: false, error: "Username can't have two \".\" or \"_\" in a row." };
  }
  if (ALL_DIGITS_RE.test(normalized)) {
    return { ok: false, error: "Username can't be all numbers." };
  }
  if (RESERVED_USERNAMES.has(normalized)) {
    return { ok: false, error: "That username is reserved." };
  }

  return { ok: true, normalized };
};

/**
 * Whether `normalized` (already run through validateFormat) is free to
 * claim — not held by another account, and not inside its 90-day
 * release-tombstone window (see models/ReservedUsername.js).
 * @param {string} normalized
 * @param {string|null} excludeUserId - the account's own current username
 *   doesn't count as "taken" when re-checking during its own update.
 */
const isAvailable = async (normalized, excludeUserId = null) => {
  const [takenBy, tombstoned] = await Promise.all([
    User.findOne({ username: normalized, ...(excludeUserId ? { _id: { $ne: excludeUserId } } : {}) })
      .collation({ locale: "en", strength: 2 })
      .select("_id"),
    ReservedUsername.findOne({ username: normalized }).collation({ locale: "en", strength: 2 }).select("_id"),
  ]);
  return !takenBy && !tombstoned;
};

/**
 * @returns {{ ok: true } | { ok: false, nextAllowedAt: Date }}
 */
const getChangeCooldown = (user) => {
  if (!user?.usernameChangedAt) return { ok: true };
  const nextAllowedAt = new Date(user.usernameChangedAt.getTime() + CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  if (nextAllowedAt <= new Date()) return { ok: true };
  return { ok: false, nextAllowedAt };
};

const SUGGESTION_ATTEMPTS = 5;

/**
 * Best-effort: derive an available username candidate from the local part
 * of an email address (e.g. "jane.doe" from "jane.doe@example.com"), for
 * suggesting one at account creation. Returns null — never throws — when
 * nothing short of an exhaustive search would find one; callers must treat
 * null as "leave username unset", not as an error.
 */
const suggestFromEmailLocalPart = async (localPartRaw) => {
  let base = normalize(localPartRaw)
    .replace(/[^a-z0-9._]/g, "")
    .replace(/[._]{2,}/g, "_");
  if (base.length > MAX_LENGTH) base = base.slice(0, MAX_LENGTH);
  if (base.length < MIN_LENGTH) return null;

  for (let attempt = 0; attempt <= SUGGESTION_ATTEMPTS; attempt++) {
    let candidate = base;
    if (attempt > 0) {
      // A short random suffix, not a counter — avoids a predictable
      // "firstname1, firstname2, …" sequence across repeated signups.
      const suffix = String(Math.floor(100 + Math.random() * 900));
      candidate = `${base.slice(0, MAX_LENGTH - suffix.length)}${suffix}`;
    }

    const format = validateFormat(candidate);
    if (!format.ok) continue; // e.g. this particular candidate ended up all-digits or reserved

    // eslint-disable-next-line no-await-in-loop -- sequential by design: stop at the first available candidate
    if (await isAvailable(format.normalized)) return format.normalized;
  }
  return null;
};

module.exports = {
  MIN_LENGTH,
  MAX_LENGTH,
  CHANGE_COOLDOWN_DAYS,
  normalize,
  validateFormat,
  isAvailable,
  getChangeCooldown,
  suggestFromEmailLocalPart,
};
