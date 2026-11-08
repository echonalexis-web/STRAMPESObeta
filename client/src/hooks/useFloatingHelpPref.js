import { useSyncExternalStore } from 'react';
import { readFloatingHelp, subscribeFloatingHelp, writeFloatingHelp } from '../utils/floatingHelpPref.js';

// [enabled, setEnabled]. Every component using this re-renders together, so
// the widget and both Settings toggles can never disagree.
export function useFloatingHelpPref() {
  const enabled = useSyncExternalStore(subscribeFloatingHelp, readFloatingHelp, () => true);
  return [enabled, writeFloatingHelp];
}
