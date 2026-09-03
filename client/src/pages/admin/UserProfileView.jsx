import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  FaArrowLeft,
  FaBriefcase,
  FaBuilding,
  FaCalendarAlt,
  FaEnvelope,
  FaFileAlt,
  FaIdBadge,
  FaMapMarkerAlt,
  FaUser,
} from "react-icons/fa";
import { adminAPI } from "../../services/api";
import "../../styles/adminUserProfile.css";

const API_ORIGIN = "http://localhost:3000";

const formatDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

const formatAddress = (value) => {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "object") {
    const parts = [value.street, value.barangay, value.municipality, value.province, value.region].filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }
  return null;
};

const initialsFromName = (name) => {
  if (!name) return "U";
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
};

const Field = ({ label, value, full = false, children }) => {
  const isEmpty = children ? false : value === null || value === undefined || value === "";
  return (
    <div className={`aup-dl__row${full ? " aup-dl__row--full" : ""}`}>
      <dt>{label}</dt>
      <dd className={isEmpty ? "is-empty" : ""}>{children || (isEmpty ? "Not provided" : value)}</dd>
    </div>
  );
};

const DocLink = ({ href, label = "View document" }) =>
  href ? (
    <a className="aup-doclink" href={href} target="_blank" rel="noreferrer">
      <FaFileAlt aria-hidden="true" /> {label}
    </a>
  ) : null;

export default function UserProfileView() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    const loadUser = async () => {
      try {
        const { data } = await adminAPI.getUserById(userId);
        if (!isMounted) return;
        setUser(data?.user || null);
        setProfile(data?.profile || null);
      } catch (err) {
        if (isMounted) {
          setError(err.response?.data?.message || "Failed to load user profile");
          setUser(null);
          setProfile(null);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadUser();
    return () => {
      isMounted = false;
    };
  }, [userId]);

  if (loading) {
    return (
      <div className="aup-page">
        <div className="aup-shell">
          <div className="aup-header">
            <div className="aup-skel" style={{ width: 120, background: "rgba(255,255,255,0.25)" }} />
            <div className="aup-id">
              <div className="aup-skel" style={{ width: 78, height: 78, borderRadius: "50%", background: "rgba(255,255,255,0.25)" }} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                <div className="aup-skel" style={{ width: 90, background: "rgba(255,255,255,0.25)" }} />
                <div className="aup-skel aup-skel--lg" style={{ width: "50%", background: "rgba(255,255,255,0.25)" }} />
              </div>
            </div>
          </div>
          <div className="aup-grid">
            {[0, 1].map((i) => (
              <div className="aup-card" key={i}>
                <div className="aup-skel aup-skel--lg" style={{ width: 160, marginBottom: 18 }} />
                {[0, 1, 2, 3].map((r) => (
                  <div className="aup-skel" style={{ width: `${70 - r * 8}%`, marginBottom: 12 }} key={r} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="aup-page">
        <div className="aup-state">
          <p>{error || "User profile not found."}</p>
          <button type="button" className="aup-state__btn" onClick={() => navigate("/admin/users")}>
            Back to users
          </button>
        </div>
      </div>
    );
  }

  const isEmployer = user.role === "employer";
  const isResident = user.role === "resident" || user.role === "jobseeker" || user.role === "employee";
  const roleLabel = isEmployer ? "Employer" : isResident ? "Jobseeker" : "Administrator";
  const isActive = user.isActive !== false;
  const verification = user.verificationStatus || "unverified";

  const skills = Array.isArray(profile?.skills) ? profile.skills : [];
  const joined = formatDate(user.createdAt);
  const updated = formatDate(user.updatedAt);
  const businessAddress = formatAddress(
    profile?.businessAddress || user?.businessAddress || profile?.address || user?.address,
  );
  const summary = profile?.companyDescription || profile?.bio || "";
  const resumeHref = profile?.resumeFile ? `${API_ORIGIN}${profile.resumeFile}` : null;
  const permitHref = profile?.businessPermitUrl ? `${API_ORIGIN}${profile.businessPermitUrl}` : null;
  const registrationHref = profile?.registrationDocUrl ? `${API_ORIGIN}${profile.registrationDocUrl}` : null;

  return (
    <div className="aup-page">
      <div className="aup-shell">
        <header className="aup-header">
          <button type="button" className="aup-back" onClick={() => navigate("/admin/users")}>
            <FaArrowLeft aria-hidden="true" /> Back to users
          </button>

          <div className="aup-id">
            <div className="aup-avatar">{initialsFromName(user.name)}</div>
            <div className="aup-id__text">
              <p className="aup-kicker">{roleLabel}</p>
              <h1 className="aup-name">{user.name || "Unnamed User"}</h1>
              <div className="aup-chips">
                <span className={`aup-chip ${isActive ? "aup-chip--active" : "aup-chip--inactive"}`}>
                  {isActive ? "Active" : "Inactive"}
                </span>
                {isEmployer ? (
                  <span className={`aup-chip aup-chip--${verification}`}>{verification}</span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="aup-quickfacts">
            {user.email ? (
              <span className="aup-quickfact"><FaEnvelope aria-hidden="true" /> {user.email}</span>
            ) : null}
            {joined ? (
              <span className="aup-quickfact"><FaCalendarAlt aria-hidden="true" /> Joined {joined}</span>
            ) : null}
            <span className="aup-quickfact"><FaIdBadge aria-hidden="true" /> {user._id || userId}</span>
          </div>
        </header>

        <main className="aup-grid">
          <section className="aup-card">
            <div className="aup-card__head">
              <span className="aup-card__icon"><FaUser aria-hidden="true" /></span>
              <h2>Account details</h2>
            </div>
            <dl className="aup-dl">
              <Field label="Email" value={user.email} />
              <Field label="Phone" value={user.phone} />
              <Field label="Role" value={user.role} />
              <Field label="Account status" value={isActive ? "Active" : "Inactive"} />
              <Field label="Joined" value={joined} />
              <Field label="Last updated" value={updated} />
            </dl>
          </section>

          <section className="aup-card">
            <div className="aup-card__head">
              <span className="aup-card__icon">{isEmployer ? <FaBuilding aria-hidden="true" /> : <FaBriefcase aria-hidden="true" />}</span>
              <h2>{isEmployer ? "Company details" : "Professional details"}</h2>
            </div>
            <dl className="aup-dl">
              {isEmployer ? (
                <>
                  <Field label="Company name" value={profile?.companyName} />
                  <Field label="Industry" value={profile?.industry} />
                  <Field label="Trade name" value={profile?.tradeName} />
                  <Field label="Contact person" value={profile?.contactPersonName} />
                  <Field label="Website" value={profile?.website} />
                  <Field label="Business address" value={businessAddress} full />
                </>
              ) : (
                <>
                  <Field label="Desired role" value={profile?.desiredJobTitle} />
                  <Field label="Availability" value={profile?.availabilityStatus} />
                  <Field label="Education" value={profile?.educationalAttainment} />
                  <Field label="Work experience" value={profile?.workExperience} />
                  <Field label="Current location" value={formatAddress(profile?.presentAddress || user.address)} />
                  <Field label="Permanent address" value={formatAddress(profile?.permanentAddress)} />
                </>
              )}
            </dl>
          </section>

          <section className="aup-card aup-card--wide">
            <div className="aup-card__head">
              <span className="aup-card__icon"><FaCalendarAlt aria-hidden="true" /></span>
              <h2>Overview</h2>
            </div>
            <p className={`aup-copy${summary ? "" : " is-empty"}`}>
              {summary || "No profile summary has been provided for this user yet."}
            </p>
            {isResident || skills.length > 0 ? (
              <div className="aup-tags">
                {skills.length > 0 ? (
                  skills.map((skill) => (
                    <span key={skill} className="aup-tag">{skill}</span>
                  ))
                ) : (
                  <span className="aup-tags__empty">No skill tags added.</span>
                )}
              </div>
            ) : null}
          </section>

          <section className="aup-card aup-card--wide">
            <div className="aup-card__head">
              <span className="aup-card__icon"><FaMapMarkerAlt aria-hidden="true" /></span>
              <h2>Contact &amp; documents</h2>
            </div>
            <dl className="aup-dl">
              <Field label="Primary address" value={formatAddress(profile?.address || user.address)} full />
              <Field label="Email">
                {user.email ? <a href={`mailto:${user.email}`}>{user.email}</a> : <span className="is-empty">Not provided</span>}
              </Field>
              <Field label="Phone">
                {user.phone ? <a href={`tel:${user.phone}`}>{user.phone}</a> : <span className="is-empty">Not provided</span>}
              </Field>
              <Field label="Resume">
                {resumeHref ? <DocLink href={resumeHref} label="View resume" /> : "Not uploaded"}
              </Field>
              {isEmployer ? (
                <>
                  <Field label="Business permit">
                    {permitHref ? <DocLink href={permitHref} label="View permit" /> : "Not uploaded"}
                  </Field>
                  <Field label="Registration document">
                    {registrationHref ? <DocLink href={registrationHref} label="View document" /> : "Not uploaded"}
                  </Field>
                </>
              ) : null}
            </dl>
          </section>
        </main>
      </div>
    </div>
  );
}
