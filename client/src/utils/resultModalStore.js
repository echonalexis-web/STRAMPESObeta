import { createOneShot } from "./oneShot.js";

// State behind the "result modal" shown after an emailed confirmation link.
//
// Privacy rules (do not relax):
//  - The one-time TOKEN lives only inside closures and a Map in this module's
//    memory. It is never put in location.state, sessionStorage, history,
//    the DOM, or any log.
//  - What is persisted (sessionStorage, so a refresh keeps the result) is the
//    opaque request id, the link kind, the email address shown in the
//    message, and the outcome. No token.
//
// `confirmers` maps a kind to an async function ({ token, email }) that calls
// the existing API; `storage` is a Storage-like object (or null).

const STORAGE_KEY = "resultModal.active";

export const RESULT_KINDS = ["recovery-email", "email-change", "email-verification"];

// 'network' = the server did not (or may not have) consumed the token, so a
// retry is safe. Everything else is a definitive answer for this link.
export function classifyError(error) {
  const status = error?.response?.status;
  if (!error?.response || status >= 500 || status === 429) return "network";
  return "token";
}

function newId() {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function safeStorage(storage) {
  return {
    get() {
      try {
        return storage ? storage.getItem(STORAGE_KEY) : null;
      } catch {
        return null;
      }
    },
    set(value) {
      try {
        if (!storage) return;
        if (value == null) storage.removeItem(STORAGE_KEY);
        else storage.setItem(STORAGE_KEY, value);
      } catch {
        /* storage unavailable: the modal still works for this page view */
      }
    },
  };
}

// After a reload the in-flight request and the token are gone. A modal that
// was still loading, or that offered "Try again", cannot honestly keep doing
// so: it falls back to the definitive "can't be used, start again" message.
function restore(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    if (!RESULT_KINDS.includes(value.kind) || typeof value.id !== "string") return null;
    const email = typeof value.email === "string" ? value.email : "";
    if (value.status === "success") {
      return { id: value.id, kind: value.kind, email, status: "success" };
    }
    if (value.status === "failure" && value.failureKind === "invalid") {
      return { id: value.id, kind: value.kind, email, status: "failure", failureKind: "invalid" };
    }
    return { id: value.id, kind: value.kind, email, status: "failure", failureKind: "token" };
  } catch {
    return null;
  }
}

export function createResultStore({ confirmers, storage = null }) {
  const disk = safeStorage(storage);
  const oneShot = createOneShot();
  const idByKey = new Map(); // memory only (key contains the token)
  const retryById = new Map(); // memory only
  const listeners = new Set();
  let state = restore(disk.get());

  function set(next) {
    state = next;
    disk.set(
      next
        ? JSON.stringify({
            id: next.id,
            kind: next.kind,
            email: next.email,
            status: next.status,
            failureKind: next.failureKind,
          })
        : null
    );
    listeners.forEach((listener) => listener());
  }

  function settle(id, promise) {
    promise.then((outcome) => {
      if (!state || state.id !== id) return; // dismissed or replaced meanwhile
      set({ ...state, status: outcome.status, failureKind: outcome.failureKind });
    });
  }

  function start(kind, { token = "", email = "" } = {}) {
    if (!confirmers[kind]) throw new Error(`Unknown confirmation kind: ${kind}`);

    if (!token || !email) {
      // Incomplete link: no request, straight to the failure state.
      const id = newId();
      set({ id, kind, email, status: "failure", failureKind: "invalid" });
      return id;
    }

    const key = [kind, email, token].join("\u0000");
    let id = idByKey.get(key);
    if (!id) {
      id = newId();
      idByKey.set(key, id);
    }
    // A second call for the same link (StrictMode) must not reset a result
    // that has already arrived.
    if (!state || state.id !== id) set({ id, kind, email, status: "loading" });

    const run = () =>
      oneShot.run(key, () =>
        Promise.resolve()
          .then(() => confirmers[kind]({ token, email }))
          .then(
            () => ({ status: "success" }),
            (error) => {
              const failureKind = classifyError(error);
              return { status: "failure", failureKind, retryable: failureKind === "network" };
            }
          )
      );

    retryById.set(id, () => {
      if (!state || state.id !== id) return;
      set({ ...state, status: "loading", failureKind: undefined });
      settle(id, run());
    });
    settle(id, run());
    return id;
  }

  return {
    start,
    retry() {
      const fn = state && retryById.get(state.id);
      if (fn) fn();
    },
    canRetry() {
      return Boolean(state && state.failureKind === "network" && retryById.has(state.id));
    },
    dismiss() {
      set(null);
    },
    getSnapshot() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
