import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaCheckCircle } from "react-icons/fa";
import ProfileBanner from "../components/ProfileBanner";
import StateBlock from "../components/StateBlock";
import { profileViewAPI, resolveAssetUrl } from "../services/api";
import "../styles/profile-redesign.css";
import "../styles/profile-card.css";

// Read-only profile of another person (COVER_PHOTO_PLAN.md section 19), built only
// from what GET /profiles/:id returned for this viewer. A section renders only when
// its data is present: nothing hints that a hidden section exists. Every case the
// viewer may not see (hidden, suspended, minor, missing) is the same "unavailable"
// page.

const list = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);
const unique = (items) => [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];

const Section = ({ title, children }) => (
  <section className="rd2-section ds-card person-section">
    <div className="rd2-section-head">
      <h2>{title}</h2>
    </div>
    {children}
  </section>
);

const Chips = ({ items }) => (
  <ul className="person-chips">
    {items.map((item) => (
      <li key={item}>{item}</li>
    ))}
  </ul>
);

const spokenLanguages = (proficiency) => {
  if (!proficiency || typeof proficiency !== "object") return [];
  return Object.entries(proficiency)
    .filter(([, skills]) => skills && typeof skills === "object" && Object.values(skills).some((v) => v === true))
    .map(([language, skills]) => ({ language, skills: Object.entries(skills).filter(([, v]) => v === true).map(([k]) => k) }));
};

const salaryText = (min, max) => {
  const fmt = (n) => Number(n).toLocaleString("en-PH");
  if (min && max) return `PHP ${fmt(min)} to ${fmt(max)}`;
  if (min) return `PHP ${fmt(min)}+`;
  if (max) return `PHP ${fmt(max)}`;
  return "";
};

export default function PersonProfile() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ id: null, status: "loading", data: null });

  useEffect(() => {
    const controller = new AbortController();
    profileViewAPI
      .get(id, controller.signal)
      .then((res) => setState({ id, status: "ready", data: res.data }))
      .catch((error) => {
        if (error?.name === "CanceledError" || error?.code === "ERR_CANCELED") return;
        setState({ id, status: error?.response?.status === 404 ? "unavailable" : "error", data: null });
      });
    return () => controller.abort();
  }, [id]);

  const current = state.id === id ? state : { status: "loading", data: null };

  if (current.status === "loading") {
    return (
      <div className="rd-page">
        <section className="rd-shell">
          <StateBlock kind="loading" />
        </section>
      </div>
    );
  }

  if (current.status === "unavailable" || current.status === "error") {
    return (
      <div className="rd-page">
        <section className="rd-shell">
          <StateBlock
            kind={current.status === "error" ? "error" : "empty"}
            title={current.status === "error" ? t("person.errorTitle") : t("person.unavailableTitle")}
            description={current.status === "error" ? t("person.errorBody") : t("person.unavailableBody")}
            action={
              <button type="button" className="rd2-btn rd2-btn--ghost" onClick={() => navigate(-1)}>
                {t("person.back")}
              </button>
            }
          />
        </section>
      </div>
    );
  }

  const { data } = current;
  const user = data.user || {};
  const profile = data.profile || {};
  const employer = data.role === "employer";
  const name = employer ? user.companyName || user.name : user.name;
  const avatar = user.profileImage ? resolveAssetUrl(user.profileImage) : "";
  const roleLabel = t(`profileCard.role.${data.role}`);
  const municipality = profile.presentAddress ? [profile.presentAddress.municipality, profile.presentAddress.province].filter(Boolean).join(", ") : "";
  const place = user.address || municipality;

  const skills = unique([...list(user.skills), ...list(profile.skills)]);
  const education = [
    user.educationalAttainment,
    profile.course,
    profile.schoolAttended === "Other" ? profile.schoolAttendedOther : profile.schoolAttended,
    profile.yearGraduated,
  ].filter(Boolean);
  const work = list(profile.workHistory);
  const languages = spokenLanguages(profile.languageProficiency);
  const preferences = unique([...list(profile.preferredOccupations), ...list(profile.preferredIndustries), ...list(profile.preferredJobTypes), ...list(profile.preferredWorkNature)]);
  const salary = salaryText(profile.expectedSalaryMin, profile.expectedSalaryMax);
  const training = list(profile.vocationalTrainings);
  const credentials = [...list(profile.eligibilities), ...list(profile.professionalLicenses)];

  return (
    <div className="rd-page">
      <section className="rd-shell">
        <header className="rd2-head ds-card">
          <ProfileBanner cover={user.cover} />
          <div className="rd2-head-row">
            <div className={`rd2-avatar-wrap${employer ? " rd2-avatar-wrap--company" : ""}`}>
              <span className={`rd2-avatar${employer ? " rd2-avatar--company" : ""}`} aria-hidden="true">
                {avatar ? <img src={avatar} alt="" /> : (String(name || "?").trim()[0] || "?").toUpperCase()}
              </span>
            </div>
            <div className="rd2-head-main">
              <h1 className="rd2-name">{name}</h1>
              <div className="rd2-badges">
                <span className="rd2-role">{roleLabel}</span>
                {employer && user.industry ? <span className="rd2-role">{user.industry}</span> : null}
                {!employer && user.desiredJobTitle ? <span className="rd2-role">{user.desiredJobTitle}</span> : null}
                {employer && user.verified ? (
                  <span className="pcard__verified">
                    <FaCheckCircle aria-hidden="true" /> {t("profileCard.verified")}
                  </span>
                ) : null}
              </div>
              {!employer && place ? <p className="person-line">{place}</p> : null}
              {employer && user.businessAddress ? <p className="person-line">{user.businessAddress}</p> : null}
              {!employer && (user.phone || user.email) ? (
                <p className="person-line">
                  {[user.phone, user.email].filter(Boolean).join(" · ")}
                </p>
              ) : null}
              {!employer && data.mode === "hiring" && !data.contactShared ? <p className="person-note">{t("person.contactNote")}</p> : null}
            </div>
          </div>
        </header>

        <main className="person-main">
          {employer && user.companyDescription ? (
            <Section title={t("person.about")}>
              <p>{user.companyDescription}</p>
            </Section>
          ) : null}
          {employer && user.website ? (
            <Section title={t("person.website")}>
              <a href={user.website} target="_blank" rel="noreferrer">
                {user.website}
              </a>
            </Section>
          ) : null}

          {!employer && user.about ? (
            <Section title={t("person.about")}>
              <p>{user.about}</p>
            </Section>
          ) : null}
          {!employer && skills.length > 0 ? (
            <Section title={t("person.skills")}>
              <Chips items={skills} />
            </Section>
          ) : null}
          {!employer && education.length > 0 ? (
            <Section title={t("person.education")}>
              <ul className="person-list">
                {education.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Section>
          ) : null}
          {!employer && (work.length > 0 || user.workExperience) ? (
            <Section title={t("person.work")}>
              {user.workExperience ? <p>{user.workExperience}</p> : null}
              {work.length > 0 ? (
                <ul className="person-list">
                  {work.map((job, index) => (
                    <li key={`${job.companyName}-${index}`}>
                      <strong>{job.position || job.companyName}</strong>
                      {job.position && job.companyName ? <span> · {job.companyName}</span> : null}
                      {job.dateFrom || job.dateTo ? <span className="person-muted"> ({[job.dateFrom, job.dateTo].filter(Boolean).join(" to ")})</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Section>
          ) : null}
          {!employer && (training.length > 0 || credentials.length > 0) ? (
            <Section title={t("person.credentials")}>
              <ul className="person-list">
                {training.map((row, index) => (
                  <li key={`t-${index}`}>{[row.course, row.institution].filter(Boolean).join(" · ")}</li>
                ))}
                {credentials.map((row, index) => (
                  <li key={`c-${index}`}>{row.name}</li>
                ))}
              </ul>
            </Section>
          ) : null}
          {!employer && (preferences.length > 0 || salary) ? (
            <Section title={t("person.preferences")}>
              {preferences.length > 0 ? <Chips items={preferences} /> : null}
              {salary ? <p className="person-line">{t("person.salary")}: {salary}</p> : null}
            </Section>
          ) : null}
          {!employer && languages.length > 0 ? (
            <Section title={t("person.languages")}>
              <ul className="person-list">
                {languages.map((row) => (
                  <li key={row.language}>
                    <strong>{row.language}</strong> <span className="person-muted">({row.skills.join(", ")})</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </main>

        <p className="person-back">
          <Link to="/dashboard" onClick={(event) => { event.preventDefault(); navigate(-1); }}>
            {t("person.back")}
          </Link>
        </p>
      </section>
    </div>
  );
}
