const { hasVerifiedEmail } = require("../utils/usernameSignup");

// Jobseeker-type roles are the only ones this applies to; employers, admins
// and superadmins pass untouched.
const JOBSEEKER_ROLES = ["jobseeker", "employee", "resident"];

const deny = (res) =>
  res.status(403).json({
    code: "EMAIL_REQUIRED",
    message: "Add and verify your email to do this.",
  });

// Needs `email` and `isEmailVerified` on req.user (verifyToken loads them).
// Place it AFTER the age gate so an under-age user still gets the age error.
// Legacy accounts (isEmailVerified undefined, email present) pass. It does not
// depend on USERNAME_SIGNUP_ENABLED: it only restricts, and only accounts with
// no verified email are affected.
const requireVerifiedEmail = (req, res, next) => {
  if (!req.user || !JOBSEEKER_ROLES.includes(req.user.role)) return next();
  if (hasVerifiedEmail(req.user)) return next();
  return deny(res);
};

// For profile endpoints that mix text fields (allowed) and file fields
// (gated). Place it after multer has parsed the request and before the
// handler that stores files. With memory storage nothing has been persisted
// yet, so refusing here leaves nothing behind.
const requireVerifiedEmailForFiles = (req, res, next) => {
  const hasFiles =
    Boolean(req.file) ||
    (Array.isArray(req.files) ? req.files.length > 0 : Object.values(req.files || {}).some((list) => list && list.length));
  if (!hasFiles) return next();
  return requireVerifiedEmail(req, res, next);
};

module.exports = { requireVerifiedEmail, requireVerifiedEmailForFiles };
