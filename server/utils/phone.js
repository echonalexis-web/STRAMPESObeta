// Phone number format check for the "valid phone before a regular job
// application" rule and for the phone contact on a PESO recovery request.
// FORMAT ONLY: there is no SMS check, so a plausible number is not proof the
// person owns it. client/src/utils/phone.js mirrors this file and both are
// tested against the same vectors.
//
// Accepted (spaces, dashes and brackets are ignored):
//   Philippine mobile: 09XXXXXXXXX, +639XXXXXXXXX, 639XXXXXXXXX, 9XXXXXXXXX
//   Philippine landline with area code: 0 + 2-3 digit area code + number,
//   9 to 11 digits in total, e.g. 02 8123 4567, 042 123 4567
// Rejected: letters, too short or too long, all-same-digit numbers and
// ascending or descending runs.

const ALLOWED_CHARS = /^[0-9+\-\s()]+$/;

const hasWeakPattern = (digits) => {
  const tail = digits.slice(-8);
  if (/^(\d)\1+$/.test(tail)) return true; // 00000000, 77777777
  const asc = "01234567890123456789";
  const desc = "98765432109876543210";
  return asc.includes(tail) || desc.includes(tail);
};

// Returns the normalized national form (starts with 0) or null when invalid.
const normalizePhone = (value) => {
  const text = String(value ?? "").trim();
  if (!text || !ALLOWED_CHARS.test(text)) return null;
  let digits = text.replace(/\D/g, "");
  if (digits.length > 13) return null;

  if (text.startsWith("+") && !digits.startsWith("63")) return null; // only +63 is accepted
  if (digits.startsWith("63") && (digits.length === 12 || digits.length === 11)) digits = `0${digits.slice(2)}`;
  else if (/^9\d{9}$/.test(digits)) digits = `0${digits}`;

  const mobile = /^09\d{9}$/.test(digits);
  const landline = /^0[2-8]\d{7,9}$/.test(digits);
  if (!mobile && !landline) return null;
  if (hasWeakPattern(digits)) return null;
  return digits;
};

const isValidPhone = (value) => normalizePhone(value) !== null;

// "PHONE_REQUIRED" when empty, "PHONE_INVALID" when present but wrong,
// null when fine. Used by the apply guard, onboarding completion and recovery.
const phoneProblem = (value) => {
  if (String(value ?? "").trim() === "") return "PHONE_REQUIRED";
  return isValidPhone(value) ? null : "PHONE_INVALID";
};

module.exports = { normalizePhone, isValidPhone, phoneProblem };
