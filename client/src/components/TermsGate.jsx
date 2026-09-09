import { useContext, useState } from "react";
import { useLocation } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { authAPI } from "../services/api";
import "../styles/terms.css";
import { FaShieldAlt } from "react-icons/fa";

// Community guidelines shown once, right after a user finishes onboarding and
// sets up their avatar. Front-end only for now: acceptance is persisted to the
// user record so it isn't shown again, but the rules themselves aren't yet
// enforced automatically (reporting + admin oversight is the current control).
const GUIDELINES = [
  {
    title: "Post only genuine, lawful jobs",
    body: "No illegal work, recruitment scams, or listings that charge applicants a fee. Job details, salary, and company identity must be accurate.",
  },
  {
    title: "No discriminatory job criteria",
    body: "Requirements based on age, sex, religion, or civil status are not allowed unless they are a bona fide occupational requirement.",
  },
  {
    title: "Keep profiles and photos appropriate",
    body: "No nudity, hate symbols, violence, or impersonation in your avatar, name, or profile text. Employers must use their real identity.",
  },
  {
    title: "Be respectful in comments and messages",
    body: "No harassment, hate speech, threats, doxxing, or spam on news posts or in direct messages.",
  },
  {
    title: "One account per person or business",
    body: "You must be at least 15 years old. Report anything that breaks these rules — violations can lead to content removal, suspension, or a permanent ban.",
  },
];

export default function TermsGate() {
  const { user, setUser } = useContext(AuthContext);
  const location = useLocation();
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);

  const onboarded = user?.hasCompletedOnboarding === true || user?.onboardingComplete === true;
  const shouldShow =
    !!user &&
    !dismissed &&
    user.role !== "admin" &&
    user.role !== "superadmin" &&
    onboarded &&
    !user.acceptedTermsAt &&
    // Let the user finish onboarding + avatar setup first — that flow lives
    // under /onboarding and has its own success screen.
    !location.pathname.startsWith("/onboarding") &&
    !location.pathname.startsWith("/account-suspended");

  if (!shouldShow) return null;

  const handleAccept = async () => {
    if (!agreed || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const { data } = await authAPI.acceptTerms();
      setUser((prev) => ({
        ...prev,
        acceptedTermsAt: data.acceptedTermsAt || new Date().toISOString(),
        termsVersion: data.termsVersion || prev?.termsVersion,
      }));
      setDismissed(true);
    } catch (err) {
      setError(err?.response?.data?.message || "Could not save your acceptance. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="terms-backdrop" role="dialog" aria-modal="true" aria-labelledby="terms-title">
      <div className="terms-modal">
        <div className="terms-head">
          <span className="terms-icon"><FaShieldAlt /></span>
          <div>
            <h2 id="terms-title">Community Guidelines &amp; Terms</h2>
            <p>Please review and accept before you continue using STRAM PESO.</p>
          </div>
        </div>

        <ul className="terms-list">
          {GUIDELINES.map((item) => (
            <li key={item.title}>
              <strong>{item.title}</strong>
              <span>{item.body}</span>
            </li>
          ))}
        </ul>

        {error ? <div className="terms-error">{error}</div> : null}

        <label className="terms-agree">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>
            I have read and agree to the STRAM PESO Community Guidelines and Terms of Use.
          </span>
        </label>

        <button
          type="button"
          className="terms-accept"
          onClick={handleAccept}
          disabled={!agreed || submitting}
        >
          {submitting ? "Saving…" : "Agree and continue"}
        </button>
      </div>
    </div>
  );
}
