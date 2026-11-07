// Signs/verifies the "unsubscribe from this notification category" link
// carried in every notification email's footer (see mailService.renderEmail
// and notificationService.queueNotificationEmail). No session/auth on that
// link — anyone holding it can flip one category to off for one user — so
// the signature is what stops a guessed userId+category pair from doing
// that; it is NOT used for anything more sensitive than a notification
// preference.
const crypto = require("crypto");

// EMAIL_UNSUB_SECRET is the dedicated secret for this. Falling back to
// JWT_SECRET (always required for the app to run at all) rather than a
// hardcoded literal means an unconfigured deployment still gets a real,
// per-deployment secret instead of a publicly-known one.
const secret = () => process.env.EMAIL_UNSUB_SECRET || process.env.JWT_SECRET || "";

const sign = (userId, category) =>
  crypto.createHmac("sha256", secret()).update(`${userId}:${category}`).digest("hex");

const buildUnsubscribeUrl = ({ baseUrl, userId, category }) => {
  const signature = sign(userId, category);
  const params = new URLSearchParams({ u: String(userId), c: category, s: signature });
  return `${baseUrl}/api/v1/notifications/unsubscribe?${params.toString()}`;
};

// Constant-time compare so this can't be brute-forced a byte at a time via
// response timing.
const verifyUnsubscribeSignature = ({ userId, category, signature }) => {
  if (!userId || !category || !signature) return false;
  const expected = sign(userId, category);
  const expectedBuf = Buffer.from(expected, "utf8");
  const givenBuf = Buffer.from(String(signature), "utf8");
  if (expectedBuf.length !== givenBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, givenBuf);
};

module.exports = { buildUnsubscribeUrl, verifyUnsubscribeSignature };
