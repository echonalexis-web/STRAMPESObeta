import { Link } from "react-router-dom";
import { FaArrowLeft, FaFileContract } from "react-icons/fa";
import "../styles/legal.css";

// Terms of Service for STRAM PESO / PESO Marinduque's Trabaho Mandin! platform.
export default function Terms() {
  return (
    <div className="legal-page">
      <div className="legal-wrap">
        <div className="legal-header">
          <Link to="/login" className="legal-back-link">
            <FaArrowLeft aria-hidden="true" /> Back to Login
          </Link>
          <span className="legal-eyebrow">
            <FaFileContract aria-hidden="true" /> Legal
          </span>
          <h1>Terms of Service</h1>
          <p className="legal-updated">Effective date: October 10, 2026</p>
        </div>

        <div className="legal-card">
          <p className="legal-intro">
            These Terms of Service ("Terms") govern your use of "Trabaho Mandin!" (STRAM PESO), the
            public employment platform operated by the Public Employment Service Office (PESO) of the
            Province of Marinduque. By creating an account or using the platform, you agree to these
            Terms. If you do not agree, please do not use the platform.
          </p>

          <section className="legal-section">
            <h2><span className="legal-section-number">1</span> Eligibility</h2>
            <p>
              You must be at least 15 years old to create an account. Access to job vacancy listings and
              SPES (Special Program for Employment of Students) applications is further governed by
              age-eligibility rules enforced on the platform. By registering, you confirm that the
              information you provide is accurate and that you meet these requirements.
            </p>
          </section>

          <section className="legal-section">
            <h2><span className="legal-section-number">2</span> Account Registration &amp; Security</h2>
            <ul>
              <li>You are responsible for maintaining the confidentiality of your account credentials.</li>
              <li>One account per person or business — impersonation or duplicate accounts are not allowed.</li>
              <li>Employer accounts must represent a real, lawfully operating business and may be subject to a verification review before they can post job vacancies.</li>
              <li>Notify us immediately of any unauthorized use of your account.</li>
            </ul>
          </section>

          <section className="legal-section">
            <h2><span className="legal-section-number">3</span> Use of the Platform</h2>
            <h3>Jobseekers</h3>
            <p>
              You may browse job vacancies, apply to listings, submit SPES applications, build a resume,
              and message employers, subject to the age-eligibility rules applicable to your account.
            </p>
            <h3>Employers</h3>
            <p>
              You may post job vacancies and review applications only after your account has passed
              verification. Job postings must be genuine, lawful, and accurately describe the role,
              compensation, and requirements.
            </p>
          </section>

          <section className="legal-section">
            <h2><span className="legal-section-number">4</span> Prohibited Conduct</h2>
            <p>You agree not to:</p>
            <ul>
              <li>Post illegal work, recruitment scams, or listings that charge applicants a fee to apply or be hired;</li>
              <li>Misrepresent your identity, qualifications, or (for employers) your business identity;</li>
              <li>Set job requirements based on age, sex, religion, or civil status unless it is a bona fide occupational qualification;</li>
              <li>Post nudity, hate symbols, violent content, or harass, threaten, dox, or spam other users in messages, comments, or profiles; or</li>
              <li>Attempt to circumvent the platform's verification, moderation, or security controls.</li>
            </ul>
            <p>
              Violations may result in content removal, account suspension, or a permanent ban, as
              outlined in the platform's community guidelines shown during onboarding.
            </p>
          </section>

          <section className="legal-section">
            <h2><span className="legal-section-number">5</span> Content You Submit</h2>
            <p>
              You retain ownership of the content you submit (resumes, job postings, messages, profile
              information), but you grant PESO Marinduque a license to host, display, and process that
              content as necessary to operate the platform's features. You are solely responsible for
              the accuracy and lawfulness of content you post.
            </p>
          </section>

          <section className="legal-section">
            <h2><span className="legal-section-number">6</span> Third-Party Sign-In</h2>
            <p>
              The platform offers sign-in via Google. Your use of that option is also subject to Google's
              own terms and privacy practices, independent of this platform.
            </p>
          </section>

          <section className="legal-section">
            <h2><span className="legal-section-number">7</span> Disclaimer &amp; Limitation of Liability</h2>
            <p>
              PESO Marinduque facilitates connections between jobseekers and employers but does not
              guarantee employment outcomes, the accuracy of third-party job postings, or uninterrupted
              availability of the platform. The platform is provided "as is," and PESO Marinduque is not
              liable for disputes, losses, or damages arising from interactions between jobseekers and
              employers conducted outside the platform's direct control.
            </p>
          </section>

          <section className="legal-section">
            <h2><span className="legal-section-number">8</span> Suspension &amp; Termination</h2>
            <p>
              We may suspend or terminate an account that violates these Terms, provides false
              information, or poses a risk to other users. You may deactivate your own account at any
              time through Settings.
            </p>
          </section>

          <section className="legal-section">
            <h2><span className="legal-section-number">9</span> Governing Law</h2>
            <p>
              These Terms are governed by the laws of the Republic of the Philippines, including the
              Data Privacy Act of 2012 (RA 10173) for matters involving personal data — see our{" "}
              <Link to="/privacy">Privacy Policy</Link> for details.
            </p>
          </section>

          <section className="legal-section">
            <h2><span className="legal-section-number">10</span> Changes to These Terms</h2>
            <p>
              We may update these Terms from time to time. Material changes will be announced on the
              platform before they take effect. Continued use of Trabaho Mandin! after an update
              constitutes acceptance of the revised Terms.
            </p>
          </section>

          <section className="legal-section">
            <h2><span className="legal-section-number">11</span> Contact Us</h2>
            <div className="legal-contact-box">
              <strong>PESO Marinduque</strong><br />
              Public Employment Service Office, Provincial Capitol, Boac, Marinduque<br />
              For questions about these Terms, please reach out through the platform's Messages feature
              or your local PESO office.
            </div>
          </section>
        </div>

        <p className="legal-footer-links">
          <Link to="/privacy">Privacy Policy</Link> · <Link to="/login">Back to Login</Link>
        </p>
      </div>
    </div>
  );
}
