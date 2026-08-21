import { useState, useEffect } from 'react';

export function usePersistentState(key, initialState) {
  const [state, setState] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Ensure the parsed value is an object (if it's expected to be)
        // If it's not an object, or it's null, return the initial state
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          console.warn(`Invalid stored data for key "${key}". Resetting.`);
          localStorage.removeItem(key);
          return typeof initialState === 'function' ? initialState() : initialState;
        }
        // If it's an object but empty, we might still want to use it? We'll trust it.
        return parsed;
      }
    } catch (e) {
      console.warn(`Failed to parse stored data for key "${key}":`, e);
      localStorage.removeItem(key);
    }
    return typeof initialState === 'function' ? initialState() : initialState;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch (e) {
      console.warn(`Failed to persist state for key "${key}":`, e);
    }
  }, [key, state]);

  const clearState = () => {
    localStorage.removeItem(key);
    setState(typeof initialState === 'function' ? initialState() : initialState);
  };

  return [state, setState, clearState];
}