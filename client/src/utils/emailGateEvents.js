// Tiny window-event bridge so any screen (banner, Settings, the API interceptor)
// can open the email gate without prop drilling. The gate itself lives in
// components/EmailGate.jsx.

export const EMAIL_GATE_OPEN_EVENT = "emailgate:open";
export const EMAIL_REQUIRED_EVENT = "email:required";

// `step` is optional: "backup" jumps straight to the backup-codes offer.
export const openEmailGate = (step) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EMAIL_GATE_OPEN_EVENT, { detail: { step: typeof step === "string" ? step : undefined } }));
};

// "Skip for now" is a per-viewer convenience only (sessionStorage, never the
// source of truth): the server decides what an email-less account may do. It is
// keyed by user id, so a different account signing in on the same tab is not
// skipped by another person's choice.
const SKIP_KEY = "emailGateSkipped";
const BACKUP_OFFERED_KEY = "emailGateBackupOffered";

const defaultStorage = () => (typeof sessionStorage !== "undefined" ? sessionStorage : null);

const safe = (fn, fallback) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export const readSkipped = (userId, storage = defaultStorage()) =>
  Boolean(userId) && safe(() => storage.getItem(`${SKIP_KEY}:${userId}`) === "1", false);
export const writeSkipped = (userId, storage = defaultStorage()) =>
  userId ? safe(() => storage.setItem(`${SKIP_KEY}:${userId}`, "1"), undefined) : undefined;
export const clearSkipped = (userId, storage = defaultStorage()) =>
  userId ? safe(() => storage.removeItem(`${SKIP_KEY}:${userId}`), undefined) : undefined;

export const readBackupOffered = (userId, storage = defaultStorage()) =>
  Boolean(userId) && safe(() => storage.getItem(`${BACKUP_OFFERED_KEY}:${userId}`) === "1", false);
export const writeBackupOffered = (userId, storage = defaultStorage()) =>
  userId ? safe(() => storage.setItem(`${BACKUP_OFFERED_KEY}:${userId}`, "1"), undefined) : undefined;
