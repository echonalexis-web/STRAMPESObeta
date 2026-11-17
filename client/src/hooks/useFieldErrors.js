import { useCallback, useState } from "react";
import { firstInvalidField, countErrors } from "../utils/formErrors";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Holds { [field]: errorEntry } for one form, clears an error as soon as the
// person edits that field, and moves focus to the first invalid field.
export function useFieldErrors() {
  const [errors, setErrors] = useState({});

  const setFieldError = useCallback((name, entry) => {
    setErrors((prev) => ({ ...prev, [name]: entry }));
  }, []);

  const clearFieldError = useCallback((name) => {
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const replaceErrors = useCallback((next) => setErrors(next || {}), []);
  const clearAll = useCallback(() => setErrors({}), []);

  // Focuses the control for the first invalid field. Controls are found by id
  // (the field name) or by [name="..."] inside `root` (a form or section).
  const focusFirstInvalid = useCallback((order, nextErrors, root) => {
    const name = firstInvalidField(order, nextErrors);
    if (!name || typeof document === "undefined") return null;
    const scope = root || document;
    const el =
      document.getElementById(name) ||
      scope.querySelector(`[name="${name}"]`) ||
      scope.querySelector(`[data-field="${name}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
      if (typeof el.focus === "function") el.focus({ preventScroll: true });
    }
    return name;
  }, []);

  return {
    errors,
    errorCount: countErrors(errors),
    setFieldError,
    clearFieldError,
    replaceErrors,
    clearAll,
    focusFirstInvalid,
  };
}
