import { useState } from "react";
import { Link } from "react-router-dom";
import { FaCookieBite } from "react-icons/fa";
import "../styles/cookieConsent.css";

const STORAGE_KEY = "cookieConsent";

// STRAM PESO has no analytics/ad cookies — auth runs on a token in
// localStorage, not a session cookie — so there's nothing non-essential to
// opt in/out of. This banner exists purely to disclose that local-storage use
// up front (NPC treats it like cookies for notice purposes) and link to the
// full Cookie Policy; "Got it" just records that the notice was shown.
export default function CookieConsentBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return Boolean(localStorage.getItem(STORAGE_KEY));
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  const handleAccept = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ acknowledgedAt: new Date().toISOString() }));
    } catch {
      // Private-browsing mode or storage disabled — nothing to persist, just
      // dismiss this render so the banner doesn't block the page.
    }
    setDismissed(true);
  };

  return (
    <div className="cookie-banner" role="region" aria-label="Cookie notice">
      <div className="cookie-banner-inner">
        <FaCookieBite className="cookie-banner-icon" aria-hidden="true" />
        <p className="cookie-banner-text">
          We don't use advertising or tracking cookies. STRAM PESO only keeps essential data — like
          your sign-in session and language preference — in your browser's local storage so the site
          works. See our <Link to="/cookies">Cookie Policy</Link> for details.
        </p>
        <button type="button" className="cookie-banner-accept" onClick={handleAccept}>
          Got it
        </button>
      </div>
    </div>
  );
}
