// POST /auth/forgot-username (behind USERNAME_SIGNUP_ENABLED).
//
// Always the same neutral 200. The username is mailed ONLY to a verified email
// that belongs to an account; it is never shown on the page and never returned
// in the response. An email-less account has nothing to send to, so this
// route cannot help it (it uses backup codes or PESO recovery instead).
// Address-level cap: 3 per address per day, database-backed.

const User = require("../models/User");
const RateLimitCounter = require("../models/RateLimitCounter");
const { MongoRateLimitStore } = require("../middleware/mongoRateLimitStore");
const { logAuditEvent } = require("../services/auditService");
const { sendUsernameReminder } = require("../services/mailService");
const { hasVerifiedEmail } = require("../utils/usernameSignup");
const { normalizeEmail } = require("../utils/normalizeEmail");
const { addressKey, emailDomain } = require("../utils/emailCode");
const { sendError } = require("../utils/sendError");
const logger = require("../utils/logger");

const NEUTRAL = { message: "If that email belongs to an account, we have sent its username to it." };
const DAY_MS = 24 * 60 * 60 * 1000;
const PER_ADDRESS_DAILY_CAP = 3;
const CI = { locale: "en", strength: 2 };

exports.NEUTRAL = NEUTRAL;

exports.forgotUsername = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      // Same answer for garbage input: nothing here depends on the account.
      return res.json(NEUTRAL);
    }

    // The counter and the lookup run for every well-formed request, so the
    // response time does not tell a known address from an unknown one.
    const store = new MongoRateLimitStore({ model: RateLimitCounter, name: "forgot-username-address" });
    store.init({ windowMs: DAY_MS });
    const { totalHits } = await store.increment(addressKey(email));
    const user = await User.findOne({ email }).collation(CI).select("name username email isEmailVerified role");

    await logAuditEvent({
      req,
      actorId: null,
      actorRole: "anonymous",
      action: "auth.username.forgot_requested",
      targetType: "user",
      targetId: "",
      severity: "info",
      metadata: { domain: emailDomain(email) },
    }).catch(() => {});

    if (totalHits <= PER_ADDRESS_DAILY_CAP && user && user.username && hasVerifiedEmail(user)) {
      sendUsernameReminder({ to: user.email, name: user.name, username: user.username }).catch((error) =>
        logger.error("Failed to send username reminder", { error: error.message })
      );
    }
    return res.json(NEUTRAL);
  } catch (error) {
    sendError(res, error);
  }
};
