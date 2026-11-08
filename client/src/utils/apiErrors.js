import i18n from "../i18n";

// Translates a server error by its stable `code` (errors.codes.<CODE> in the
// locale files). Falls back to the server's English message, then to the
// caller's fallback. Never shows raw status text.
export const translateErrorCode = (code, fallback = "") => {
  if (code) {
    const key = `errors.codes.${code}`;
    if (i18n.exists(key)) return i18n.t(key);
  }
  return fallback;
};

export const apiErrorMessage = (err, fallback = "") => {
  const data = err?.response?.data;
  const translated = translateErrorCode(data?.code, "");
  if (translated) return translated;
  return data?.message || fallback;
};
