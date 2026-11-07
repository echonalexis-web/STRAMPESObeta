import { useEffect, useLayoutEffect, useRef } from "react";
import "../styles/modal-shell.css";

// Standard modal keyboard behavior, shared across every modal in the app:
// Escape closes it, and Tab/Shift+Tab cycles focus only within the modal
// instead of escaping into the page behind it. Moves focus to the first
// focusable element inside on open. Extracted from AppModal.jsx, which
// already implemented this correctly — other modals (EmployerModal, the job
// details Modal) were missing it entirely.
//
// UI-06 additions (apply to every modal using this hook):
//  - focusable controls are queried live on every Tab, so content that
//    appears after open (e.g. ApplyModal's documents after "Loading...")
//    is reachable and the trap never goes stale;
//  - body scroll is locked while open; the previous inline `overflow` is
//    restored exactly once when the last open modal closes (ref-counted so
//    stacked modals never restore too early or leave it stuck);
//  - focus returns to the element that opened the modal;
//  - only the top-most open modal reacts to Escape/Tab;
//  - `has-modal-open` is toggled on <body> so CSS can react without :has().
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let lockCount = 0;
let savedOverflow = "";
const openStack = [];

function lockBodyScroll() {
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("has-modal-open");
  }
  lockCount += 1;
}

function unlockBodyScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = savedOverflow;
    document.body.classList.remove("has-modal-open");
  }
}

function getFocusable(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter(
    (el) => !el.hidden && el.getClientRects().length > 0
  );
}

export function useModalA11y(isOpen, onClose, containerRef) {
  // Always call the latest onClose without re-running the open/close effect
  // (callers pass inline arrow functions that change every render).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useLayoutEffect(() => {
    if (!isOpen || !containerRef.current) return undefined;

    const root = containerRef.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    lockBodyScroll();
    openStack.push(root);

    const initial = getFocusable(root);
    if (initial.length > 0) {
      initial[0].focus();
    }

    const handleKeyDown = (event) => {
      if (openStack[openStack.length - 1] !== root) return;

      if (event.key === "Escape") {
        onCloseRef.current?.();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = getFocusable(root);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (!root.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const index = openStack.lastIndexOf(root);
      if (index !== -1) openStack.splice(index, 1);
      unlockBodyScroll();
      if (trigger && trigger.isConnected) trigger.focus();
    };
  }, [isOpen, containerRef]);
}
