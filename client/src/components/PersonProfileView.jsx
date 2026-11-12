import { FaArrowLeft } from "react-icons/fa";
import { useTranslation } from "react-i18next";
import Avatar from "./Avatar";
import ProfileBanner from "./ProfileBanner";
import ProfileAbout from "./ProfileAbout";
import { hasAboutContent } from "../utils/profileAbout";
import { jobDates, personSections } from "../utils/personProfile";
import "../styles/profile-redesign.css";
import "../styles/profile-card.css";

// A jobseeker's profile as another person sees it: the header, then About, Work
// experience and Skills, and nothing else (no tabs, no edit controls, no contact or
// personal details). The server already removed everything else; this shows only
// what it returned, and an empty section is simply absent. `data` is the response of
// GET /profiles/:id (or the employer's connected-profile endpoint): { user, profile }.
const Section = ({ id, title, children }) => (
  <section className="rd2-section ds-card person-section" aria-labelledby={id}>
    <div className="rd2-section-head">
      <h2 id={id}>{title}</h2>
    </div>
    {children}
  </section>
);

export default function PersonProfileView({ data, onBack }) {
  const { t } = useTranslation();
  const user = data?.user || {};
  const profile = data?.profile || {};
  const { about, skills, work, place } = personSections({ user, profile });
  // Present only when the person shared it with this employer, or applied to them.
  const contact = [user.phone, user.email].filter(Boolean).join(" · ");
  const name = user.name || "";
  // About shows what this viewer's response carries: the bio, the one desired position,
  // the job search status and the coarse place. Preferred work locations and the full
  // position list are not in this response, so they are not shown here.
  const aboutProps = {
    bio: about,
    positions: user.desiredJobTitle ? [user.desiredJobTitle] : [],
    status: user.availabilityStatus || "",
    address: place,
    locations: [],
    isOwner: false,
  };
  const showAbout = hasAboutContent(aboutProps);
  const nothingToShow = !showAbout && skills.length === 0 && work.length === 0;

  return (
    <>
      {onBack ? (
        <button type="button" className="person-backbtn" onClick={onBack}>
          <FaArrowLeft aria-hidden="true" /> {t("person.back")}
        </button>
      ) : null}
      <header className="rd2-head ds-card">
        <ProfileBanner cover={user.cover} />
        <div className="rd2-head-row">
          <div className="rd2-avatar-wrap">
            <span className="rd2-avatar" aria-hidden="true">
              <Avatar size="fill" name={name} photo={user.profileImage} preset={user.avatarPreset} />
            </span>
          </div>
          <div className="rd2-head-main">
            <h1 className="rd2-name">{name}</h1>
            {user.availabilityStatus ? (
              <div className="rd2-badges">
                <span className="rd2-status">
                  <i className="rd2-dot" />
                  {user.availabilityStatus}
                </span>
              </div>
            ) : null}
            {place ? <p className="person-line">{place}</p> : null}
            {contact ? <p className="person-line">{contact}</p> : null}
          </div>
        </div>
      </header>

      <main className="person-main">
        <div className="person-col">
          {showAbout ? (
            <Section id="pv-about" title={t("person.about")}>
              <ProfileAbout {...aboutProps} />
            </Section>
          ) : null}
          {work.length > 0 ? (
            <Section id="pv-work" title={t("person.work")}>
              <ul className="person-timeline">
                {work.map((job, index) => (
                  <li key={`${job.companyName}-${job.position}-${index}`}>
                    <span className="person-timeline__title">{job.position || job.companyName}</span>
                    {job.position && job.companyName ? <span className="person-timeline__org">{job.companyName}</span> : null}
                    {jobDates(job) ? <span className="person-muted">{jobDates(job)}</span> : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {skills.length > 0 ? (
            <Section id="pv-skills" title={t("person.skills")}>
              <ul className="person-chips">
                {skills.map((skill) => (
                  <li key={skill}>{skill}</li>
                ))}
              </ul>
            </Section>
          ) : null}
          {nothingToShow ? <p className="person-empty">{t("person.empty")}</p> : null}
        </div>
      </main>
    </>
  );
}
