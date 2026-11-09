// Pure helpers for the profile hover card (COVER_PHOTO_PLAN.md section 18): a small
// in-memory cache with expiry and in-flight de-duplication, the hover/focus timer
// logic, and the pointer capability check. No React and no network, so each piece
// is tested with node --test.

export const OPEN_DELAY_MS = 400;
export const CLOSE_DELAY_MS = 150;
export const CACHE_TTL_MS = 120 * 1000;
export const CACHE_MAX_ENTRIES = 100;

export const HOVER_QUERY = "(hover: hover) and (pointer: fine)";

// True only on devices with a real hovering pointer. Never on touch.
export const supportsHoverCards = (win = typeof window !== "undefined" ? window : null) => {
  try {
    return Boolean(win && typeof win.matchMedia === "function" && win.matchMedia(HOVER_QUERY).matches);
  } catch {
    return false;
  }
};

// Entries live `ttlMs`; at most `max` are kept (oldest evicted first). A request
// already in flight for an id is shared instead of started twice.
export const createSummaryCache = ({ max = CACHE_MAX_ENTRIES, ttlMs = CACHE_TTL_MS, now = () => Date.now() } = {}) => {
  const entries = new Map(); // id -> { value, expiresAt }
  const inFlight = new Map(); // id -> { promise, controller }

  const get = (id) => {
    const entry = entries.get(id);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      entries.delete(id);
      return undefined;
    }
    return entry.value;
  };

  const set = (id, value) => {
    entries.delete(id); // re-insert so it counts as the newest
    entries.set(id, { value, expiresAt: now() + ttlMs });
    while (entries.size > max) {
      const oldest = entries.keys().next().value;
      entries.delete(oldest);
    }
  };

  // load(controller) must return a promise for the value. Concurrent callers for
  // the same id share one request. Values (including "unavailable" answers) are cached.
  const fetch = (id, load) => {
    const cached = get(id);
    if (cached !== undefined) return { promise: Promise.resolve(cached), cancel: () => {}, cached: true };
    const existing = inFlight.get(id);
    if (existing) return { promise: existing.promise, cancel: () => existing.cancel(), cached: false };

    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const promise = Promise.resolve()
      .then(() => {
        // Cancelled before the request even started: reject now, load nothing.
        if (controller?.signal.aborted) {
          const error = new Error("aborted");
          error.name = "AbortError";
          throw error;
        }
        return load(controller);
      })
      .then((value) => {
        if (value !== undefined) set(id, value);
        return value;
      })
      .finally(() => {
        if (inFlight.get(id) === record) inFlight.delete(id);
      });
    const record = {
      promise,
      cancel: () => {
        // Drop it first so a later fetch (a StrictMode re-mount, a new hover)
        // starts a fresh request instead of joining the aborted one.
        if (inFlight.get(id) === record) inFlight.delete(id);
        controller?.abort();
      },
    };
    inFlight.set(id, record);
    return { promise, cancel: record.cancel, cached: false };
  };

  return {
    get,
    set,
    fetch,
    delete: (id) => entries.delete(id),
    clear: () => {
      entries.clear();
      inFlight.clear();
    },
    size: () => entries.size,
    inFlightCount: () => inFlight.size,
  };
};

// Hover and focus intent. A trigger opens the card after `openDelay` of hover, or
// at once on keyboard focus; leaving schedules a close after `closeDelay` so the
// pointer can cross into the card. Entering another trigger cancels the first
// one's timers.
export const createHoverController = ({
  openDelay = OPEN_DELAY_MS,
  closeDelay = CLOSE_DELAY_MS,
  onOpen,
  onClose,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) => {
  let openTimer = null;
  let closeTimer = null;
  let pendingKey = null;
  let openKey = null;

  const clearOpen = () => {
    if (openTimer !== null) clearTimer(openTimer);
    openTimer = null;
    pendingKey = null;
  };
  const clearClose = () => {
    if (closeTimer !== null) clearTimer(closeTimer);
    closeTimer = null;
  };
  const doOpen = (key) => {
    clearOpen();
    openKey = key;
    onOpen?.(key);
  };
  const doClose = () => {
    clearClose();
    if (openKey === null) return;
    const key = openKey;
    openKey = null;
    onClose?.(key);
  };

  return {
    // Pointer entered a trigger.
    enter(key) {
      clearClose();
      if (openKey === key) return;
      if (pendingKey === key) return;
      clearOpen();
      pendingKey = key;
      openTimer = setTimer(() => doOpen(key), openDelay);
    },
    // Keyboard focus: open immediately, never steals focus.
    focus(key) {
      clearClose();
      if (openKey === key) return;
      doOpen(key);
    },
    // Pointer left a trigger (or blurred).
    leave() {
      clearOpen();
      if (openKey === null) return;
      clearClose();
      closeTimer = setTimer(doClose, closeDelay);
    },
    // Pointer entered or left the card itself.
    cardEnter() {
      clearClose();
    },
    cardLeave() {
      if (openKey === null) return;
      clearClose();
      closeTimer = setTimer(doClose, closeDelay);
    },
    // Escape, route change, unmount.
    closeNow() {
      clearOpen();
      doClose();
    },
    isOpen: () => openKey !== null,
    current: () => openKey,
  };
};

// Only one hover card is open at a time: a card registers its close function when
// it opens, which closes whichever card was open before.
let activeClose = null;
export const activateCard = (close) => {
  if (activeClose && activeClose !== close) activeClose();
  activeClose = close;
};
export const deactivateCard = (close) => {
  if (activeClose === close) activeClose = null;
};
