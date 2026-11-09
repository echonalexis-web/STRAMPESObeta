// Signed, stateless form token for username sign-up (anti-bot, no dependency).
// GET /auth/signup-token issues one; POST /auth/register must send it back
// after at least 3 seconds and within 1 hour. It stops drive-by bots that
// post the form instantly or without loading it; it does NOT stop a targeted
// bot (it can fetch a token and wait). The register limiter and the feature
// flag are the other layers.

const crypto = require("crypto");
const { getEmailCodePepper } = require("./usernameSignup");

const MIN_AGE_MS = 3 * 1000;
const MAX_AGE_MS = 60 * 60 * 1000;

// Key derived from the pepper so the pepper itself is never used raw here.
const key = () => crypto.createHmac("sha256", getEmailCodePepper()).update("signup-form-token").digest();

const sign = (issuedAt) => crypto.createHmac("sha256", key()).update(`signup:${issuedAt}`).digest("hex");

const issueToken = (now = Date.now()) => `${now}.${sign(now)}`;

// Returns { ok: true } or { ok: false, reason } where reason is one of
// "missing", "invalid", "too_fast", "expired". Reasons go to the audit log;
// the client only ever sees SIGNUP_REJECTED.
const verifyToken = (token, now = Date.now()) => {
  if (typeof token !== "string" || !token) return { ok: false, reason: "missing" };
  const match = /^(\d{10,16})\.([0-9a-f]{64})$/.exec(token);
  if (!match) return { ok: false, reason: "invalid" };
  const issuedAt = Number(match[1]);
  const expected = Buffer.from(sign(issuedAt), "hex");
  const given = Buffer.from(match[2], "hex");
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    return { ok: false, reason: "invalid" };
  }
  const age = now - issuedAt;
  if (age < 0) return { ok: false, reason: "invalid" };
  if (age < MIN_AGE_MS) return { ok: false, reason: "too_fast" };
  if (age > MAX_AGE_MS) return { ok: false, reason: "expired" };
  return { ok: true };
};

module.exports = { MIN_AGE_MS, MAX_AGE_MS, issueToken, verifyToken };
