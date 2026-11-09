// Staff-assisted password reset at the PESO office (and "complete in person" for
// a phone-contact recovery request). The temporary password exists only in the
// value this returns: it is never stored in plain text, never logged and never
// written to an audit event.

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { validatePassword } = require("../utils/passwordPolicy");

const JOBSEEKER_ROLES = ["jobseeker", "employee", "resident"];

// No look-alike characters (0 O 1 l I) so it can be read out or copied from a slip.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const SPECIAL = "!@#$%&*?";
const ALL = UPPER + LOWER + DIGITS + SPECIAL;
const LENGTH = 14;

const pick = (chars) => chars[crypto.randomInt(0, chars.length)];

const shuffle = (list) => {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
};

// Always satisfies the shared password policy (checked, not assumed), including
// the longer minimum for accounts with no email, and never contains the username.
const generateTemporaryPassword = ({ username, dateOfBirth } = {}) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SPECIAL)];
    while (chars.length < LENGTH) chars.push(pick(ALL));
    const password = shuffle(chars).join("");
    if (validatePassword({ password, username, dateOfBirth, usernameOnly: true }).ok) return password;
  }
  throw new Error("Could not generate a temporary password");
};

// Resets the password of one jobseeker account. Effects: a new temporary
// password, a forced change at next sign-in, every other session signed out
// (tokenVersion), the lock and any pending email code cleared, and the old
// backup codes invalidated (the person is asked to make new ones).
const applyOfficeReset = async (target, { session } = {}) => {
  const temporaryPassword = generateTemporaryPassword({ username: target.username, dateOfBirth: target.dateOfBirth });
  const hashed = await bcrypt.hash(temporaryPassword, 10);
  const updated = await User.findOneAndUpdate(
    { _id: target._id, role: { $in: JOBSEEKER_ROLES } },
    {
      $set: {
        password: hashed,
        mustChangePassword: true,
        backupCodes: [],
        backupCodesGeneratedAt: null,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
      $unset: { loginLock: 1, emailCode: 1 },
      $inc: { tokenVersion: 1 },
    },
    { new: true, ...(session ? { session } : {}) }
  );
  if (!updated) throw new Error("Account not found for reset");
  return { temporaryPassword, user: updated };
};

module.exports = { JOBSEEKER_ROLES, generateTemporaryPassword, applyOfficeReset };
