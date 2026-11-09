// Phone number format check for the inline "add your phone" step at apply time
// and for the phone contact on a PESO recovery request. FORMAT ONLY: no SMS, so
// a plausible number is not proof the person owns it. This mirrors
// server/utils/phone.js; both are tested against the same vectors
// (server/tests/fixtures/phoneVectors.json). The server is the authority.
//
// Accepted (spaces, dashes and brackets are ignored):
//   Philippine mobile: 09XXXXXXXXX, +639XXXXXXXXX, 639XXXXXXXXX, 9XXXXXXXXX
//   Philippine landline with area code: 0 + 2-3 digit area code + number
// Rejected: letters, too short or too long, all-same-digit numbers, runs.

const ALLOWED_CHARS = /^[0-9+\-\s()]+$/;

const hasWeakPattern = (digits) => {
  const tail = digits.slice(-8);
  if (/^(\d)\1+$/.test(tail)) return true;
  const asc = "01234567890123456789";
  const desc = "98765432109876543210";
  return asc.includes(tail) || desc.includes(tail);
};

// Normalized national form (starts with 0) or null when invalid.
export const normalizePhone = (value) => {
  const text = String(value ?? "").trim();
  if (!text || !ALLOWED_CHARS.test(text)) return null;
  let digits = text.replace(/\D/g, "");
  if (digits.length > 13) return null;

  if (text.startsWith("+") && !digits.startsWith("63")) return null;
  if (digits.startsWith("63") && (digits.length === 12 || digits.length === 11)) digits = `0${digits.slice(2)}`;
  else if (/^9\d{9}$/.test(digits)) digits = `0${digits}`;

  const mobile = /^09\d{9}$/.test(digits);
  const landline = /^0[2-8]\d{7,9}$/.test(digits);
  if (!mobile && !landline) return null;
  if (hasWeakPattern(digits)) return null;
  return digits;
};

export const isValidPhone = (value) => normalizePhone(value) !== null;

// "PHONE_REQUIRED" when empty, "PHONE_INVALID" when present but wrong, else null.
export const phoneProblem = (value) => {
  if (String(value ?? "").trim() === "") return "PHONE_REQUIRED";
  return isValidPhone(value) ? null : "PHONE_INVALID";
};
