const { isUsernameSignupEnabled } = require("../utils/usernameSignup");

// Runs before body validation so that, with USERNAME_SIGNUP_ENABLED off, a
// username-mode request is refused with a clear code instead of tripping the
// "valid email required" check. Email-mode requests pass untouched.
const rejectUsernameSignupWhenDisabled = (req, res, next) => {
  if (req.body && req.body.signupMode === "username" && !isUsernameSignupEnabled()) {
    return res.status(403).json({
      code: "SIGNUP_DISABLED",
      message: "Sign-up with a username is not available right now.",
    });
  }
  next();
};

// For routes that only exist while the feature is on (Groups B and C).
const requireUsernameSignupEnabled = (req, res, next) => {
  if (!isUsernameSignupEnabled()) {
    return res.status(404).json({ message: "Not found" });
  }
  next();
};

// Picks a middleware per request from the feature flag.
const flagSwitch = (whenOn, whenOff) => (req, res, next) =>
  (isUsernameSignupEnabled() ? whenOn : whenOff)(req, res, next);

module.exports = { rejectUsernameSignupWhenDisabled, requireUsernameSignupEnabled, flagSwitch };
