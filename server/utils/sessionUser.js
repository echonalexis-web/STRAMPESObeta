const { hasVerifiedEmail } = require("./usernameSignup");

// Shape of the user object returned to the client on sign-in. `email` may be
// null (username-only account); `isEmailVerified` is kept for old clients,
// `hasVerifiedEmail` is the truthful flag.
const sessionUserPayload = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email || null,
  username: user.username || null,
  role: user.role,
  verificationStatus: user.verificationStatus,
  isEmailVerified: user.isEmailVerified !== false,
  hasVerifiedEmail: hasVerifiedEmail(user),
  hasCompletedOnboarding: user.hasCompletedOnboarding,
  onboardingComplete: user.onboardingComplete,
  acceptedTermsAt: user.acceptedTermsAt,
  termsVersion: user.termsVersion,
  mustChangePassword: user.mustChangePassword === true,
});

module.exports = { sessionUserPayload };
