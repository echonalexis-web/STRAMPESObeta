import { Link } from "react-router-dom";
import { FaBuilding, FaUserGraduate } from "react-icons/fa";
import "../styles/auth.css";
import "@fontsource/plus-jakarta-sans/800.css";
import "../styles/login.css";
import "../styles/registration.css";

export default function RegistrationLayout({ employer = false, children }) {
  return (
    <main className="login-page registration-page">
      <div className="login-layout">
        <section className="login-branding" aria-labelledby="registration-brand-title">
          <div className="login-branding-content">
            <p className="login-eyebrow">PUBLIC EMPLOYMENT SERVICE OFFICE</p>
            <h1 id="registration-brand-title" className="login-branding-title">Trabaho<br />Mandin!</h1>
            <p className="login-branding-tagline">Trabaho para sa Marinduqueño</p>
            <p className="login-branding-desc">
              {employer
                ? "Marinduque, the Heart of the Philippines. Connect with local talent, post job vacancies, and grow your business with the right people."
                : "Marinduque, the Heart of the Philippines. Connect with local employers, discover livelihood opportunities, and build your future right here at home."}
            </p>
            <div className="login-branding-chips">
              <span>{employer ? "Local Talent" : "Local Employers"}</span>
              <span>Smart Job Matching</span>
            </div>
            <div className="login-branding-footer">LALAWIGAN NG MARINDUQUE</div>
          </div>
        </section>

        <section className="login-form-panel" aria-labelledby="registration-form-title">
          <div className="login-form-content">
            <nav className="registration-role-switch" aria-label="Registration account type">
              <Link to="/register" aria-current={!employer ? "page" : undefined}>
                <FaUserGraduate aria-hidden="true" /> Applicant
              </Link>
              <Link to="/register-employer" aria-current={employer ? "page" : undefined}>
                <FaBuilding aria-hidden="true" /> Employer
              </Link>
            </nav>
            <header className="login-form-header">
              <h2 id="registration-form-title">{employer ? "Create an employer account" : "Create your account"}</h2>
              <p>{employer
                ? "Post openings and find the right people for your business."
                : "Discover local jobs and find your next opportunity with STRAM PESO."}</p>
            </header>
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}
