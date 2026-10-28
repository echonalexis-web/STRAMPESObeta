import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { FaArrowLeft, FaCookieBite, FaFileContract, FaSearch, FaShieldAlt } from "react-icons/fa";
import "../styles/home.css";
import "../styles/legalCenter.css";
import pesoLogo from "../assets/images/peso-logo.png";
import provincialSeal from "../assets/images/provincial-seal.png";

// Unified Legal & Compliance Center for STRAM PESO / PESO Marinduque's
// "Trabaho Mandin!" platform. Replaces the three standalone pages that used
// to live at /terms, /privacy, /cookies — those routes all render this same
// component now (see App.jsx), each defaulting to its matching tab, so every
// existing link to those paths across the app keeps working unchanged.
//
// Content below is carried over verbatim from the previous Terms.jsx /
// PrivacyPolicy.jsx / CookiePolicy.jsx — only the presentation changed. Each
// policy's final "Contact Us" section was folded into the single shared DPO
// footer card at the bottom, since all three said essentially the same thing.

const PATH_TO_TAB = { "/terms": "terms", "/privacy": "privacy", "/cookies": "cookies" };
const TAB_TO_PATH = { terms: "/terms", privacy: "/privacy", cookies: "/cookies" };

const POLICIES = {
  terms: {
    label: "Terms of Service",
    shortLabel: "Terms",
    description: "The rules for using the platform",
    icon: <FaFileContract aria-hidden="true" />,
    badge: "Legal",
    effectiveDate: "October 10, 2026",
    intro: (
      <>
        These Terms of Service ("Terms") govern your use of "Trabaho Mandin!" (STRAM PESO), the
        public employment platform operated by the Public Employment Service Office (PESO) of the
        Province of Marinduque. By creating an account or using the platform, you agree to these
        Terms. If you do not agree, please do not use the platform.
      </>
    ),
    sections: [
      {
        id: "terms-eligibility",
        title: "Eligibility",
        keywords: "eligibility age 15 years old spes special program employment students",
        body: (
          <p>
            You must be at least 15 years old to create an account. Access to job vacancy listings and
            SPES (Special Program for Employment of Students) applications is further governed by
            age-eligibility rules enforced on the platform. By registering, you confirm that the
            information you provide is accurate and that you meet these requirements.
          </p>
        ),
      },
      {
        id: "terms-account-security",
        title: "Account Registration & Security",
        keywords: "account registration security credentials password one account per person impersonation employer verification",
        body: (
          <ul>
            <li>You are responsible for maintaining the confidentiality of your account credentials.</li>
            <li>One account per person or business — impersonation or duplicate accounts are not allowed.</li>
            <li>Employer accounts must represent a real, lawfully operating business and may be subject to a verification review before they can post job vacancies.</li>
            <li>Notify us immediately of any unauthorized use of your account.</li>
          </ul>
        ),
      },
      {
        id: "terms-use-of-platform",
        title: "Use of the Platform",
        keywords: "use of platform jobseekers employers browse apply resume message post vacancies",
        body: (
          <>
            <h4>Jobseekers</h4>
            <p>
              You may browse job vacancies, apply to listings, submit SPES applications, build a resume,
              and message employers, subject to the age-eligibility rules applicable to your account.
            </p>
            <h4>Employers</h4>
            <p>
              You may post job vacancies and review applications only after your account has passed
              verification. Job postings must be genuine, lawful, and accurately describe the role,
              compensation, and requirements.
            </p>
          </>
        ),
      },
      {
        id: "terms-prohibited-conduct",
        title: "Prohibited Conduct",
        keywords: "prohibited conduct scams fee discrimination age sex religion civil status harassment doxxing spam nudity hate",
        body: (
          <>
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
          </>
        ),
      },
      {
        id: "terms-content-submit",
        title: "Content You Submit",
        keywords: "content you submit ownership license resumes job postings messages profile information",
        body: (
          <p>
            You retain ownership of the content you submit (resumes, job postings, messages, profile
            information), but you grant PESO Marinduque a license to host, display, and process that
            content as necessary to operate the platform's features. You are solely responsible for
            the accuracy and lawfulness of content you post.
          </p>
        ),
      },
      {
        id: "terms-third-party-signin",
        title: "Third-Party Sign-In",
        keywords: "third party sign in google terms privacy practices",
        body: (
          <p>
            The platform offers sign-in via Google. Your use of that option is also subject to Google's
            own terms and privacy practices, independent of this platform.
          </p>
        ),
      },
      {
        id: "terms-disclaimer-liability",
        title: "Disclaimer & Limitation of Liability",
        keywords: "disclaimer limitation of liability guarantee employment outcomes as is",
        body: (
          <p>
            PESO Marinduque facilitates connections between jobseekers and employers but does not
            guarantee employment outcomes, the accuracy of third-party job postings, or uninterrupted
            availability of the platform. The platform is provided "as is," and PESO Marinduque is not
            liable for disputes, losses, or damages arising from interactions between jobseekers and
            employers conducted outside the platform's direct control.
          </p>
        ),
      },
      {
        id: "terms-suspension-termination",
        title: "Suspension & Termination",
        keywords: "suspension termination account violates false information deactivate settings",
        body: (
          <p>
            We may suspend or terminate an account that violates these Terms, provides false
            information, or poses a risk to other users. You may deactivate your own account at any
            time through Settings.
          </p>
        ),
      },
      {
        id: "terms-governing-law",
        title: "Governing Law",
        keywords: "governing law philippines data privacy act ra 10173",
        body: (
          <p>
            These Terms are governed by the laws of the Republic of the Philippines, including the
            Data Privacy Act of 2012 (RA 10173) for matters involving personal data — see our{" "}
            <Link to="/privacy">Privacy Policy</Link> for details.
          </p>
        ),
      },
      {
        id: "terms-changes",
        title: "Changes to These Terms",
        keywords: "changes to these terms update material changes announced continued use acceptance",
        body: (
          <p>
            We may update these Terms from time to time. Material changes will be announced on the
            platform before they take effect. Continued use of Trabaho Mandin! after an update
            constitutes acceptance of the revised Terms.
          </p>
        ),
      },
    ],
  },

  privacy: {
    label: "Privacy Policy",
    shortLabel: "Privacy",
    description: "What we collect and why, under RA 10173",
    icon: <FaShieldAlt aria-hidden="true" />,
    badge: "RA 10173",
    effectiveDate: "October 10, 2026 · Compliant with the Data Privacy Act of 2012 (Republic Act No. 10173)",
    intro: (
      <>
        The Public Employment Service Office (PESO) of the Province of Marinduque operates
        "Trabaho Mandin!" (STRAM PESO) to connect Marinduqueño jobseekers with local employers
        and livelihood opportunities. This Privacy Policy explains what personal information we
        collect through the platform, why we collect it, how it is used and protected, and the
        rights you have over it under the Data Privacy Act of 2012 (RA 10173), its Implementing
        Rules and Regulations, and the issuances of the National Privacy Commission (NPC).
      </>
    ),
    sections: [
      {
        id: "privacy-information-we-collect",
        title: "Information We Collect",
        keywords: "information we collect name email contact number date of birth profile photo resume nsrp civil status religion tin sss gsis pagibig philhealth government id sensitive personal information cookies local storage",
        body: (
          <>
            <p>We collect only the information needed to operate the platform and deliver its employment-facilitation services:</p>
            <h4>Account &amp; profile information</h4>
            <ul>
              <li>Full name, email address, contact number, and date of birth (used to apply age-based eligibility rules, e.g. for job listings and SPES applications).</li>
              <li>Profile photo, resume/CV, educational background, work experience, and skills you choose to add to your profile.</li>
              <li>For employers: business name, business address, and verification documents submitted to confirm the legitimacy of the organization.</li>
            </ul>
            <h4>NSRP registry details (jobseekers, optional)</h4>
            <p>
              If you choose to complete the National Skills Registration Program (NSRP) section of your
              profile — the same information PESO offices collect on paper NSRP forms — it may include:
              civil status, place of birth, citizenship, height/weight, religion, TIN, SSS/GSIS number,
              Pag-IBIG number, PhilHealth number, and a government-issued ID type and number. Fields such
              as <strong>religion</strong> and <strong>government-issued ID numbers</strong> are classified
              as <strong>sensitive personal information</strong> under Section 3(l) of RA 10173. We only
              collect and process these with your explicit, separate consent, we never use them for
              discriminatory job matching, and you may leave them blank — only civil status, citizenship,
              and place of birth are required to complete this section; the rest is entirely optional.
            </p>
            <h4>Activity &amp; usage information</h4>
            <ul>
              <li>Job applications, saved/followed listings, messages sent to employers or jobseekers, and news posts you comment on or react to.</li>
              <li>Login timestamps, device/browser information, and IP address, collected for account security and fraud prevention.</li>
            </ul>
            <h4>Information from third parties</h4>
            <ul>
              <li>If you sign in with Google, we receive your name, email address, and profile photo from Google as permitted by your Google account settings.</li>
            </ul>
            <h4>Cookies &amp; local storage</h4>
            <p>
              We do not use advertising or analytics cookies. The platform keeps your sign-in session and
              a few interface preferences in your browser's local storage — see our{" "}
              <Link to="/cookies">Cookie Policy</Link> for the full list.
            </p>
          </>
        ),
      },
      {
        id: "privacy-how-we-use",
        title: "How We Use Your Information",
        keywords: "how we use your information legitimate purpose account matching jobseekers employers messaging verify notices moderation dole reporting",
        body: (
          <>
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
          </>
        ),
      },
      {
        id: "privacy-legal-basis",
        title: "Legal Basis for Processing",
        keywords: "legal basis for processing consent contractual necessity legal obligation legitimate interest sensitive personal information section 13",
        body: (
          <>
            <p>Each processing activity is grounded in at least one of the criteria for lawful processing under Sections 12 and 13 of RA 10173:</p>
            <ul>
              <li><strong>Consent</strong> — when you create an account and agree to this Policy, and when you choose to share optional profile details;</li>
              <li><strong>Contractual necessity</strong> — to provide the job-matching and application services you sign up for;</li>
              <li><strong>Legal obligation</strong> — to comply with applicable labor, employment, and reporting laws; and</li>
              <li><strong>Legitimate interest</strong> — for platform security, fraud prevention, and service improvement, balanced against your rights as a data subject.</li>
            </ul>
            <p>
              For <strong>sensitive personal information</strong> (e.g. religion, government-issued ID
              numbers) under Section 13 of RA 10173, we rely specifically on your explicit, freely given
              consent, captured separately from this Policy when you choose to fill in that optional
              section of your profile.
            </p>
          </>
        ),
      },
      {
        id: "privacy-who-we-share",
        title: "Who We Share Information With",
        keywords: "who we share information with employers jobseekers peso staff administrators service providers google government agencies sell",
        body: (
          <>
            <p>We do not sell your personal data. Information is shared only as follows:</p>
            <ul>
              <li><strong>Employers</strong> see the application materials and profile details you submit when you apply to their job posting.</li>
              <li><strong>Jobseekers</strong> see an employer's public business profile and verified status when viewing a job listing.</li>
              <li><strong>PESO Marinduque staff and administrators</strong> may access account and activity data for verification, moderation, reporting, and support purposes.</li>
              <li><strong>Service providers</strong> (e.g. Google, for sign-in and authentication) process limited data strictly to provide that function.</li>
              <li><strong>Government agencies</strong>, where disclosure is required by law, court order, or a valid legal process.</li>
            </ul>
          </>
        ),
      },
      {
        id: "privacy-storage-retention-security",
        title: "Data Storage, Retention & Security",
        keywords: "data storage retention security encrypted password hashing access controls anonymized",
        body: (
          <p>
            We apply organizational, physical, and technical security measures appropriate to the
            sensitivity of the data we hold, including access controls, encrypted transmission, and
            password hashing. Account data is retained for as long as your account remains active and
            for a reasonable period afterward to meet legal, reporting, or dispute-resolution needs,
            after which it is securely deleted or anonymized.
          </p>
        ),
      },
      {
        id: "privacy-your-rights",
        title: "Your Rights as a Data Subject",
        keywords: "your rights as a data subject be informed access correct object erasure blocking data portability complaint national privacy commission section 16",
        body: (
          <>
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
          </>
        ),
      },
      {
        id: "privacy-childrens-privacy",
        title: "Children's Privacy",
        keywords: "children's privacy age 15 community guidelines",
        body: (
          <p>
            The platform is intended for users at least 15 years of age, consistent with our community
            guidelines. We do not knowingly collect personal data from children under this age; accounts
            found to misstate age-related eligibility may be restricted or removed.
          </p>
        ),
      },
      {
        id: "privacy-changes",
        title: "Changes to This Policy",
        keywords: "changes to this policy update material changes announced acknowledgment",
        body: (
          <p>
            We may update this Privacy Policy as our services evolve or as required by law. Material
            changes will be announced on the platform before they take effect. Continued use of
            Trabaho Mandin! after an update constitutes acknowledgment of the revised Policy.
          </p>
        ),
      },
    ],
  },

  cookies: {
    label: "Cookie Policy",
    shortLabel: "Cookies",
    description: "What's stored in your browser, and why",
    icon: <FaCookieBite aria-hidden="true" />,
    badge: "Storage",
    effectiveDate: "October 27, 2026",
    intro: (
      <>
        This Cookie Policy explains how "Trabaho Mandin!" (STRAM PESO) uses browser storage to
        run the platform. We keep this simple because the platform's needs are simple: we do not
        run analytics, advertising, or third-party tracking of any kind.
      </>
    ),
    sections: [
      {
        id: "cookies-no-tracking",
        title: "We Don't Use Tracking Cookies",
        keywords: "we don't use tracking cookies advertising analytics google analytics pixels cross site behavioral advertising",
        body: (
          <p>
            STRAM PESO does not set advertising cookies, analytics cookies (e.g. Google Analytics),
            social media pixels, or any cookie used to track you across other websites. There is no
            cross-site tracking and no behavioral advertising on this platform.
          </p>
        ),
      },
      {
        id: "cookies-what-we-store",
        title: "What We Actually Store On Your Device",
        keywords: "what we actually store on your device local storage sign in session account status language preference display preferences form drafts cookie notice",
        body: (
          <>
            <p>
              Instead of cookies, the platform keeps a small amount of data in your browser's{" "}
              <strong>local storage</strong> — a cookie-like mechanism that, like cookies, stays on your
              device until it's cleared. We only use it for things the platform cannot function without:
            </p>
            <h4>Strictly necessary (always on)</h4>
            <ul>
              <li><strong>Sign-in session</strong> — a security token and basic profile info so you stay logged in between visits, instead of signing in on every page.</li>
              <li><strong>Account status notices</strong> — a short-lived flag used to show you the right screen if your session ends (e.g. after logging out elsewhere, or an account suspension/appeal notice).</li>
            </ul>
            <h4>Functional preferences (always on, no profiling involved)</h4>
            <ul>
              <li><strong>Language preference</strong> — remembers whether you last used the site in English or Filipino.</li>
              <li><strong>Display preferences</strong> — small UI choices, like your preferred navigation layout.</li>
              <li><strong>In-progress form drafts</strong> — onboarding steps you've partially filled in, saved locally so you don't lose progress if you navigate away before finishing.</li>
              <li><strong>This cookie notice</strong> — a flag recording that you've seen and dismissed this banner, so we don't show it on every page.</li>
            </ul>
            <p>
              None of the above is shared with advertisers, sold to third parties, or used to build a
              profile of you for marketing. It exists solely to make the platform work.
            </p>
          </>
        ),
      },
      {
        id: "cookies-third-party-signin",
        title: "Third-Party Sign-In",
        keywords: "third party sign in google cookies privacy practices",
        body: (
          <p>
            If you choose to sign in with Google, Google may set its own cookies to operate that
            sign-in flow, governed by Google's own cookie and privacy practices — independent of and
            not controlled by STRAM PESO. We don't receive or read Google's cookies ourselves; we
            only receive the account details Google's sign-in response provides (see our{" "}
            <Link to="/privacy">Privacy Policy</Link>).
          </p>
        ),
      },
      {
        id: "cookies-managing",
        title: "Managing or Clearing This Data",
        keywords: "managing or clearing this data site data local storage private incognito window cookie banner",
        body: (
          <ul>
            <li>Clearing your browser's "site data" or "local storage" for this site removes everything listed above, including your saved sign-in session (you'll be signed out).</li>
            <li>Using a private/incognito window avoids storing any of it beyond that session.</li>
            <li>Declining the cookie banner's acknowledgement doesn't block access — since nothing non-essential is collected, there's no optional tracking to opt out of.</li>
          </ul>
        ),
      },
      {
        id: "cookies-changes",
        title: "Changes to This Policy",
        keywords: "changes to this policy analytics similar technology consent",
        body: (
          <p>
            If STRAM PESO ever introduces analytics or a similar technology, we'll update this page
            first and, where required by law, ask for your consent before it's active.
          </p>
        ),
      },
    ],
  },
};

// Common questions shown as suggestions under the search box before the
// visitor types anything. Each one jumps straight to the clause that answers
// it, scoped to whichever policy tab is currently active.
const FAQS = {
  terms: [
    { question: "Who can create an account?", sectionId: "terms-eligibility" },
    { question: "What happens if I break the rules?", sectionId: "terms-prohibited-conduct" },
    { question: "Can I sign in with Google?", sectionId: "terms-third-party-signin" },
    { question: "Can my account be suspended?", sectionId: "terms-suspension-termination" },
    { question: "Who owns the content I post?", sectionId: "terms-content-submit" },
    { question: "What law governs these Terms?", sectionId: "terms-governing-law" },
    { question: "Can employers charge a fee to apply?", sectionId: "terms-prohibited-conduct" },
    { question: "How do I deactivate my account?", sectionId: "terms-suspension-termination" },
  ],
  privacy: [
    { question: "What personal information do you collect?", sectionId: "privacy-information-we-collect" },
    { question: "Do you sell my data?", sectionId: "privacy-who-we-share" },
    { question: "How do I access or delete my data?", sectionId: "privacy-your-rights" },
    { question: "Is my data secure?", sectionId: "privacy-storage-retention-security" },
    { question: "Do you use my data for advertising?", sectionId: "privacy-how-we-use" },
    { question: "Can I use the platform if I'm under 18?", sectionId: "privacy-childrens-privacy" },
    { question: "Is my religion or government ID required?", sectionId: "privacy-information-we-collect" },
    { question: "What's my legal basis for processing?", sectionId: "privacy-legal-basis" },
  ],
  cookies: [
    { question: "Do you use tracking or advertising cookies?", sectionId: "cookies-no-tracking" },
    { question: "What exactly do you store in my browser?", sectionId: "cookies-what-we-store" },
    { question: "How do I clear this data?", sectionId: "cookies-managing" },
    { question: "Does signing in with Google set cookies?", sectionId: "cookies-third-party-signin" },
    { question: "Will this notice keep reappearing?", sectionId: "cookies-what-we-store" },
    { question: "Will you add tracking later?", sectionId: "cookies-changes" },
    { question: "What if I browse in a private window?", sectionId: "cookies-managing" },
  ],
};

const cx = (...parts) => parts.filter(Boolean).join(" ");

export default function LegalCenter() {
  const location = useLocation();
  const navigate = useNavigate();
  // The URL is the single source of truth for which tab is active — no
  // separate state to keep in sync with it, so there's nothing that can
  // drift when a link elsewhere in the app navigates straight to /privacy
  // or /cookies.
  const activeTab = PATH_TO_TAB[location.pathname] || "terms";
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const year = useMemo(() => new Date().getFullYear(), []);

  const handleTabChange = (tab) => {
    if (tab === activeTab) return;
    setQuery("");
    navigate(TAB_TO_PATH[tab], { replace: true });
  };

  const policy = POLICIES[activeTab];

  const filteredSections = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return policy.sections;
    return policy.sections.filter((section) =>
      `${section.title} ${section.keywords}`.toLowerCase().includes(normalized)
    );
  }, [policy, query]);

  const scrollToSection = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleTocClick = (event, id) => {
    event.preventDefault();
    scrollToSection(id);
  };

  const handleFaqSelect = (faq) => {
    setQuery("");
    setSearchFocused(false);
    // Section cards only exist in the DOM once any active filter clears, so
    // give the "all sections" render a tick to land before scrolling to it.
    requestAnimationFrame(() => scrollToSection(faq.sectionId));
  };

  const faqSuggestions = FAQS[activeTab] || [];
  const showFaqSuggestions = searchFocused && !query.trim();

  return (
    <div className="legal-center-page">
      <section className="legal-hero">
        <div className="legal-hero-inner">
          <div className="legal-hero-top">
            <div className="legal-hero-content">
              <Link to="/login" className="legal-hero-back">
                <FaArrowLeft aria-hidden="true" /> Back to Login
              </Link>
              <span className="legal-hero-eyebrow">Legal &amp; Compliance</span>
              <h1>Legal Center &amp; Governance</h1>
              <p>
                Everything governing your use of "Trabaho Mandin!" (STRAM PESO) — the Terms of Service,
                the Data Privacy Act–compliant Privacy Policy, and the Cookie Policy — in one place.
              </p>
            </div>
            <div className="legal-hero-search-wrap">
              <div className="legal-hero-search">
                <FaSearch aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  placeholder={`Search within ${policy.label}…`}
                  aria-label={`Search within ${policy.label}`}
                  role="combobox"
                  aria-expanded={showFaqSuggestions && faqSuggestions.length > 0}
                  aria-controls="legal-faq-suggestions"
                  autoComplete="off"
                />
              </div>

              {showFaqSuggestions && faqSuggestions.length > 0 && (
                <div className="legal-faq-suggestions" id="legal-faq-suggestions" role="listbox">
                  <p className="legal-faq-suggestions-label">Common questions</p>
                  {faqSuggestions.map((faq) => (
                    <button
                      key={faq.question}
                      type="button"
                      role="option"
                      className="legal-faq-suggestion"
                      // Fires before the input's onBlur, so the click is
                      // handled before the dropdown gets hidden out from
                      // under it.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleFaqSelect(faq)}
                    >
                      <FaSearch aria-hidden="true" />
                      <span>{faq.question}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="legal-selector-wrap">
        <div className="legal-selector-grid">
          {Object.entries(POLICIES).map(([key, p]) => (
            <button
              key={key}
              type="button"
              className={cx("legal-selector-card", `legal-selector-card--${key}`, activeTab === key && "is-active")}
              onClick={() => handleTabChange(key)}
              aria-pressed={activeTab === key}
            >
              <span className={cx("legal-badge", `legal-badge--${key}`)}>{p.badge}</span>
              <span className="legal-selector-icon">{p.icon}</span>
              <span className="legal-selector-title">{p.label}</span>
              <span className="legal-selector-desc">{p.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="legal-main-grid">
        <aside className="legal-toc">
          <div className="legal-toc-inner">
            <h2>On this page</h2>
            <nav aria-label={`${policy.label} table of contents`}>
              {filteredSections.map((section, index) => (
                <a key={section.id} href={`#${section.id}`} onClick={(e) => handleTocClick(e, section.id)}>
                  <span className={cx("legal-toc-num", `legal-toc-num--${activeTab}`)}>{index + 1}</span>
                  {section.title}
                </a>
              ))}
              {filteredSections.length === 0 && <p className="legal-toc-empty">No matches.</p>}
            </nav>
          </div>
        </aside>

        <main className="legal-doc-card">
          <header className="legal-doc-header">
            <span className={cx("legal-badge", `legal-badge--${activeTab}`)}>{policy.badge}</span>
            <h1>{policy.label}</h1>
            <p className="legal-doc-updated">Effective date: {policy.effectiveDate}</p>
            <p className="legal-doc-intro">{policy.intro}</p>
          </header>

          {filteredSections.length === 0 ? (
            <p className="legal-no-results">
              No sections of {policy.label} match "{query}". Try a different search term, or{" "}
              <button type="button" className="legal-clear-search" onClick={() => setQuery("")}>
                clear the search
              </button>
              .
            </p>
          ) : (
            filteredSections.map((section, index) => (
              <section id={section.id} key={section.id} className="legal-clause-card">
                <div className={cx("legal-clause-number", `legal-clause-number--${activeTab}`)}>{index + 1}</div>
                <div className="legal-clause-body">
                  <h3>{section.title}</h3>
                  {section.body}
                </div>
              </section>
            ))
          )}
        </main>
      </div>

      <div className="legal-dpo-footer">
        <div className="legal-dpo-footer-inner">
          <span className="legal-dpo-badge">
            <FaShieldAlt aria-hidden="true" /> Data Protection Officer
          </span>
          <h2>PESO Marinduque — Data Protection Officer</h2>
          <p>Public Employment Service Office, Provincial Capitol, Boac, Marinduque</p>
          <p>
            For questions about these Terms, data privacy concerns, access requests, or to exercise
            any of your rights as a data subject, please reach out through the platform's Messages
            feature or your local PESO office. You may also file a complaint with the{" "}
            <strong>National Privacy Commission</strong> at <strong>privacy.gov.ph</strong> if a
            concern remains unresolved.
          </p>
          <div className="legal-dpo-links">
            <Link to="/terms">Terms of Service</Link>
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/cookies">Cookie Policy</Link>
          </div>
        </div>
      </div>

      <footer className="footer-v2">
        <div className="footer-v2-background-overlay"></div>
        <div className="footer-v2-content">
          <div className="footer-v2-logos">
            <div className="footer-v2-yellow-box">
              <img src={pesoLogo} alt="PESO Marinduque Logo" className="footer-v2-logo-img" />
            </div>
            <div className="footer-v2-seal">
              <img src={provincialSeal} alt="Provincial Seal" className="footer-v2-seal-img" />
            </div>
          </div>
          <div className="footer-v2-text">
            <p className="footer-v2-label">LIVELIHOOD MANPOWER DEVELOPMENT</p>
            <h2 className="footer-v2-title">PUBLIC EMPLOYMENT SERVICE OFFICE</h2>
            <p className="footer-v2-subtitle">Lalawigan ng Marinduque</p>
          </div>
          <div className="footer-v2-contact" aria-label="Contact links">
            <a className="footer-v2-contact-link" href="tel:+639567844364" aria-label="Call the office" title="Call the office">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M6.6 10.8c1.5 2.9 3.7 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1.1-.2 1.2.4 2.5.7 3.8.7.6 0 1.1.5 1.1 1.1v3.5c0 .6-.5 1.1-1.1 1.1C11.7 21.4 2.6 12.3 2.6 1.7c0-.6.5-1.1 1.1-1.1h3.5c.6 0 1.1.5 1.1 1.1 0 1.3.2 2.6.7 3.8.1.4 0 .8-.2 1.1l-2.2 2.2Z" />
              </svg>
            </a>
            <a className="footer-v2-contact-link" href="https://compose.mail.yahoo.com/?to=lmdpeso@yahoo.com" target="_blank" rel="noopener noreferrer" aria-label="Email the office" title="Email the office">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M3 5.5h18v13H3v-13Zm1.5 1.8 7.5 5.2 7.5-5.2M4.5 17l5.1-4.1m9.9 4.1-5.1-4.1" />
              </svg>
            </a>
            <a className="footer-v2-contact-link" href="https://web.facebook.com/LMDPESOMarinduqueOfficial" target="_blank" rel="noopener noreferrer" aria-label="Visit our Facebook page" title="Visit our Facebook page">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M13.4 21v-8h2.7l.4-3h-3.1V8.1c0-.9.3-1.5 1.6-1.5h1.7V4a21 21 0 0 0-2.4-.1c-2.4 0-4 1.5-4 4.1V10H7.6v3h2.7v8h3.1Z" />
              </svg>
            </a>
          </div>
        </div>
        <div className="footer-v2-copyright">
          <p>Copyright {year} Provincial Government of Marinduque. All Rights Reserved.</p>
        </div>
      </footer>
    </div>
  );
}
