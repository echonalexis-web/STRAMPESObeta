const { MIN_ACCOUNT_AGE } = require("./age");

// English fallbacks only; the client translates by `code`. Messages never
// include the date of birth itself.
const DOB_ERROR_MESSAGES = {
  DOB_REQUIRED: "Date of birth is required.",
  DOB_INVALID: "Enter a valid date of birth.",
  AGE_UNDER_MINIMUM: `You must be at least ${MIN_ACCOUNT_AGE} years old to create an account.`,
  DOB_LOCKED: "Your date of birth is locked. Contact PESO staff with proof of age to change it.",
};

module.exports = { DOB_ERROR_MESSAGES };
