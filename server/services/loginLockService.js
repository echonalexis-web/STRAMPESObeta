// Per-account login lockout (phase 3b). Database-backed and atomic, so it
// works across restarts and instances and parallel guesses cannot skip the
// count. Active only while USERNAME_SIGNUP_ENABLED is on (callers check), and
// only for jobseeker accounts: an attacker must never be able to lock a staff
// account out of its own console.
//
//   5 consecutive failures -> lock 15 min; each further lock level doubles
//   (15, 30, 60) and is capped at 60. A success clears everything.
//
// The login response while locked is byte-identical to a wrong password; see
// authController.login.

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { logAuditEvent } = require("./auditService");
const { notifyAccountLocked } = require("./accountAlertService");
const { isUsernameSignupEnabled } = require("../utils/usernameSignup");
const logger = require("../utils/logger");

const LOCKABLE_ROLES = ["jobseeker", "employee", "resident"];
const isLockable = (user) => isUsernameSignupEnabled() && Boolean(user) && LOCKABLE_ROLES.includes(user.role);

const LOCK_THRESHOLD = 5;
const BASE_LOCK_MINUTES = 15;
const MAX_LOCK_MINUTES = 60;

const lockMinutes = (level) => Math.min(BASE_LOCK_MINUTES * 2 ** Math.max(level - 1, 0), MAX_LOCK_MINUTES);

const isLocked = (user, now = Date.now()) => {
  const until = user?.loginLock?.lockedUntil;
  return Boolean(until) && new Date(until).getTime() > now;
};

// Counts one failed password for `user`. Locks the account when this failure
// is the 5th. Never throws: a bookkeeping failure must not change what the
// caller answers.
const recordFailure = async (user, { req = null, now = new Date() } = {}) => {
  try {
    const doc = await User.findOneAndUpdate(
      { _id: user._id },
      { $inc: { "loginLock.failures": 1 }, $set: { "loginLock.lastFailureAt": now } },
      { new: true, projection: { loginLock: 1 } }
    );
    const failures = doc?.loginLock?.failures || 0;
    // Count only: never the password, never what was typed.
    await logAuditEvent({
      req,
      actorId: null,
      actorRole: "anonymous",
      action: "auth.login.failed",
      targetUserId: user._id,
      targetType: "user",
      targetId: String(user._id),
      severity: "info",
      metadata: { failures },
    }).catch(() => {});
    if (failures < LOCK_THRESHOLD) return { locked: false };

    const level = (doc.loginLock.level || 0) + 1;
    const lockedUntil = new Date(now.getTime() + lockMinutes(level) * 60 * 1000);
    // The filter makes the lock a single winner: only the request that still
    // sees failures >= threshold and no active lock applies it, and it resets
    // the counter in the same write.
    const claimed = await User.findOneAndUpdate(
      {
        _id: user._id,
        "loginLock.failures": { $gte: LOCK_THRESHOLD },
        $or: [{ "loginLock.lockedUntil": { $exists: false } }, { "loginLock.lockedUntil": { $lte: now } }],
      },
      { $set: { "loginLock.failures": 0, "loginLock.lockedUntil": lockedUntil, "loginLock.level": level } },
      { new: true, projection: { _id: 1 } }
    );
    if (claimed) {
      await logAuditEvent({
        req,
        actorId: null,
        actorRole: "anonymous",
        action: "auth.account.locked",
        targetUserId: user._id,
        targetType: "user",
        targetId: String(user._id),
        severity: "warning",
        metadata: { level, minutes: lockMinutes(level) },
      }).catch(() => {});
      await notifyAccountLocked(user._id, req);
    }
    return { locked: Boolean(claimed), level };
  } catch (error) {
    logger.error("Login lock bookkeeping failed", { userId: String(user._id), error: error.message });
    return { locked: false };
  }
};

// Same database write shape as recordFailure but against an id that matches
// nothing, so "unknown username" and "known username" cost the same.
const recordFailureDummy = async () => {
  try {
    await User.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId() },
      { $inc: { "loginLock.failures": 1 }, $set: { "loginLock.lastFailureAt": new Date() } },
      { new: true, projection: { loginLock: 1 } }
    );
  } catch {
    // Equalizing only; nothing to report.
  }
};

// A proven password (or a completed reset) clears the lock and the escalation.
const clearLock = async (userId) => {
  try {
    await User.updateOne({ _id: userId, loginLock: { $exists: true } }, { $unset: { loginLock: 1 } });
  } catch (error) {
    logger.error("Failed to clear login lock", { userId: String(userId), error: error.message });
  }
};

// Checks a password the way login does, so every place that asks for the
// CURRENT password feeds the same per-account counter (changePassword,
// change email, recovery email, deactivate). A stolen session therefore cannot
// use those routes as a free password-guessing oracle. Locked accounts and
// wrong passwords both return false. With the feature flag off, or for a
// non-jobseeker, it is a plain bcrypt comparison.
const checkPasswordWithLock = async (user, plain, { req = null } = {}) => {
  const hash = user && user.password;
  if (!hash) return false;
  if (!isLockable(user)) return bcrypt.compare(String(plain || ""), hash);
  const locked = isLocked(user);
  const ok = await bcrypt.compare(String(plain || ""), hash);
  if (locked) return false;
  if (!ok) {
    await recordFailure(user, { req });
    return false;
  }
  if (user.loginLock) await clearLock(user._id);
  return true;
};

// Admin unlock. Returns true when a lock record existed.
const unlock = async (userId) => {
  const result = await User.updateOne({ _id: userId, loginLock: { $exists: true } }, { $unset: { loginLock: 1 } });
  return Boolean(result && (result.modifiedCount || result.nModified));
};

module.exports = {
  isLockable,
  checkPasswordWithLock,
  unlock,
  LOCK_THRESHOLD,
  BASE_LOCK_MINUTES,
  MAX_LOCK_MINUTES,
  lockMinutes,
  isLocked,
  recordFailure,
  recordFailureDummy,
  clearLock,
};
