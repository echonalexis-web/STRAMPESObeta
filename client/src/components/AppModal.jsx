import { useRef } from "react";
import { useModalA11y } from "../hooks/useModalA11y";

export default function AppModal({ isOpen, onClose, title, children }) {
  const dialogRef = useRef(null);
  useModalA11y(isOpen, onClose, dialogRef);

  if (!isOpen) return null;

  return (
    <div
      className="app-modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="app-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={dialogRef}
      >
        <button
          className="app-modal-close"
          onClick={onClose}
          aria-label="Close modal"
          type="button"
        >
          x
        </button>
        <h3 className="app-modal-title">{title}</h3>
        {children}
      </div>
    </div>
  );
}
