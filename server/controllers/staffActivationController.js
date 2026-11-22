/**
 * Public endpoints behind the staff activation link (no session).
 *
 *   POST /auth/activate-account/check   { token }                          -> { valid: true }
 *   POST /auth/activate-account         { token, password, confirmPassword } -> account active
 *
 * An unknown, malformed, expired, used, replaced or revoked token all get the
 * same answer, so nothing here says which one it was or whether an email exists.
 * Activation never signs the person in: they go to the login page afterwards.
 * The token, its hash and the password are never logged, audited or returned.
 */
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const passwordPolicy = require("../utils/passwordPolicy");
const invites = require("../services/staffInviteService");
const { logAuditEvent } = require("../services/auditService");
const { sendError } = require("../utils/sendError");

const INVALID = {
  code: "INVITE_INVALID",
  message: "This activation link is not valid. Ask your superadmin to send a new one.",
};
const TOKEN_RE = /^[0-9a-f]{64}$/;

// The pending account this token belongs to, or null. The token is only ever
// compared as a SHA-256 digest, in constant time.
const findPendingByToken = async (rawToken) => {
  const token = String(rawToken || "").trim();
  if (!TOKEN_RE.test(token)) return null;
  const hash = invites.hashToken(token);
  const user = await User.findOne({
    "staffInvite.tokenHash": hash,
    role: "admin",
    accountStatus: "pending_activation",
    deletedAt: null,
    "staffInvite.status": "pending",
    "staffInvite.expiresAt": { $gt: new Date() },
  }).select("+staffInvite.tokenHash name email");
  if (!user || !invites.sameHash(user.staffInvite && user.staffInvite.tokenHash, hash)) return null;
  return { user, hash };
};

exports.checkActivationToken = async (req, res) => {
  try {
    const found = await findPendingByToken(req.body && req.body.token);
    if (!found) return res.status(400).json(INVALID);
    return res.json({ valid: true });
  } catch (error) {
    return sendError(res, error, "Could not check the activation link");
  }
};

// A password may not contain the part of the email before the "@" (when that part
// is long enough to be meaningful), on top of the shared password rules.
const policyUsername = (email) => {
  const local = String(email || "").split("@")[0].toLowerCase();
  return local.length >= 4 ? local : undefined;
};

exports.activateAccount = async (req, res) => {
  try {
    const body = req.body || {};
    const password = String(body.password || "");
    const confirm = String(body.confirmPassword ?? "");

    const found = await findPendingByToken(body.token);
    if (!found) return res.status(400).json(INVALID);

    if (password !== confirm) {
      return res.status(400).json({ code: "PASSWORD_MISMATCH", message: "The two passwords do not match." });
    }
    // The full password rules always apply here, whatever the sign-up flag says.
    const verdict = passwordPolicy.validatePassword({
      password,
      username: policyUsername(found.user.email),
      usernameOnly: false,
    });
    if (!verdict.ok) return res.status(400).json({ code: verdict.code, message: verdict.message });

    const hashed = await bcrypt.hash(password, 10);
    const now = new Date();
    // One atomic update: only a still-pending, unexpired invite with this exact
    // token hash passes, so a link works once even if two requests race.
    const activated = await User.findOneAndUpdate(
      {
        _id: found.user._id,
        role: "admin",
        accountStatus: "pending_activation",
        deletedAt: null,
        "staffInvite.status": "pending",
        "staffInvite.tokenHash": found.hash,
        "staffInvite.expiresAt": { $gt: now },
      },
      {
        $set: {
          password: hashed,
          isActive: true,
          accountStatus: "active",
          mustChangePassword: false,
          isEmailVerified: true,
          emailVerifiedAt: now,
          passwordResetToken: null,
          passwordResetExpires: null,
          "staffInvite.status": "activated",
          "staffInvite.activatedAt": now,
        },
        $unset: { "staffInvite.tokenHash": "", loginLock: "" },
        // Any token issued before this moment stops working.
        $inc: { tokenVersion: 1 },
      },
      { new: true }
    ).select("name role");
    if (!activated) return res.status(400).json(INVALID);

    await invites.suppressQueuedInvites(activated._id).catch(() => {});
    await logAuditEvent({
      req,
      actorId: activated._id,
      actorRole: "admin",
      action: "staff.account.activated",
      targetUserId: activated._id,
      targetType: "user",
      targetId: String(activated._id),
      severity: "warning",
    });

    // No token, no session: the person signs in from the login page.
    return res.json({ message: "Your account is active. You can now sign in." });
  } catch (error) {
    return sendError(res, error, "Could not activate the account");
  }
};
