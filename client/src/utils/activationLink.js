// Reading the one-time token out of a staff activation link. Pure (no React, no
// window access), so it is unit-testable. The emailed link carries the token in
// the URL fragment (#token=...), which browsers never send to a server or in a
// Referer header; a ?token=... query is accepted too. The page removes it from
// the address bar right after reading it (see pages/ActivateAccount.jsx).

// 32 random bytes as 64 lowercase hex characters, exactly what the server issues.
const TOKEN_RE = /^[0-9a-f]{64}$/;

const fromParams = (raw) => {
  const text = String(raw || "").replace(/^[#?]/, "");
  if (!text) return "";
  try {
    return new URLSearchParams(text).get("token") || "";
  } catch {
    return "";
  }
};

// The token from a location's hash or search, or "" when there is none or it
// does not have the shape the server issues (the page then shows the same
// neutral message as any other bad link).
export const extractActivationToken = (hash, search) => {
  const candidate = fromParams(hash) || fromParams(search);
  return TOKEN_RE.test(candidate) ? candidate : "";
};

// Rules the page lists, in order, as keys of the password.* messages. They mirror
// the server's composition rules; the server stays the authority (it also refuses
// common passwords and passwords that contain the start of the email address).
export const ACTIVATION_RULES = ["tooShort", "upper", "lower", "number", "special"];
