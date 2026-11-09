// POST /admin/users/:id/reset-password: PESO staff reset a jobseeker's password
// at the counter after checking a government ID in person. Staff only (admin or
// superadmin, via the admin router guard).
//
// Required: the staff member's own password, a reason (10+ characters), the
// "ID checked" confirmation and the type of ID shown. The temporary password is
// returned ONCE in this response. It is not stored in plain text, not logged and
// not in the audit event.
//
// With USERNAME_SIGNUP_ENABLED off this is reachable only for an account that has
// no email (the people the feature created), so turning the flag off never
// strands them, and nothing new is reachable for ordinary accounts.

const bcrypt = require("bcryptjs");
const User = require("../models/User");
const VALID_GOVERNMENT_ID_TYPES = require("../data/governmentIdTypes");
const { logAuditEvent } = require("../services/auditService");
const { forceLogout } = require("../services/sessionService");
const { applyOfficeReset, JOBSEEKER_ROLES } = require("../services/officeResetService");
const { notifyPasswordResetByStaff } = require("../services/accountAlertService");
const { sendPasswordChangedEmail } = require("../services/mailService");
const { isUsernameSignupEnabled } = require("../utils/usernameSignup");
const { sendError } = require("../utils/sendError");
const logger = require("../utils/logger");

const MIN_REASON = 10;
const MAX_REASON = 2000;

const bad = (res, status, code, message) => res.status(status).json({ code, message });

// Validates the staff-side inputs shared with "complete in person".
// Returns an error body or null.
const checkStaffInputs = ({ reason, idChecked, idTypePresented }) => {
  const text = typeof reason === "string" ? reason.trim() : "";
  if (text.length < MIN_REASON || text.length > MAX_REASON) {
    return { status: 400, code: "RESET_REASON_REQUIRED", message: "Record a reason (10 to 2000 characters)." };
  }
  if (idChecked !== true) {
    return { status: 400, code: "ID_CHECK_REQUIRED", message: "Confirm that you checked the person's ID." };
  }
  if (typeof idTypePresented !== "string" || !VALID_GOVERNMENT_ID_TYPES.includes(idTypePresented)) {
    return { status: 400, code: "ID_TYPE_REQUIRED", message: "Choose the type of ID that was shown." };
  }
  return null;
};

// Staff re-enter their OWN password (same idea as the recovery review).
const verifyStaffPassword = async (req, staffPassword) => {
  const actor = await User.findById(req.user._id || req.user.id).select("password role");
  if (!actor || !actor.password) return null;
  const ok = await bcrypt.compare(String(staffPassword || ""), actor.password);
  return ok ? actor : null;
};

exports.checkStaffInputs = checkStaffInputs;
exports.verifyStaffPassword = verifyStaffPassword;

exports.resetPasswordAtCounter = async (req, res) => {
  try {
    const invalid = checkStaffInputs(req.body || {});
    if (invalid) return bad(res, invalid.status, invalid.code, invalid.message);

    const actor = await verifyStaffPassword(req, req.body.staffPassword);
    if (!actor) return bad(res, 403, "STAFF_PASSWORD_INCORRECT", "Your password is incorrect.");

    const target = await User.findById(req.params.id).select(
      "role isActive username email dateOfBirth staffRecoveryPending name"
    );
    if (!target || !JOBSEEKER_ROLES.includes(target.role)) {
      return bad(res, 404, "NOT_FOUND", "Account not found.");
    }
    // Flag off: only accounts that have no email (see the file header).
    if (!isUsernameSignupEnabled() && target.email) {
      return bad(res, 404, "NOT_FOUND", "Account not found.");
    }
    if (target.isActive === false) {
      return bad(res, 409, "ACCOUNT_INACTIVE", "This account is suspended or deactivated.");
    }
    if (target.staffRecoveryPending) {
      return bad(res, 409, "RECOVERY_PENDING", "A PESO recovery is already in progress for this account.");
    }

    const { temporaryPassword, user } = await applyOfficeReset(target);

    forceLogout(req.app.get("io"), target._id, {
      code: "SESSION_EXPIRED",
      message: "Your password was reset by PESO staff. Please sign in again.",
    });
    void notifyPasswordResetByStaff(target._id, req);
    if (target.email) {
      sendPasswordChangedEmail({ to: target.email, name: target.name }).catch((err) =>
        logger.error("Failed to send staff-reset notice", { userId: String(target._id), error: err.message })
      );
    }

    // The password itself, the ID number and the date of birth are never recorded.
    await logAuditEvent({
      req,
      actorId: actor._id,
      actorRole: req.user.role,
      action: "auth.password.reset_by_staff",
      targetUserId: target._id,
      targetType: "user",
      targetId: String(target._id),
      severity: "critical",
      metadata: { idType: req.body.idTypePresented, reason: req.body.reason.trim() },
    });

    res.set("Cache-Control", "no-store");
    return res.json({ temporaryPassword, mustChangePassword: user.mustChangePassword === true });
  } catch (error) {
    return sendError(res, error, "Could not reset the password");
  }
};
