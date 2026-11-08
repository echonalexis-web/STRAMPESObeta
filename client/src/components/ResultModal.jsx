import { useEffect, useId, useRef } from "react";
import AppModal from "./AppModal";
import "../styles/result-modal.css";

// Presentational result dialog: loading, success or failure, one primary
// action and an optional secondary one. It is built on AppModal, so the
// focus trap, scroll lock, Escape and the bottom sheet / centered layout come
// from there. It owns no routing or request logic (see ResultModalHost).
//
// While `status === "loading"` the dialog cannot be dismissed (no close
// button, Escape and backdrop do nothing) so a pending result is never lost.
export default function ResultModal({
  status,
  title,
  message,
  primary,
  secondary,
  closeLabel,
  onClose,
}) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const messageId = `${uid}-message`;
  const bodyRef = useRef(null);
  const primaryRef = useRef(null);
  const loading = status === "loading";

  // Focus follows the content: the dialog itself while loading, the primary
  // action once there is a result.
  useEffect(() => {
    if (loading) {
      bodyRef.current?.closest('[role="dialog"]')?.focus();
    } else {
      primaryRef.current?.focus();
    }
  }, [loading, status]);

  const failure = status === "failure";

  return (
    <AppModal
      isOpen
      onClose={loading ? () => {} : onClose}
      title={title}
      titleId={titleId}
      describedBy={messageId}
      closeLabel={closeLabel}
      hideClose={loading}
      className="rm-overlay"
      panelClassName={`rm-card rm-card--${status}`}
    >
      <div className="rm-body" ref={bodyRef}>
        <div className={`rm-icon rm-icon--${status}`} aria-hidden="true">
          {loading ? (
            <span className="rm-spinner" />
          ) : failure ? (
            <svg viewBox="0 0 24 24" width="28" height="28" focusable="false">
              <path
                d="M12 8v5m0 3.5h.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="28" height="28" focusable="false">
              <path
                d="m5 12.5 4.5 4.5L19 7.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>

        <p
          id={messageId}
          className="rm-message"
          role={failure ? "alert" : "status"}
          aria-live={failure ? "assertive" : "polite"}
          aria-atomic="true"
        >
          {message}
        </p>

        {loading || (!primary && !secondary) ? null : (
          <div className="rm-actions">
            {secondary ? (
              <button type="button" className="ds-btn ds-btn--secondary" onClick={secondary.onClick}>
                {secondary.label}
              </button>
            ) : null}
            {primary ? (
              <button
                type="button"
                className="ds-btn ds-btn--primary"
                onClick={primary.onClick}
                ref={primaryRef}
              >
                {primary.label}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </AppModal>
  );
}
