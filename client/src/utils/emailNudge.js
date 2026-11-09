// How often the "add an email" prompt and banner may appear. An email is
// optional, so this must be rare: it shows once right after onboarding, and after
// a dismissal it comes back after 14 days, then 45, then 90, and then stops for
// good. "Add email" stays available in Settings and Edit Profile.
//
// The state lives in localStorage PER USER ID and PER DEVICE. It is a convenience
// only, never the source of truth; every read and write is guarded because
// storage can throw (private windows, blocked site data). Pure and
// storage-injected so it is unit-testable.

export const NUDGE_INTERVAL_DAYS = [14, 45, 90];
const DAY_MS = 24 * 60 * 60 * 1000;
const KEY_PREFIX = "strampesoEmailNudge:";

export const EMAIL_PROMPT_OPEN_EVENT = "emailprompt:open";

export const emptyNudge = () => ({ dismissCount: 0, lastDismissedAt: 0, promptSeen: false, backupStepDismissed: false });

const sanitize = (raw) => {
  const base = emptyNudge();
  if (!raw || typeof raw !== "object") return base;
  const count = Number(raw.dismissCount);
  const last = Number(raw.lastDismissedAt);
  return {
    dismissCount: Number.isInteger(count) && count > 0 ? Math.min(count, 99) : 0,
    lastDismissedAt: Number.isFinite(last) && last > 0 ? last : 0,
    promptSeen: raw.promptSeen === true,
    backupStepDismissed: raw.backupStepDismissed === true,
  };
};

// True once the last allowed reappearance has been dismissed.
export const nudgeIsStopped = (state) => sanitize(state).dismissCount > NUDGE_INTERVAL_DAYS.length;

// Whether the prompt/banner may be shown right now.
//   0 dismissals: due (the very first appearance)
//   1, 2, 3 dismissals: due again after 14, 45, 90 days
//   4 or more: never again
export const nudgeIsDue = (state, now = Date.now()) => {
  const s = sanitize(state);
  if (s.dismissCount === 0) return true;
  if (s.dismissCount > NUDGE_INTERVAL_DAYS.length) return false;
  const waitMs = NUDGE_INTERVAL_DAYS[s.dismissCount - 1] * DAY_MS;
  return now >= s.lastDismissedAt + waitMs;
};

const defaultStorage = () => {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
};

export const readNudge = (userId, storage = defaultStorage()) => {
  if (!userId || !storage) return emptyNudge();
  try {
    const text = storage.getItem(`${KEY_PREFIX}${userId}`);
    return text ? sanitize(JSON.parse(text)) : emptyNudge();
  } catch {
    return emptyNudge();
  }
};

export const writeNudge = (userId, state, storage = defaultStorage()) => {
  if (!userId || !storage) return false;
  try {
    storage.setItem(`${KEY_PREFIX}${userId}`, JSON.stringify(sanitize(state)));
    return true;
  } catch {
    return false;
  }
};

const update = (userId, change, storage) => {
  const next = { ...readNudge(userId, storage), ...change };
  writeNudge(userId, next, storage);
  return sanitize(next);
};

// The one-time prompt has been shown.
export const markPromptSeen = (userId, storage) => update(userId, { promptSeen: true }, storage);

// The person dismissed the prompt or the banner: start the next waiting period.
export const recordDismissal = (userId, now = Date.now(), storage) => {
  const current = readNudge(userId, storage);
  return update(userId, { dismissCount: current.dismissCount + 1, lastDismissedAt: now, promptSeen: true }, storage);
};

export const markBackupStepDismissed = (userId, storage) => update(userId, { backupStepDismissed: true }, storage);

// Any screen (banner, Settings, Edit Profile) can ask for the add-email panel to open.
// `step` is optional: "backup" jumps to the backup-codes card.
export const openEmailPrompt = (step) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EMAIL_PROMPT_OPEN_EVENT, { detail: { step: typeof step === "string" ? step : undefined } }));
};
