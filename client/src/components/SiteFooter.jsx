import { Link } from "react-router-dom";
import pesoLogo from "../assets/images/peso-logo.png";
import provincialSeal from "../assets/images/provincial-seal.png";
import "../styles/home.css";

// The public site footer (office, contact links, legal links). Same markup and styles
// as the footer on the Home page (footer-v2 in home.css).
export default function SiteFooter() {
  return (
    <footer className="footer-v2">
      <div className="footer-v2-background-overlay"></div>
      <div className="footer-v2-content">
        <div className="footer-v2-logos">
          <div className="footer-v2-yellow-box"><img src={pesoLogo} alt="PESO Marinduque Logo" className="footer-v2-logo-img" /></div>
          <div className="footer-v2-seal"><img src={provincialSeal} alt="Provincial Seal" className="footer-v2-seal-img" /></div>
        </div>
        <div className="footer-v2-text">
          <p className="footer-v2-label">LIVELIHOOD MANPOWER DEVELOPMENT</p>
          <h2 className="footer-v2-title">PUBLIC EMPLOYMENT SERVICE OFFICE</h2>
          <p className="footer-v2-subtitle">Lalawigan ng Marinduque</p>
        </div>
        <div className="footer-v2-contact" aria-label="Contact links">
          <a className="footer-v2-contact-link" href="tel:+639567844364" aria-label="Call the office" title="Call the office">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.6 10.8c1.5 2.9 3.7 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1.1-.2 1.2.4 2.5.7 3.8.7.6 0 1.1.5 1.1 1.1v3.5c0 .6-.5 1.1-1.1 1.1C11.7 21.4 2.6 12.3 2.6 1.7c0-.6.5-1.1 1.1-1.1h3.5c.6 0 1.1.5 1.1 1.1 0 1.3.2 2.6.7 3.8.1.4 0 .8-.2 1.1l-2.2 2.2Z" /></svg>
          </a>
          <a className="footer-v2-contact-link" href="https://compose.mail.yahoo.com/?to=lmdpeso@yahoo.com" target="_blank" rel="noopener noreferrer" aria-label="Email the office" title="Email the office">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 5.5h18v13H3v-13Zm1.5 1.8 7.5 5.2 7.5-5.2M4.5 17l5.1-4.1m9.9 4.1-5.1-4.1" /></svg>
          </a>
          <a className="footer-v2-contact-link" href="https://web.facebook.com/LMDPESOMarinduqueOfficial" target="_blank" rel="noopener noreferrer" aria-label="Visit our Facebook page" title="Visit our Facebook page">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M13.4 21v-8h2.7l.4-3h-3.1V8.1c0-.9.3-1.5 1.6-1.5h1.7V4a21 21 0 0 0-2.4-.1c-2.4 0-4 1.5-4 4.1V10H7.6v3h2.7v8h3.1Z" /></svg>
          </a>
        </div>
      </div>
      <div className="footer-v2-copyright">
        <p>© 2025 Provincial Government of Marinduque. All Rights Reserved.</p>
        <nav className="footer-v2-legal-links" aria-label="Legal">
          <Link to="/terms">Terms of Service</Link>
          <span aria-hidden="true">•</span>
          <Link to="/privacy">Privacy Policy</Link>
          <span aria-hidden="true">•</span>
          <Link to="/cookies">Cookie Policy</Link>
        </nav>
      </div>
    </footer>
  );
}
