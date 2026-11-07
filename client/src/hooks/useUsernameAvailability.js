import { useEffect, useState } from "react";
import { authAPI } from "../services/api";

// Debounced "is this username available?" check against the public,
// rate-limited GET /auth/username-available endpoint — shared by every
// place someone can type/choose a username (registration, onboarding;
// Settings' own editor predates this hook and keeps its own inline copy of
// the same logic, left as-is rather than risk touching already-shipped,
// already-tested code for a purely cosmetic de-duplication).
//
// @param {string} value - the current input value.
// @param {object} [options]
// @param {string} [options.currentValue] - the account's OWN existing
//   username, if any; matching it (case-insensitively) is treated as "same",
//   not "available"/"unavailable" — skips the network call entirely for the
//   common case of "didn't change it".
// @param {boolean} [options.enabled] - set false to disable checking
//   entirely (e.g. the field is hidden or the account can't change it).
// @param {number} [options.delayMs]
// @returns {{status: null|"checking"|"available"|"unavailable"|"same", message: string}}
export function useUsernameAvailability(value, { currentValue = "", enabled = true, delayMs = 450 } = {}) {
  const trimmed = String(value || "").trim();
  const isSame = Boolean(trimmed) && trimmed.toLowerCase() === String(currentValue || "").toLowerCase();
  const shouldCheck = enabled && Boolean(trimmed) && !isSame;

  // The result is tagged with the exact value it was computed for, so a
  // result that resolves AFTER the input has already moved on to a
  // different value never gets shown against that newer value — without
  // this, a fast typist could briefly see a stale "available"/"taken" left
  // over from whatever they typed a moment ago. Every "nothing to check
  // right now" case (disabled, empty, unchanged) is derived during render
  // below rather than written back into state from the effect — the only
  // state write happens from inside the debounce's own async callback,
  // never synchronously in the effect body itself.
  const [checked, setChecked] = useState({ forValue: null, status: null, message: "" });

  useEffect(() => {
    if (!shouldCheck) return undefined;

    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const { data } = await authAPI.checkUsernameAvailable(trimmed);
        if (cancelled) return;
        setChecked(
          data?.available
            ? { forValue: trimmed, status: "available", message: "" }
            : {
                forValue: trimmed,
                status: "unavailable",
                message: data?.reason || "That username is already taken.",
              }
        );
      } catch {
        // A network hiccup or the endpoint's own rate limit — fail quiet
        // rather than block the form; the real check still happens
        // server-side on submit either way.
        if (!cancelled) setChecked({ forValue: trimmed, status: null, message: "" });
      }
    }, delayMs);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [shouldCheck, trimmed, delayMs]);

  if (!enabled || !trimmed) return { status: null, message: "" };
  if (isSame) return { status: "same", message: "" };
  if (checked.forValue === trimmed) return { status: checked.status, message: checked.message };
  return { status: "checking", message: "" };
}
