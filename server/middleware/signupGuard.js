const { isUsernameSignupEnabled } = require("../utils/usernameSignup");
const { verifyToken } = require("../utils/signupToken");
const { logAuditEvent } = require("../services/auditService");

const REJECTED = {
  code: "SIGNUP_REJECTED",
  message: "We could not create the account. Please reload the page and try again.",
};

// Honeypot + signed form token for username-mode sign-up. Runs before body
// validation. Every rejection is the same generic 400 and writes an audit
// event with a reason code only: no username, no date of birth, no name, no
// IP beyond what the audit service already records.
const signupGuard = async (req, res, next) => {
  if (!req.body || req.body.signupMode !== "username" || !isUsernameSignupEnabled()) return next();

  let reason = null;
  if (typeof req.body.website === "string" ? req.body.website.length > 0 : req.body.website != null) {
    reason = "honeypot";
  } else {
    const result = verifyToken(req.body.formToken);
    if (!result.ok) reason = result.reason;
  }
  if (!reason) return next();

  await logAuditEvent({
    req,
    actorId: null,
    actorRole: "anonymous",
    action: "auth.signup.rejected",
    targetType: "user",
    targetId: "",
    severity: "warning",
    metadata: { reason },
  }).catch(() => {});
  return res.status(400).json(REJECTED);
};

module.exports = { signupGuard, REJECTED };
