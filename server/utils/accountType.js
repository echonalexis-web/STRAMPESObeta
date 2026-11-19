// "Basic" vs "protected" accounts, derived (no stored field) in this one place.
//
//   protected  an account with a verified email, so password recovery by email
//              is possible. A confirmed recovery email counts too.
//   basic      a username-only account with no verified email: recovery goes
//              through PESO staff (Account recovery).
//
// `isEmailVerified` has no schema default on purpose (see models/User.js):
// `undefined` is a legacy account whose email predates the check and login()
// lets it in, so only a literal `false` means "not verified".

const hasVerifiedEmail = (user) => {
  if (!user) return false;
  const primary = Boolean(user.email) && user.isEmailVerified !== false;
  const recovery = Boolean(user.recoveryEmail) && Boolean(user.recoveryEmailVerifiedAt);
  return primary || recovery;
};

const getAccountType = (user) => (hasVerifiedEmail(user) ? "protected" : "basic");

module.exports = { hasVerifiedEmail, getAccountType };
