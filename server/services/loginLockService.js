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
const User = require("../models/User");
const { logAuditEvent } = require("./auditService");
const logger = require("../utils/logger");

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

module.exports = {
  LOCK_THRESHOLD,
  BASE_LOCK_MINUTES,
  MAX_LOCK_MINUTES,
  lockMinutes,
  isLocked,
  recordFailure,
  recordFailureDummy,
  clearLock,
};
