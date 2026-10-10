import { Link } from "react-router-dom";
import { FaArrowLeft, FaShieldAlt } from "react-icons/fa";
import "../styles/legal.css";

// Data privacy notice for STRAM PESO / PESO Marinduque's Trabaho Mandin!
// platform, written to meet the disclosure requirements of the Philippine
// Data Privacy Act of 2012 (Republic Act No. 10173) and its IRR — what is
// collected, why, the legal basis, who it's shared with, and the data
// subject rights the Act guarantees (NPC Circular 16-01, Sec. 16 of the Act).
export default function PrivacyPolicy() {
  return (
    <div className="legal-page">
      <div className="legal-wrap">
        <div className="legal-header">
          <Link to="/login" className="legal-back-link">
            <FaArrowLeft aria-hidden="true" /> Back to Login
          </Link>
          <span className="legal-eyebrow">
            <FaShieldAlt aria-hidden="true" /> Data Privacy
          </span>
          <h1>Privacy Policy</h1>
          <p className="legal-updated">
            Effective date: October 10, 2026 · Compliant with the Data Privacy Act of 2012 (Republic Act No. 10173)
          </p>
        </div>

        <div className="legal-card">
          <p className="legal-intro">
            The Public Employment Service Office (PESO) of the Province of Marinduque operates
            "Trabaho Mandin!" (STRAM PESO) to connect Marinduqueño jobseekers with local employers
            and livelihood opportunities. This Privacy Policy explains what personal information we
            collect through the platform, why we collect it, how it is used and protected, and the
            rights you have over it under the Data Privacy Act of 2012 (RA 10173), its Implementing
            Rules and Regulations, and the issuances of the National Privacy Commission (NPC).
          </p>

          <section className="legal-section">
            <h2><span className="legal-section-number">1</span> Information We Collect</h2>
            <p>We collect only the information needed to operate the platform and deliver its employment-facilitation services:</p>
            <h3>Account &amp; profile information</h3>
            <ul>
              <li>Full name, email address, contact number, and date of birth (used to apply age-based eligibility rules, e.g. for job listings and SPES applications).</li>
              <li>Profile photo, resume/CV, educational background, work experience, and skills you choose to add to your profile.</li>
              <li>For employers: business name, business address, and verification documents submitted to confirm the legitimacy of the organization.</li>
            </ul>
            <h3>Activity &amp; usage information</h3>
            <ul>
              <li>Job applications, saved/followed listings, messages sent to employers or jobseekers, and news posts you comment on or react to.</li>
              <li>Login timestamps, device/browser information, and IP address, collected for account security and fraud prevention.</li>
            </ul>
            <h3>Information from third parties</h3>
            <ul>
              <li>If you sign in with Google, we receive your name, email address, and profile photo from Google as permitted by your Google account settings.</li>
            </ul>
          </section>

          <section className="legal-section">
            <h2><span className="legal-section-number">2</span> How We Use Your Information</h2>
            <p>Consistent with the principle of legitimate purpose under RA 10173, your personal data is used only to:</p>
            <ul>
              <li>Create and manage your applicant or employer account;</li>
              <li>Match jobseekers with relevant job vacancies and SPES opportunities, and let employers review applications;</li>
              <li>Facilitate in-platform messaging between jobseekers and employers;</li>
              <li>Verify employer identity and legitimacy before a business account can post jobs;</li>
              <li>Send account-related notices (verification emails, application status updates, security alerts);</li>
              <li>Maintain platform safety through content moderation and abuse/fraud prevention; and</li>
              <li>Comply with reporting obligations to the Department of Labor and Employment (DOLE) and other government bodies, where required.</li>
            </ul>
          </section>

          <section className="legal-section">
            <h2><span className="legal-section-number">3</span> Legal Basis for Processing</h2>
            <p>Each processing activity is grounded in at least one of the criteria for lawful processing under Sections 12 and 13 of RA 10173:</p>
            <ul>
              <li><strong>Consent</strong> — when you create an account and agree to this Policy, and when you choose to share optional profile details;</li>
              <li><strong>Contractual necessity</strong> — to provide the job-matching and application services you sign up for;</li>
              <li><strong>Legal obligation</strong> — to comply with applicable labor, employment, and reporting laws; and</li>
              <li><strong>Legitimate interest</strong> — for platform security, fraud prevention, and service improvement, balanced against your rights as a data subject.</li>
            </ul>
          </section>

          <section className="legal-section">
            <h2><span className="legal-section-number">4</span> Who We Share Information With</h2>
            <p>We do not sell your personal data. Information is shared only as follows:</p>
            <ul>
              <li><strong>Employers</strong> see the application materials and profile details you submit when you apply to their job posting.</li>
              <li><strong>Jobseekers</strong> see an employer's public business profile and verified status when viewing a job listing.</li>
              <li><strong>PESO Marinduque staff and administrators</strong> may access account and activity data for verification, moderation, reporting, and support purposes.</li>
              <li><strong>Service providers</strong> (e.g. Google, for sign-in and authentication) process limited data strictly to provide that function.</li>
              <li><strong>Government agencies</strong>, where disclosure is required by law, court order, or a valid legal process.</li>
            </ul>
          </section>

          <section className="legal-section">
            <h2><span className="legal-section-number">5</span> Data Storage, Retention &amp; Security</h2>
            <p>
              We apply organizational, physical, and technical security measures appropriate to the
              sensitivity of the data we hold, including access controls, encrypted transmission, and
              password hashing. Account data is retained for as long as your account remains active and
              for a reasonable period afterward to meet legal, reporting, or dispute-resolution needs,
              after which it is securely deleted or anonymized.
            </p>
          </section>

          <section className="legal-section">
            <h2><span className="legal-section-number">6</span> Your Rights as a Data Subject</h2>
            <p>Under Section 16 of RA 10173, you have the right to:</p>
            <ul>
              <li><strong>Be informed</strong> that your personal data will be, are being, or were processed;</li>
              <li><strong>Access</strong> your personal data held in our systems;</li>
              <li><strong>Correct</strong> inaccurate or outdated personal data;</li>
              <li><strong>Object</strong> to processing, including processing for direct marketing or profiling;</li>
              <li><strong>Erasure or blocking</strong> of your data under circumstances allowed by law;</li>
              <li><strong>Data portability</strong>, to obtain a copy of your data in an electronic format; and</li>
              <li><strong>Lodge a complaint</strong> with the National Privacy Commission (NPC) if you believe your rights have been violated.</li>
            </ul>
            <p>
              You can exercise most of these rights directly from your account's Settings page, or by
              contacting us using the details below.
            </p>
          </section>

          <section className="legal-section">
            <h2><span className="legal-section-number">7</span> Children's Privacy</h2>
            <p>
              The platform is intended for users at least 15 years of age, consistent with our community
              guidelines. We do not knowingly collect personal data from children under this age; accounts
              found to misstate age-related eligibility may be restricted or removed.
            </p>
          </section>

          <section className="legal-section">
            <h2><span className="legal-section-number">8</span> Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy as our services evolve or as required by law. Material
              changes will be announced on the platform before they take effect. Continued use of
              Trabaho Mandin! after an update constitutes acknowledgment of the revised Policy.
            </p>
          </section>

          <section className="legal-section">
            <h2><span className="legal-section-number">9</span> Contact Us</h2>
            <div className="legal-contact-box">
              <strong>PESO Marinduque — Data Protection Officer</strong><br />
              Public Employment Service Office, Provincial Capitol, Boac, Marinduque<br />
              For data privacy concerns, access requests, or to exercise any of the rights above, please
              reach out through the platform's Messages feature or your local PESO office. You may also
              file a complaint with the <strong>National Privacy Commission</strong> at{" "}
              <strong>privacy.gov.ph</strong> if a concern remains unresolved.
            </div>
          </section>
        </div>

        <p className="legal-footer-links">
          <Link to="/terms">Terms of Service</Link> · <Link to="/login">Back to Login</Link>
        </p>
      </div>
    </div>
  );
}
