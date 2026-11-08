import { useRef } from "react";
import { useModalA11y } from "../hooks/useModalA11y";
import "../styles/app-modal.css";

// Shared dialog shell: bottom sheet below 768px, centered dialog from 768px
// (see styles/app-modal.css). `className` is added to the overlay and
// `panelClassName` to the dialog card so a caller can opt into a variant
// (e.g. `am--full` for a full-height sheet) or scope its own content CSS
// without :has() hooks. Both are optional; omitting them changes nothing.
//
// Optional accessibility props (all additive; defaults keep existing callers
// behaving the same): `titleId` labels the dialog by the visible title
// instead of an aria-label, `describedBy` points aria-describedby at a
// message element, `closeLabel` localizes the close button, and `hideClose`
// removes the close button for a state that must not be dismissed.
export default function AppModal({
  isOpen,
  onClose,
  title,
  children,
  className = "",
  panelClassName = "",
  titleId,
  describedBy,
  closeLabel = "Close modal",
  hideClose = false,
}) {
  const dialogRef = useRef(null);
  useModalA11y(isOpen, onClose, dialogRef);

  if (!isOpen) return null;

  return (
    <div
      className={["app-modal-overlay", "am-overlay", className].filter(Boolean).join(" ")}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          // Stop the browser moving focus to <body> after we close, so the
          // focus restore in useModalA11y (back to the trigger) sticks.
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div
        className={["app-modal-card", "am-card", panelClassName].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label={titleId ? undefined : title}
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        ref={dialogRef}
      >
        {hideClose ? null : (
          <button
            className="app-modal-close"
            onClick={onClose}
            aria-label={closeLabel}
            type="button"
          >
            x
          </button>
        )}
        <h3 className="app-modal-title" id={titleId}>{title}</h3>
        {children}
      </div>
    </div>
  );
}
