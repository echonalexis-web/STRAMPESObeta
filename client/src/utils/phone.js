// Phone number format check for the inline "add your phone" step at apply time
// and for the phone contact on a PESO recovery request. FORMAT ONLY: no SMS, so
// a plausible number is not proof the person owns it. The parsing lives in
// phoneIntl.js and mirrors server/utils/phone.js; both are tested against the
// same vectors (server/tests/fixtures/phoneVectors.json). The server is the
// authority. These three names are kept for existing callers.

import { parsePhone } from "./phoneIntl.js";

// Philippine numbers come back in the national form (09XXXXXXXXX), other
// countries in E.164, or null when invalid.
export const normalizePhone = (value) => {
  const parsed = parsePhone(value);
  if (!parsed.ok) return null;
  return parsed.iso === "PH" ? `0${parsed.national}` : parsed.e164;
};

export const isValidPhone = (value) => parsePhone(value).ok;

// "PHONE_REQUIRED" when empty, "PHONE_INVALID" when present but wrong, else null.
export const phoneProblem = (value) => {
  if (String(value ?? "").trim() === "") return "PHONE_REQUIRED";
  return isValidPhone(value) ? null : "PHONE_INVALID";
};
