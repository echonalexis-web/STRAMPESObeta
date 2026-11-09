// Add a verified email to a username-only jobseeker account with a six-digit
// code (phase 2). Routes live behind USERNAME_SIGNUP_ENABLED (see authRoutes).
//
// Rules (plan sections 2.4, 3, 3.3, 5):
//  - The first add needs the CURRENT PASSWORD; a wrong one counts toward the
//    same per-account lockout as login.
//  - The request never says whether the address belongs to someone else.
//  - Uniqueness is checked only at verification. A wrong, expired, exhausted
//    or already-used code all get the same answer.
//  - Nothing is merged or linked on an email match.
//  - An unverified address lives in `pendingEmail`; `email` only ever holds a
//    proven one.

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const RateLimitCounter = require("../models/RateLimitCounter");
const { MongoRateLimitStore } = require("../middleware/mongoRateLimitStore");
const { logAuditEvent } = require("../services/auditService");
const { sendEmailCode } = require("../services/mailService");
const loginLock = require("../services/loginLockService");
const emailCode = require("../utils/emailCode");
const { getEmailCodePepper } = require("../utils/usernameSignup");
const { normalizeEmail } = require("../utils/normalizeEmail");
const { sessionUserPayload } = require("../utils/sessionUser");
const { sendError } = require("../utils/sendError");
const logger = require("../utils/logger");

const EMAIL_FORMAT = /^\S+@\S+\.\S+$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const CI = { locale: "en", strength: 2 };

// One answer for every way a code can fail.
const INVALID_CODE_BODY = {
  code: "EMAIL_CODE_INVALID",
  message: "That code did not work. Check it, request a new one, or use a different email.",
};
const PASSWORD_BODY = { code: "PASSWORD_INCORRECT", message: "That password did not work." };

const neutralAudit = (req, userId, action, metadata = {}) =>
  logAuditEvent({
    req,
    actorId: userId,
    actorRole: "jobseeker",
    action,
    targetUserId: userId,
    targetType: "user",
    targetId: String(userId),
    severity: "info",
    metadata,
  }).catch(() => {});

// Per-address daily counter (database-backed, shared across accounts and
// instances). Keyed by a hash of the address, never the address itself.
const addressDailyHits = async (email, model = RateLimitCounter) => {
  const store = new MongoRateLimitStore({ model, name: "email-code-address" });
  store.init({ windowMs: DAY_MS });
  const { totalHits } = await store.increment(emailCode.addressKey(email));
  return totalHits;
};

// ---------- POST /auth/email/add/request ----------
exports.requestAddEmail = async (req, res) => {
  try {
    const target = normalizeEmail(req.body.email);
    const currentPassword = String(req.body.currentPassword || "");

    if (!EMAIL_FORMAT.test(target)) {
      return res.status(400).json({ code: "EMAIL_INVALID", message: "Enter a valid email address." });
    }

    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId).select("+emailCode");
    if (!user) return res.status(404).json({ message: "User not found" });

    // This route is for adding a first email. Someone who already has one uses
    // the existing change-email flow.
    if (user.email) {
      return res.status(400).json({ code: "EMAIL_ALREADY_SET", message: "This account already has an email address." });
    }

    // Password check, sharing the login lockout. While locked, answer exactly
    // like a wrong password (and still pay the bcrypt cost).
    const locked = loginLock.isLocked(user);
    const passwordOk = user.password ? await bcrypt.compare(currentPassword, user.password) : false;
    if (locked || !passwordOk) {
      if (!locked) await loginLock.recordFailure(user, { req });
      return res.status(401).json(PASSWORD_BODY);
    }
    await loginLock.clearLock(user._id);

    // Per-account cooldown and hourly cap, from stored state.
    const now = Date.now();
    const plan = emailCode.planSend(user.emailCode, now);
    if (!plan.ok) {
      return res.status(429).json({
        code: plan.code,
        message: "Please wait before asking for another code.",
        retryAfter: plan.retryAfter,
      });
    }

    // Per-address daily cap across accounts: the code is mailed before we know
    // whether the address belongs to someone else, so cap what one address can
    // be sent. It reveals nothing about any account.
    if ((await addressDailyHits(target)) > emailCode.PER_ADDRESS_DAILY_CAP) {
      return res.status(429).json({
        code: "EMAIL_CODE_LIMIT",
        message: "Too many codes have been requested for this address today.",
        retryAfter: Math.ceil(DAY_MS / 1000),
      });
    }

    const code = emailCode.generateCode();
    const hash = emailCode.hashCode({ pepper: getEmailCodePepper(), userId: String(user._id), target, code });
    const sentAt = new Date(now);

    // Claim the send atomically: only one of two parallel requests can pass the
    // cooldown condition, so a double-click cannot send two codes.
    const claimed = await User.findOneAndUpdate(
      {
        _id: user._id,
        $or: [
          { "emailCode.lastSentAt": { $exists: false } },
          { "emailCode.lastSentAt": { $lte: new Date(now - emailCode.RESEND_COOLDOWN_MS) } },
        ],
      },
      {
        $set: {
          emailCode: {
            hash,
            target,
            expiresAt: new Date(now + emailCode.CODE_TTL_MS),
            attempts: 0,
            lastSentAt: sentAt,
            windowStart: new Date(plan.windowStart),
            sendCount: plan.sendCount,
          },
          pendingEmail: target,
          // Starting the code flow supersedes a half-finished link flow.
          emailChangeToken: null,
          emailChangeExpires: null,
        },
      },
      { new: true, projection: { _id: 1 } }
    );
    if (!claimed) {
      return res.status(429).json({
        code: "EMAIL_CODE_COOLDOWN",
        message: "Please wait before asking for another code.",
        retryAfter: Math.ceil(emailCode.RESEND_COOLDOWN_MS / 1000),
      });
    }

    // Fire and forget: a mail failure must not change the answer (and the
    // answer must never depend on whether the address exists).
    sendEmailCode({
      to: target,
      name: user.name,
      code,
      expiresMinutes: emailCode.CODE_TTL_MS / 60000,
    }).catch((err) => logger.error("Failed to send email code", { userId: String(user._id), error: err.message }));

    await neutralAudit(req, user._id, "auth.email.code_requested", { domain: emailCode.emailDomain(target) });

    return res.status(202).json({
      message: "If that address can receive mail, a 6-digit code is on its way.",
      retryAfter: Math.ceil(emailCode.RESEND_COOLDOWN_MS / 1000),
    });
  } catch (error) {
    sendError(res, error);
  }
};

// ---------- POST /auth/email/add/verify ----------
exports.verifyAddEmail = async (req, res) => {
  try {
    const submitted = emailCode.parseCode(req.body.code);
    const userId = req.user._id || req.user.id;

    // Consume an attempt BEFORE comparing, atomically, so parallel guesses each
    // cost one. Only an account that currently holds a code is touched.
    const user = await User.findOneAndUpdate(
      { _id: userId, "emailCode.hash": { $exists: true } },
      { $inc: { "emailCode.attempts": 1 } },
      { new: true, projection: { emailCode: 1, email: 1 } }
    );

    const stored = user ? pickCode(user.emailCode) : null;
    // attempts already includes this try. No code, an account that already has
    // an email, an expired code, or too many tries: one answer.
    if (!user || user.email || !emailCode.isUsable(stored)) {
      if (user && user.emailCode) await dropCode(user._id);
      return res.status(400).json(INVALID_CODE_BODY);
    }

    const target = stored.target;

    // Always do the uniqueness lookup, so a taken address and a wrong code cost
    // the same.
    const taken = await User.findOne({ email: target, _id: { $ne: user._id } })
      .collation(CI)
      .select("_id");

    const expected = emailCode.hashCode({
      pepper: getEmailCodePepper(),
      userId: String(user._id),
      target,
      code: submitted || "000000",
    });
    const matches = Boolean(submitted) && emailCode.safeEqualHex(expected, stored.hash);

    if (!matches || taken) {
      if (taken || stored.attempts >= emailCode.MAX_ATTEMPTS) await dropCode(user._id);
      await neutralAudit(req, user._id, "auth.email.code_failed", { attempts: stored.attempts });
      return res.status(400).json(INVALID_CODE_BODY);
    }

    // Success. The filter on the stored hash makes the code single-use even
    // under a race; bumping tokenVersion signs every other session out
    // (verifying an email creates a new recovery path).
    let updated;
    try {
      updated = await User.findOneAndUpdate(
        { _id: user._id, "emailCode.hash": stored.hash, email: { $exists: false } },
        {
          $set: { email: target, isEmailVerified: true, emailVerifiedAt: new Date(), pendingEmail: null },
          $unset: { emailCode: 1 },
          $inc: { tokenVersion: 1 },
        },
        { new: true }
      );
    } catch (error) {
      if (error && error.code === 11000) {
        await dropCode(user._id);
        return res.status(400).json(INVALID_CODE_BODY);
      }
      throw error;
    }
    if (!updated) return res.status(400).json(INVALID_CODE_BODY);

    await neutralAudit(req, user._id, "auth.email.verified", { domain: emailCode.emailDomain(target) });

    const token = jwt.sign(
      { id: updated._id, role: updated.role, tokenVersion: updated.tokenVersion },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );
    return res.json({ token, user: sessionUserPayload(updated) });
  } catch (error) {
    sendError(res, error);
  }
};

// Works whether the subdocument is a mongoose subdocument or a plain object.
function pickCode(value) {
  const plain = value && typeof value.toObject === "function" ? value.toObject() : value || {};
  return {
    hash: plain.hash,
    target: plain.target,
    expiresAt: plain.expiresAt,
    attempts: Number(plain.attempts) || 0,
  };
}

// Kills the active code and the pending address it was for.
async function dropCode(userId) {
  try {
    await User.updateOne({ _id: userId }, { $unset: { emailCode: 1 }, $set: { pendingEmail: null } });
  } catch (error) {
    logger.error("Failed to drop email code", { userId: String(userId), error: error.message });
  }
}

exports._internals = { pickCode, dropCode };
