import { useState, useEffect, useRef } from 'react';

// `key` must be unique per account (e.g. include the current user's id) for
// any state that holds personal data — localStorage is shared by every
// account that ever signs into this browser, not just the current session,
// so a key like "jobseekerOnboarding" with no user segment lets one
// account's draft (form fields, wizard step) leak straight into whichever
// different account next lands on that page. Pass `null`/`undefined` as the
// key while the current user isn't known yet (e.g. still loading from
// AuthContext) — the hook then behaves like plain useState and persists
// nothing until a real per-user key is available.
export function usePersistentState(key, initialState) {
  const readInitial = (forKey) => {
    if (!forKey) return typeof initialState === 'function' ? initialState() : initialState;
    try {
      const stored = localStorage.getItem(forKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Ensure the parsed value is an object (if it's expected to be)
        // If it's not an object, or it's null, return the initial state
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          console.warn(`Invalid stored data for key "${forKey}". Resetting.`);
          localStorage.removeItem(forKey);
          return typeof initialState === 'function' ? initialState() : initialState;
        }
        // If it's an object but empty, we might still want to use it? We'll trust it.
        return parsed;
      }
    } catch (e) {
      console.warn(`Failed to parse stored data for key "${forKey}":`, e);
      localStorage.removeItem(forKey);
    }
    return typeof initialState === 'function' ? initialState() : initialState;
  };

  const [state, setState] = useState(() => readInitial(key));
  const previousKeyRef = useRef(key);

  // If the key itself changes — most commonly because it was null while the
  // current user was still loading and just resolved to a real per-user
  // key, or a different account signed in on the same tab — reload from
  // that new key instead of continuing to show whatever was loaded under
  // the old one. Without this, the *first* key a render happened to compute
  // wins for the lifetime of the component, which is exactly how a generic
  // placeholder key or a stale account's key could keep being shown.
  useEffect(() => {
    if (previousKeyRef.current === key) return;
    previousKeyRef.current = key;
    setState(readInitial(key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch (e) {
      console.warn(`Failed to persist state for key "${key}":`, e);
    }
  }, [key, state]);

  const clearState = () => {
    if (key) localStorage.removeItem(key);
    setState(typeof initialState === 'function' ? initialState() : initialState);
  };

  return [state, setState, clearState];
}
