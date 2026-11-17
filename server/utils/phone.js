// Phone number format check and parser. FORMAT ONLY: there is no SMS check, so a
// plausible number is not proof the person owns it. client/src/utils/phoneIntl.js
// mirrors this file and both are tested against the same vectors
// (tests/fixtures/phoneVectors.json). The server is the authority.
//
// Storage: new saves use E.164 ("+639171234567"). Old values are still read:
//   09171234567, 9171234567, 639171234567, +639171234567, "0917 123 4567",
//   Philippine landlines with area code (02 8123 4567, 042 123 4567).
//
// Rules (national digits = what is left after the dial code and one leading 0):
//   Philippines (+63)  mobile: exactly 10 digits, first digit 9.
//                      landline (only when allowLandline): area code 2-8, 8-10 digits.
//                      Both reject "weak" numbers (last 8 digits all the same, or an
//                      ascending/descending run such as 23456789).
//   Other countries    dial code from data/phoneCountries.json (longest prefix),
//                      6-13 national digits, dial + national at most 15 digits
//                      (E.164), one leading 0 dropped, not all one repeated digit.
// Letters and symbols other than digits, spaces, dashes and brackets are rejected.

const COUNTRIES = require("../data/phoneCountries.json");

const ALLOWED_CHARS = /^[0-9+\-\s()]+$/;
const PH_DIAL = "63";
const GENERIC_MIN = 6;
const GENERIC_MAX = 13;
const E164_MAX = 15;

// +1 and +7 are shared: prefer these countries when a pasted number is matched.
const PREFERRED_ISO = { 1: "US", 7: "RU" };

const byDial = new Map();
for (const country of COUNTRIES) {
  if (!byDial.has(country.dial)) byDial.set(country.dial, []);
  byDial.get(country.dial).push(country);
}
const pickCountry = (dial) => {
  const list = byDial.get(dial);
  if (!list) return null;
  const preferred = PREFERRED_ISO[dial];
  return list.find((c) => c.iso === preferred) || list[0];
};
const byIso = new Map(COUNTRIES.map((c) => [c.iso, c]));

const hasWeakPattern = (digits) => {
  const tail = digits.slice(-8);
  if (/^(\d)\1+$/.test(tail)) return true; // 00000000, 77777777
  const asc = "01234567890123456789";
  const desc = "98765432109876543210";
  return asc.includes(tail) || desc.includes(tail);
};

const fail = (code, params) => ({ ok: false, code, params: params || {} });

// parsePhone(value, { defaultIso = "PH", allowLandline = true })
// -> { ok:true, e164, iso, dial, national, kind } | { ok:false, code, params }
const parsePhone = (value, options = {}) => {
  const defaultIso = options.defaultIso || "PH";
  const allowLandline = options.allowLandline !== false;
  const text = String(value ?? "").trim();
  if (!text) return fail("PHONE_REQUIRED");
  if (!ALLOWED_CHARS.test(text) || text.lastIndexOf("+") > 0) return fail("PHONE_BAD_CHARS");

  const digits = text.replace(/\D/g, "");
  let country = null;
  let national = digits;

  if (text.startsWith("+")) {
    for (let len = 4; len >= 1; len -= 1) {
      const found = pickCountry(digits.slice(0, len));
      if (found) {
        country = found;
        national = digits.slice(len);
        break;
      }
    }
    if (!country) return fail("PHONE_COUNTRY_UNKNOWN");
  } else {
    country = byIso.get(defaultIso) || byIso.get("PH");
    // A bare 63XXXXXXXXXX (no plus) is an old Philippine format. No Philippine
    // national number starts with 63, so this cannot clash with a real one.
    if (country.dial === PH_DIAL && digits.startsWith(PH_DIAL) && digits.length >= 11) {
      national = digits.slice(PH_DIAL.length);
    }
  }

  if (national.startsWith("0")) national = national.slice(1);

  if (country.dial === PH_DIAL) {
    const isMobile = /^9\d+$/.test(national);
    const isLandline = /^[2-8]\d+$/.test(national);
    if (isMobile) {
      if (national.length < 10) return fail("PHONE_TOO_SHORT", { min: 10 });
      if (national.length > 10) return fail("PHONE_TOO_LONG", { max: 10 });
      if (hasWeakPattern(national)) return fail("PHONE_WEAK");
      return { ok: true, e164: `+${PH_DIAL}${national}`, iso: "PH", dial: PH_DIAL, national, kind: "mobile" };
    }
    if (isLandline && national.length >= 8 && national.length <= 10) {
      if (!allowLandline) return fail("PHONE_PH_FORMAT");
      if (hasWeakPattern(national)) return fail("PHONE_WEAK");
      return { ok: true, e164: `+${PH_DIAL}${national}`, iso: "PH", dial: PH_DIAL, national, kind: "landline" };
    }
    if (!national) return fail("PHONE_REQUIRED");
    if (isLandline) return fail(national.length < 8 ? "PHONE_TOO_SHORT" : "PHONE_TOO_LONG", national.length < 8 ? { min: 8 } : { max: 10 });
    return fail("PHONE_PH_FORMAT");
  }

  // Other countries: generic rule.
  const max = Math.min(GENERIC_MAX, E164_MAX - country.dial.length);
  if (national.length < GENERIC_MIN) return fail("PHONE_TOO_SHORT", { min: GENERIC_MIN });
  if (national.length > max) return fail("PHONE_TOO_LONG", { max });
  if (/^(\d)\1+$/.test(national)) return fail("PHONE_WEAK");
  return { ok: true, e164: `+${country.dial}${national}`, iso: country.iso, dial: country.dial, national, kind: "other" };
};

const toE164 = (value, options) => {
  const parsed = parsePhone(value, options);
  return parsed.ok ? parsed.e164 : null;
};

// Legacy API, kept for existing callers (recovery request, contact share).
// Returns the Philippine national form (09XXXXXXXXX) for +63 numbers, the E.164
// form for other countries, or null when invalid.
const normalizePhone = (value) => {
  const parsed = parsePhone(value);
  if (!parsed.ok) return null;
  return parsed.iso === "PH" ? `0${parsed.national}` : parsed.e164;
};

const isValidPhone = (value) => parsePhone(value).ok;

// "PHONE_REQUIRED" when empty, "PHONE_INVALID" when present but wrong, null when
// fine. Used by the apply guard, onboarding completion and recovery. Landlines
// stay valid here (old accounts may hold one).
const phoneProblem = (value) => {
  if (String(value ?? "").trim() === "") return "PHONE_REQUIRED";
  return isValidPhone(value) ? null : "PHONE_INVALID";
};

// Same check with the specific code, for the save routes.
const phoneProblemDetailed = (value, options) => {
  const parsed = parsePhone(value, options);
  return parsed.ok ? null : { code: parsed.code, params: parsed.params };
};

const PHONE_MESSAGES = {
  PHONE_REQUIRED: "Enter your phone number.",
  PHONE_INVALID: "Enter a valid phone number.",
  PHONE_PH_FORMAT: "Enter a 10-digit mobile number that starts with 9.",
  PHONE_TOO_SHORT: "That phone number is too short.",
  PHONE_TOO_LONG: "That phone number is too long.",
  PHONE_BAD_CHARS: "Use numbers only in the phone number.",
  PHONE_WEAK: "That number does not look real. Check it and try again.",
  PHONE_COUNTRY_UNKNOWN: "Choose a country code from the list.",
};

const phoneMessage = (code) => PHONE_MESSAGES[code] || PHONE_MESSAGES.PHONE_INVALID;

// Jobseekers enter a mobile number; employers and staff may also use a landline.
const allowLandlineForRole = (role) => role !== "jobseeker";

// E.164 when the value parses, otherwise the value as given (so a legacy value
// that does not parse is never lost or blanked by a save that did not touch it).
const canonicalPhone = (value, options) => {
  if (value === undefined || value === null) return value;
  const text = String(value).trim();
  if (!text) return text;
  const parsed = parsePhone(text, options);
  return parsed.ok ? parsed.e164 : text;
};

// Text printed on the NSRP form: Philippine numbers in the national form
// (0912 345 6789), other countries as E.164, anything unparseable as stored.
const nsrpPhone = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const parsed = parsePhone(text);
  if (!parsed.ok) return text;
  if (parsed.iso !== "PH") return parsed.e164;
  const n = parsed.national;
  return parsed.kind === "mobile" ? `0${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}` : `0${n}`;
};

module.exports = {
  nsrpPhone,
  canonicalPhone,
  phoneMessage,
  allowLandlineForRole,
  normalizePhone,
  isValidPhone,
  phoneProblem,
  phoneProblemDetailed,
  parsePhone,
  toE164,
  PHONE_COUNTRIES: COUNTRIES,
};
