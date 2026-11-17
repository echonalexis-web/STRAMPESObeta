// Pure error model for the shared field error pattern. No React, no DOM.
// Errors are { [fieldName]: { code, params } } where `code` is a key under
// formErrors.* / wizardErrors.* / phoneInput.errors.* (see messageFor).

export const makeError = (key, params) => ({ key, params: params || {} });

// First field of `order` that has an error, or null. `order` is the visual
// order of the form, so focus lands on the first invalid field a person sees.
export const firstInvalidField = (order, errors) => {
  if (!errors) return null;
  for (const name of order || []) {
    if (errors[name]) return name;
  }
  // A field not listed in `order` still counts, after the listed ones.
  const rest = Object.keys(errors).find((name) => errors[name] && !(order || []).includes(name));
  return rest || null;
};

// id / aria props for a control whose field name is `name`. The id equals the
// field name, so focusFirstInvalid can find it.
export const ariaFor = (errors, name) => ({
  id: name,
  "aria-invalid": errors?.[name] ? "true" : undefined,
  "aria-describedby": errors?.[name] ? `${name}-error` : undefined,
});

export const countErrors = (errors) =>
  Object.values(errors || {}).filter(Boolean).length;

// Server code -> client message key. Phone codes map to the phoneInput namespace;
// everything else falls back to errors.codes.<CODE> (see apiErrors.js).
const SERVER_CODE_TO_KEY = {
  PHONE_REQUIRED: "phoneInput.errors.required",
  PHONE_INVALID: "phoneInput.errors.phFormat",
  PHONE_PH_FORMAT: "phoneInput.errors.phFormat",
  PHONE_TOO_SHORT: "phoneInput.errors.tooShort",
  PHONE_TOO_LONG: "phoneInput.errors.tooLong",
  PHONE_BAD_CHARS: "phoneInput.errors.badChars",
  PHONE_WEAK: "phoneInput.errors.weak",
  PHONE_COUNTRY_UNKNOWN: "phoneInput.errors.countryUnknown",
};

// Error entry for a phone problem code (client or server), with its parameters.
export const phoneErrorEntry = (code, params) =>
  makeError(SERVER_CODE_TO_KEY[code] || SERVER_CODE_TO_KEY.PHONE_INVALID, params);

// Reads an axios-style error and returns { field, key, params, message }.
//  (a) { code, field }  -> field-level
//  (b) { code }         -> field from fieldMap[code] when known, else form-level
//  (c) { message } / { errors: [] } with no code -> form-level (field: null).
// Never guesses a field from English text.
export const mapServerError = (err, fieldMap = {}) => {
  const data = err?.response?.data || {};
  const code = data.code || null;
  const field = data.field || (code && fieldMap[code]) || null;
  const key = code ? SERVER_CODE_TO_KEY[code] || `errors.codes.${code}` : null;
  return {
    field,
    code,
    key,
    params: data.params || {},
    message: data.message || (Array.isArray(data.errors) ? data.errors[0] : "") || "",
  };
};

// Message text for an error entry. Order: i18n key, then the server message,
// then the caller's fallback.
// `t` is the i18next translate function; a missing key makes it return the key
// itself, which is how a miss is detected without importing i18n here (keeps
// this file loadable by node --test).
export const messageFor = (entry, t, fallback = "") => {
  if (!entry) return "";
  if (typeof entry === "string") return entry;
  if (entry.key && typeof t === "function") {
    const text = t(entry.key, entry.params || {});
    if (text && text !== entry.key) return text;
  }
  if (entry.message) return entry.message;
  return fallback;
};
