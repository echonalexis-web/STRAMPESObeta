import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  FaCheckCircle,
  FaExclamationCircle,
  FaInfoCircle,
  FaExclamationTriangle,
  FaTimes,
} from "react-icons/fa";
import { ToastContext, ConfirmContext } from "./context";
import "../../styles/feedback.css";

/*
 * App-wide user feedback: transient toasts and a promise-based confirm dialog.
 * Both are exposed as hooks so any mutation handler can report its outcome
 * without wiring per-page toast state, and window.confirm can be retired.
 *
 *   const toast = useToast();
 *   toast.success("Job deleted.");
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: "Delete this job?", tone: "danger", confirmLabel: "Delete" })) { ... }
 */

let toastSeq = 0;

const TOAST_ICON = {
  success: FaCheckCircle,
  error: FaExclamationCircle,
  info: FaInfoCircle,
};

function ToastItem({ toast, onClose }) {
  const Icon = TOAST_ICON[toast.type] || FaInfoCircle;
  return (
    <div className={`fb-toast fb-toast--${toast.type}`} role="status" aria-live="polite">
      <Icon className="fb-toast__icon" aria-hidden="true" />
      <p className="fb-toast__msg">{toast.message}</p>
      <button type="button" className="fb-toast__close" onClick={onClose} aria-label="Dismiss">
        <FaTimes aria-hidden="true" />
      </button>
    </div>
  );
}

function ConfirmDialog({ dialog, onConfirm, onCancel }) {
  const confirmRef = useRef(null);
  const cancelRef = useRef(null);

  useEffect(() => {
    // Focus the safer choice first: Cancel for destructive prompts, otherwise Confirm.
    const target = dialog.tone === "danger" ? cancelRef.current : confirmRef.current;
    target?.focus();

    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      } else if (event.key === "Enter" && document.activeElement !== cancelRef.current) {
        event.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [dialog, onConfirm, onCancel]);

  return (
    <div
      className="fb-confirm-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className={`fb-confirm fb-confirm--${dialog.tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="fb-confirm-title"
        aria-describedby={dialog.message ? "fb-confirm-body" : undefined}
      >
        <div className="fb-confirm__head">
          <span className="fb-confirm__icon" aria-hidden="true">
            <FaExclamationTriangle />
          </span>
          <h3 id="fb-confirm-title">{dialog.title}</h3>
        </div>
        {dialog.message ? (
          <p id="fb-confirm-body" className="fb-confirm__body">{dialog.message}</p>
        ) : null}
        <div className="fb-confirm__actions">
          <button
            type="button"
            className="fb-btn fb-btn--ghost"
            ref={cancelRef}
            onClick={onCancel}
          >
            {dialog.cancelLabel}
          </button>
          <button
            type="button"
            className={`fb-btn ${dialog.tone === "danger" ? "fb-btn--danger" : "fb-btn--primary"}`}
            ref={confirmRef}
            onClick={onConfirm}
          >
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (type, message, options = {}) => {
      if (!message) return null;
      const id = ++toastSeq;
      const duration = options.duration ?? (type === "error" ? 5000 : 3200);
      setToasts((list) => [...list, { id, type, message: String(message) }]);
      if (duration > 0) {
        timers.current.set(id, setTimeout(() => dismiss(id), duration));
      }
      return id;
    },
    [dismiss]
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  const toast = useMemo(
    () => ({
      success: (message, options) => push("success", message, options),
      error: (message, options) => push("error", message, options),
      info: (message, options) => push("info", message, options),
      dismiss,
    }),
    [push, dismiss]
  );

  const [dialog, setDialog] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback(
    (options = {}) =>
      new Promise((resolve) => {
        resolver.current = resolve;
        setDialog({
          title: options.title || "Are you sure?",
          message: options.message || "",
          confirmLabel: options.confirmLabel || "Confirm",
          cancelLabel: options.cancelLabel || "Cancel",
          tone: options.tone === "danger" ? "danger" : "default",
        });
      }),
    []
  );

  const settle = useCallback((result) => {
    setDialog(null);
    if (resolver.current) {
      resolver.current(result);
      resolver.current = null;
    }
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      <ToastContext.Provider value={toast}>
        {children}
        {createPortal(
          <div className="fb-toast-viewport" aria-live="polite" aria-atomic="false">
            {toasts.map((t) => (
              <ToastItem key={t.id} toast={t} onClose={() => dismiss(t.id)} />
            ))}
          </div>,
          document.body
        )}
        {dialog
          ? createPortal(
              <ConfirmDialog
                dialog={dialog}
                onConfirm={() => settle(true)}
                onCancel={() => settle(false)}
              />,
              document.body
            )
          : null}
      </ToastContext.Provider>
    </ConfirmContext.Provider>
  );
}
