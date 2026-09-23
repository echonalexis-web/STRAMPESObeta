import { createPortal } from "react-dom";
import { FaExclamationTriangle } from "react-icons/fa";
import "../styles/accountInactive.css";

export const SUPPORT_EMAIL = "lmdpesomarinduque@gmail.com";

// Blocking, dismiss-to-continue alert shown the moment an active session
// learns its account is no longer usable (suspended, banned, deactivated, or
// deleted) — via a live push while the tab is open, or right after a request
// comes back rejected. `onDismiss` is responsible for clearing storage and
// navigating away; this component only renders the notice itself.
export default function AccountInactiveModal({ onDismiss }) {
  return createPortal(
    <div className="account-inactive-overlay" role="presentation">
      <div
        className="account-inactive-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="account-inactive-title"
        aria-describedby="account-inactive-body"
      >
        <span className="account-inactive-icon" aria-hidden="true">
          <FaExclamationTriangle />
        </span>
        <h2 id="account-inactive-title">Account access restricted</h2>
        <p id="account-inactive-body">
          Your account has been suspended or deactivated. If you believe this is a mistake,
          please contact support at{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
        <button type="button" className="account-inactive-btn" onClick={onDismiss} autoFocus>
          OK
        </button>
      </div>
    </div>,
    document.body
  );
}
