import { useCallback, useEffect, useState } from "react";

const EVENT_NAME = "navbarstylechange";
const VALID_STYLES = ["full", "icons"];

const storageKey = (userId) => (userId ? `navbarStyle_${userId}` : null);

const readStyle = (userId) => {
  const key = storageKey(userId);
  if (!key) return "full";
  try {
    const stored = localStorage.getItem(key);
    return VALID_STYLES.includes(stored) ? stored : "full";
  } catch {
    return "full";
  }
};

// Per-user "full" vs "icons" sidebar preference, shared between Settings
// (where it's changed) and Navbar (where it's applied) even though both are
// mounted at the same time. Plain localStorage isn't enough for that — a
// write in one component doesn't re-render a sibling that already read the
// old value — so changes are also broadcast via a same-tab custom event that
// every instance of this hook listens for.
export function useNavbarStylePreference(userId) {
  const [style, setStyleState] = useState(() => readStyle(userId));

  useEffect(() => {
    setStyleState(readStyle(userId));
  }, [userId]);

  useEffect(() => {
    const onChange = (event) => {
      if (event.detail?.userId !== (userId || null)) return;
      setStyleState(event.detail.style);
    };
    window.addEventListener(EVENT_NAME, onChange);
    return () => window.removeEventListener(EVENT_NAME, onChange);
  }, [userId]);

  const setStyle = useCallback(
    (next) => {
      const value = VALID_STYLES.includes(next) ? next : "full";
      setStyleState(value);
      const key = storageKey(userId);
      if (key) {
        try {
          localStorage.setItem(key, value);
        } catch {
          /* storage unavailable — preference stays in-memory for this tab */
        }
      }
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { userId: userId || null, style: value } }));
    },
    [userId]
  );

  return [style, setStyle];
}
