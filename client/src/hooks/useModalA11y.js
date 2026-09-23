import { useEffect } from "react";

// Standard modal keyboard behavior, shared across every modal in the app:
// Escape closes it, and Tab/Shift+Tab cycles focus only within the modal
// instead of escaping into the page behind it. Moves focus to the first
// focusable element inside on open. Extracted from AppModal.jsx, which
// already implemented this correctly — other modals (EmployerModal, the job
// details Modal) were missing it entirely.
export function useModalA11y(isOpen, onClose, containerRef) {
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;

    const root = containerRef.current;
    const focusable = root.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    if (focusable.length > 0) {
      focusable[0].focus();
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab") return;
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, containerRef]);
}
