// Phone parsing, typing/paste handling and display for the phone input. FORMAT
// ONLY (no SMS). parsePhone mirrors server/utils/phone.js and both pass the same
// vectors (server/tests/fixtures/phoneVectors.json). The server is the authority.
// See the header of the server file for the rules.

import { PHONE_COUNTRIES, DEFAULT_PHONE_ISO } from "../constants/phoneCountries.js";

const ALLOWED_CHARS = /^[0-9+\-\s()]+$/;
const PH_DIAL = "63";
const GENERIC_MIN = 6;
const GENERIC_MAX = 13;
const E164_MAX = 15;
const PREFERRED_ISO = { 1: "US", 7: "RU" };

const byDial = new Map();
for (const country of PHONE_COUNTRIES) {
  if (!byDial.has(country.dial)) byDial.set(country.dial, []);
  byDial.get(country.dial).push(country);
}
const byIso = new Map(PHONE_COUNTRIES.map((c) => [c.iso, c]));

export const countryByIso = (iso) => byIso.get(iso) || byIso.get(DEFAULT_PHONE_ISO);

const pickCountry = (dial) => {
  const list = byDial.get(dial);
  if (!list) return null;
  const preferred = PREFERRED_ISO[dial];
  return list.find((c) => c.iso === preferred) || list[0];
};

const hasWeakPattern = (digits) => {
  const tail = digits.slice(-8);
  if (/^(\d)\1+$/.test(tail)) return true;
  const asc = "01234567890123456789";
  const desc = "98765432109876543210";
  return asc.includes(tail) || desc.includes(tail);
};

const fail = (code, params) => ({ ok: false, code, params: params || {} });

export const parsePhone = (value, options = {}) => {
  const defaultIso = options.defaultIso || DEFAULT_PHONE_ISO;
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
    country = countryByIso(defaultIso);
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

  const max = Math.min(GENERIC_MAX, E164_MAX - country.dial.length);
  if (national.length < GENERIC_MIN) return fail("PHONE_TOO_SHORT", { min: GENERIC_MIN });
  if (national.length > max) return fail("PHONE_TOO_LONG", { max });
  if (/^(\d)\1+$/.test(national)) return fail("PHONE_WEAK");
  return { ok: true, e164: `+${country.dial}${national}`, iso: country.iso, dial: country.dial, national, kind: "other" };
};

export const toE164 = (value, options) => {
  const parsed = parsePhone(value, options);
  return parsed.ok ? parsed.e164 : null;
};

// ---- typing and paste ----------------------------------------------------

// Longest national length a person may type for a country.
export const maxNationalDigits = (iso, allowLandline = false) => {
  const country = countryByIso(iso);
  if (country.dial === PH_DIAL) return allowLandline ? 10 : 10;
  return Math.min(GENERIC_MAX, E164_MAX - country.dial.length);
};

// What the number box keeps while typing: digits only; for the Philippines a
// leading 0 is ignored (people type 09...); capped to the country's maximum.
export const sanitizeNational = (raw, iso, allowLandline = false) => {
  let digits = String(raw ?? "").replace(/\D/g, "");
  const country = countryByIso(iso);
  if (country.dial === PH_DIAL) digits = digits.replace(/^0+/, "");
  return digits.slice(0, maxNationalDigits(iso, allowLandline));
};

// Interprets a pasted string. A "+<dial>" prefix with a known code switches the
// country. Returns { iso, national, rejected } where rejected is true when the
// text contained letters or symbols that were dropped.
export const interpretPaste = (text, currentIso = DEFAULT_PHONE_ISO, allowLandline = false) => {
  const value = String(text ?? "").trim();
  const rejected = /[^0-9+\-\s()]/.test(value);
  const cleaned = value.replace(/[^0-9+]/g, "");
  const digits = cleaned.replace(/\D/g, "");

  if (cleaned.startsWith("+")) {
    for (let len = 4; len >= 1; len -= 1) {
      const found = pickCountry(digits.slice(0, len));
      if (found) {
        return { iso: found.iso, national: sanitizeNational(digits.slice(len), found.iso, allowLandline), rejected };
      }
    }
    return { iso: currentIso, national: sanitizeNational(digits, currentIso, allowLandline), rejected: true };
  }

  const country = countryByIso(currentIso);
  let national = digits;
  if (country.dial === PH_DIAL && national.startsWith(PH_DIAL) && national.length >= 11) {
    national = national.slice(PH_DIAL.length);
  }
  return { iso: currentIso, national: sanitizeNational(national, currentIso, allowLandline), rejected };
};

// ---- display -------------------------------------------------------------

const group = (digits, sizes) => {
  const parts = [];
  let index = 0;
  for (const size of sizes) {
    if (index >= digits.length) break;
    parts.push(digits.slice(index, index + size));
    index += size;
  }
  if (index < digits.length) parts.push(digits.slice(index));
  return parts.join(" ");
};

// Number box text: Philippines 912 345 6789, others in groups of three.
export const formatNational = (iso, national) => {
  const digits = String(national ?? "");
  if (countryByIso(iso).dial === PH_DIAL) return group(digits, [3, 3, 4]);
  return group(digits, [3, 3, 4]);
};

// Full number for profile pages and lists. Unparseable old values come back
// exactly as stored.
export const formatPhoneDisplay = (stored) => {
  const raw = String(stored ?? "").trim();
  if (!raw) return "";
  const parsed = parsePhone(raw);
  if (!parsed.ok) return raw;
  if (parsed.iso === "PH" && parsed.kind === "mobile") return `+63 ${formatNational("PH", parsed.national)}`;
  return `+${parsed.dial} ${formatNational(parsed.iso, parsed.national)}`;
};

// href value for tel: links; falls back to the stored text.
export const phoneHref = (stored) => {
  const raw = String(stored ?? "").trim();
  if (!raw) return "";
  return toE164(raw) || raw;
};

export const phoneExample = (iso) => (countryByIso(iso).dial === PH_DIAL ? "917 123 4567" : "");

// Initial { iso, national } for the control from a stored value (any format).
export const splitStored = (stored, defaultIso = DEFAULT_PHONE_ISO) => {
  const raw = String(stored ?? "").trim();
  if (!raw) return { iso: defaultIso, national: "" };
  const parsed = parsePhone(raw, { defaultIso });
  if (parsed.ok) return { iso: parsed.iso, national: parsed.national };
  const pasted = interpretPaste(raw, defaultIso, true);
  return { iso: pasted.iso, national: pasted.national };
};

const fold = (text) => String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Country search by name, ISO code or dial code (with or without "+").
export const searchCountries = (query) => {
  const q = fold(query).trim();
  if (!q) return PHONE_COUNTRIES;
  const dialQuery = q.replace(/^\+/, "");
  return PHONE_COUNTRIES.filter((c) => {
    if (fold(c.name).includes(q)) return true;
    if (c.iso.toLowerCase() === q) return true;
    if (/^\d+$/.test(dialQuery) && c.dial.startsWith(dialQuery)) return true;
    return false;
  });
};
