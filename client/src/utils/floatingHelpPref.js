// Single source of truth for "show the floating PESO Help button".
//
// One localStorage key, global to the browser (not per user) so it also
// applies on logged-out pages. Default is ON. Everything is wrapped in
// try/catch: when storage is blocked the value lives in memory for this page
// view and the app keeps working. Changes are broadcast to this tab (custom
// event) and to other tabs (the native `storage` event).
export const FLOATING_HELP_KEY = 'pesoHelpFloating';
export const FLOATING_HELP_EVENT = 'peso-help-floating-change';

let memory = null; // only set when a write to storage failed

function defaultStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readFloatingHelp(storage = defaultStorage()) {
  try {
    const value = storage ? storage.getItem(FLOATING_HELP_KEY) : null;
    if (value === 'off') return false;
    if (value === 'on') return true;
  } catch {
    /* storage unavailable: fall through to the in-memory value */
  }
  return memory ?? true;
}

export function writeFloatingHelp(enabled, storage = defaultStorage()) {
  const value = Boolean(enabled);
  memory = null;
  try {
    if (!storage) throw new Error('no storage');
    storage.setItem(FLOATING_HELP_KEY, value ? 'on' : 'off');
  } catch {
    memory = value;
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(FLOATING_HELP_EVENT));
  }
  return value;
}

export function subscribeFloatingHelp(onChange) {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event) => {
    if (event.key === null || event.key === FLOATING_HELP_KEY) onChange();
  };
  window.addEventListener(FLOATING_HELP_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(FLOATING_HELP_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

// Test helper: forget the in-memory fallback.
export function resetFloatingHelpMemory() {
  memory = null;
}
