import { useState } from "react";
import { resolveAssetUrl } from "../services/api";
import "../styles/employer-avatar.css";

/**
 * Employer/company avatar. Shows the uploaded image when there is one,
 * otherwise the first letter of the company (or account) name. The caller
 * passes the sizing/shape class (e.g. "vac-logo", "job-hero-logo").
 */
export default function EmployerAvatar({ employer, name, className = "" }) {
  const [broken, setBroken] = useState(false);

  const raw =
    (employer && (employer.profileImage || employer.avatar || employer.companyLogo || employer.logo)) || "";
  const src = resolveAssetUrl(raw);

  const label = employer?.companyName || employer?.name || name || "E";
  const initial = String(label).trim().charAt(0).toUpperCase() || "E";

  return (
    <span className={`emp-avatar ${className}`.trim()}>
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <span className="emp-avatar-initial">{initial}</span>
      )}
    </span>
  );
}
