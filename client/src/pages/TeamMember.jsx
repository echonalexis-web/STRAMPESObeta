import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import SiteFooter from "../components/SiteFooter";
import TeamCertificates from "../components/TeamCertificates";
import { findTeamMember, neighborsOf } from "../data/teamMembers";
import "../styles/team-member.css";

// Only http(s) links are rendered, so a typo in the data file can never produce a
// javascript: URL.
const safeUrl = (url) => (/^https?:\/\//i.test(String(url || "")) ? url : null);
const safeEmail = (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "")) ? v : null);

const CLAMP_AT = 300;

const GITHUB_PATH =
  "M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.9-1.29 2.74-1.02 2.74-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z";
const LINKEDIN_PATH =
  "M6.5 9h-3v11h3V9ZM5 4a1.8 1.8 0 1 0 0 3.6A1.8 1.8 0 0 0 5 4Zm5.5 5H7.6v11h3v-5.8c0-1.6.8-2.5 2.1-2.5 1.2 0 1.9.8 1.9 2.5V20h3v-6.6c0-3-1.6-4.6-3.9-4.6-1.3 0-2.2.6-2.7 1.4V9Z";

// Stroke icons (24px grid) drawn inline so no icon library is needed. `fill` icons are brand marks.
const ICONS = {
  mail: { d: ["M3 6h18v12H3V6Z", "m3 7 9 6 9-6"] },
  globe: { d: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18", "M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z"] },
  github: { fill: GITHUB_PATH },
  linkedin: { fill: LINKEDIN_PATH },
};

function Icon({ name }) {
  const icon = ICONS[name];
  if (!icon) return null;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={icon.fill ? "tp-svg tp-svg--fill" : "tp-svg"}>
      {icon.fill ? <path d={icon.fill} /> : icon.d.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

const reducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Smooth-scrolls to a section and moves focus to its heading so keyboard users land there.
function scrollToId(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView?.({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  const heading = el.querySelector("h2") || el;
  heading.focus?.({ preventScroll: true });
}

const norm = (s) => String(s || "").toLowerCase().replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();

// The standing chip is skipped when an award already says the same thing
// ("Dean's Lister" award vs "Dean's Lister, 2nd semester..." standing).
function standingIsRedundant(standing, achievements) {
  const s = norm(standing);
  if (!s) return true;
  return (achievements || []).some((a) => {
    const title = norm(a.title);
    return title && (title.startsWith(s) || s.startsWith(title));
  });
}

const meta = (...parts) => parts.filter(Boolean).join(" · ");

function Section({ id, titleKey, children }) {
  const { t } = useTranslation();
  const headingId = `${id}-title`;
  return (
    <section id={id} className="tp-section" aria-labelledby={headingId}>
      <h2 id={headingId} className="tp-section__title" tabIndex={-1}>{t(titleKey)}</h2>
      {children}
    </section>
  );
}

function ProjectCard({ project, id }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const long = (project.description || "").length > CLAMP_AT;
  const descId = `${id}-desc`;
  return (
    <li id={id} className="tp-project">
      <div className="tp-project__head">
        <h3 className="tp-project__title">{project.title}</h3>
        <span className="tp-project__pills">
          {project.year && <span className="tp-pill">{project.year}</span>}
          {project.badge && <span className="tp-pill tp-pill--gold">{project.badge}</span>}
        </span>
      </div>
      {project.description && (
        <>
          <p id={descId} className={`tp-project__text${long && !open ? " is-clamped" : ""}`}>{project.description}</p>
          {long && (
            <button type="button" className="tp-link-btn" aria-expanded={open} aria-controls={descId} onClick={() => setOpen((v) => !v)}>
              {open ? t("teamProfile.showLess") : t("teamProfile.readMore")}
            </button>
          )}
        </>
      )}
    </li>
  );
}

export default function TeamMember() {
  const { slug } = useParams();
  const { t } = useTranslation();
  const member = findTeamMember(slug);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  if (!member) return <Navigate to="/about#team" replace />;

  const { prev, next } = neighborsOf(member.slug);
  const projects = member.projects || [];
  const achievements = member.achievements || [];
  const activities = member.activities || [];
  const certificates = member.certifications || [];
  const responsibilities = member.responsibilities || [];
  const expertise = member.expertise || [];
  const school = member.school || {};
  const raw = member.links || {};

  // The hero shows only a short intro (or the template). `intro` and `longBio` both live in
  // About so none of the member's text is dropped.
  const aboutText = [member.intro, member.longBio].filter(Boolean).join("\n\n");
  const showSpecial = member.specialRole && !norm(member.role).includes(norm(member.specialRole));
  const intro = member.shortIntro || t("teamProfile.introTemplate", { role: member.role });

  const buttons = [
    ["linkedin", "LinkedIn", safeUrl(raw.linkedin), true],
    ["github", "GitHub", safeUrl(raw.github), true],
    ["mail", t("teamProfile.email"), safeEmail(raw.email) && `mailto:${raw.email}`, false],
    ["globe", t("teamProfile.website"), safeUrl(raw.website), true],
  ].filter(([, , href]) => href);

  const standing = school.standing
    ? school.gwa ? `${school.standing} (${t("teamProfile.gwa", { gwa: school.gwa })})` : school.standing
    : school.gwa ? t("teamProfile.gwa", { gwa: school.gwa }) : null;
  const standingNote = school.gwa ? t("teamProfile.gwaNote") : school.standingNote || null;
  const facts = [
    ["school", school.name],
    ["program", school.program],
    ["yearLevel", school.yearLabel || school.year],
    ["major", school.major],
    ["standing", standing],
  ].filter(([, v]) => v);

  const glance = [
    ["tp-awards", "award", achievements.length],
    ["tp-projects", "project", projects.length],
    ["tp-activities", "activity", activities.length],
    ["tp-certificates", "certificate", certificates.length],
  ].filter(([, , n]) => n > 0);
  const showStandingChip = !standingIsRedundant(school.standing, achievements);
  const showGlance = glance.length > 0 || showStandingChip;

  const showSide = expertise.length > 0 || Boolean(member.funFact);
  const [featured, ...restAwards] = achievements;
  const projectIndex = featured?.projectTitle
    ? projects.findIndex((p) => p.title === featured.projectTitle)
    : -1;

  return (
    <main className="team-profile">
      <header className="tp-hero">
        <div className="tp-wrap">
          <Link className="tp-back" to="/about#team">&larr; {t("teamProfile.back")}</Link>
          <div className={`tp-hero__grid${facts.length ? "" : " tp-hero__grid--single"}`}>
            <div className="tp-hero__main">
              <div className="tp-avatar">
                {member.photo ? (
                  <img src={member.photo} alt={member.name} width="140" height="140" decoding="async" />
                ) : (
                  <span aria-hidden="true">{member.initials}</span>
                )}
              </div>
              <div className="tp-hero__text">
                <h1 className="tp-name">{member.name}</h1>
                <p className="tp-role">{member.role}</p>
                {member.alias && <p className="tp-alias">{t("teamProfile.goesBy", { alias: member.alias })}</p>}
                {showSpecial && <p className="tp-special">{member.specialRole}</p>}
                <p className="tp-intro">{intro}</p>
                {buttons.length > 0 && (
                  <ul className="tp-actions">
                    {buttons.map(([icon, label, href, external]) => (
                      <li key={icon}>
                        <a
                          className="tp-btn"
                          href={href}
                          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                        >
                          <Icon name={icon} />
                          {label}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {facts.length > 0 && (
              <section className="tp-facts-card" aria-labelledby="tp-facts-title">
                <h2 id="tp-facts-title" className="tp-facts-card__title">{t("teamProfile.quickFacts")}</h2>
                <dl className="tp-facts">
                  {facts.map(([key, value]) => (
                    <div className="tp-fact" key={key}>
                      <dt>{t(`teamProfile.${key}`)}</dt>
                      <dd>
                        {value}
                        {key === "standing" && standingNote && <span className="tp-fact__note">{standingNote}</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
          </div>
        </div>
      </header>

      {member.quote && (
        <div className="tp-quote-band">
          <div className="tp-wrap">
            <figure className="tp-quote">
              <figcaption className="tp-quote__label">{t("teamProfile.quoteCaption")}</figcaption>
              <blockquote>{member.quote}</blockquote>
            </figure>
          </div>
        </div>
      )}

      {showGlance && (
        <nav className="tp-glance" aria-label={t("teamProfile.glance")}>
          <div className="tp-wrap tp-glance__inner">
            <ul className="tp-glance__list">
              {glance.map(([id, key, count]) => (
                <li key={id}>
                  <button type="button" className="tp-chip tp-chip--btn" onClick={() => scrollToId(id)}>
                    {t(`teamProfile.${key}`, { count })}
                  </button>
                </li>
              ))}
              {showStandingChip && <li><span className="tp-chip">{school.standing}</span></li>}
            </ul>
            <p className="tp-glance__note">{t("teamProfile.glanceNote")}</p>
          </div>
        </nav>
      )}

      <div className="tp-wrap">
        <div className={`tp-layout${showSide ? "" : " tp-layout--single"}`}>
          <div className="tp-main">
            {aboutText && (
              <Section id="tp-about" titleKey="teamProfile.about">
                {aboutText.split(/\n{2,}/).map((para, i) => <p className="tp-text" key={i}>{para}</p>)}
              </Section>
            )}

            {responsibilities.length > 0 && (
              <Section id="tp-responsibilities" titleKey="teamProfile.responsibilities">
                <ul className="tp-bullets">{responsibilities.map((x) => <li key={x}>{x}</li>)}</ul>
              </Section>
            )}

            {projects.length > 0 && (
              <Section id="tp-projects" titleKey="teamProfile.projects">
                <ul className="tp-project-list">
                  {projects.map((p, i) => <ProjectCard key={p.title} project={p} id={`tp-project-${i}`} />)}
                </ul>
              </Section>
            )}

            {featured && (
              <Section id="tp-awards" titleKey="teamProfile.awards">
                <article className="tp-featured">
                  <div className="tp-featured__head">
                    <h3 className="tp-featured__title">{featured.title}</h3>
                    {featured.year && <span className="tp-pill tp-pill--gold">{featured.year}</span>}
                  </div>
                  {featured.issuer && <p className="tp-featured__issuer">{featured.issuer}</p>}
                  {featured.description && <p className="tp-text">{featured.description}</p>}
                  {projectIndex >= 0 && (
                    <button type="button" className="tp-link-btn" onClick={() => scrollToId(`tp-project-${projectIndex}`)}>
                      {t("teamProfile.seeProject", { title: featured.projectTitle })}
                    </button>
                  )}
                </article>
                {restAwards.length > 0 && (
                  <ul className="tp-compact">
                    {restAwards.map((a, i) => (
                      <li key={`${a.title}-${i}`}>
                        <strong>{a.title}</strong>
                        {meta(a.issuer, a.year) && <span className="tp-meta">{meta(a.issuer, a.year)}</span>}
                        {a.description && <p>{a.description}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            )}

            {activities.length > 0 && (
              <Section id="tp-activities" titleKey="teamProfile.activities">
                <ul className="tp-compact tp-compact--grid">
                  {activities.map((a, i) => (
                    <li key={`${a.name}-${a.role}-${i}`}>
                      <strong>{a.name}</strong>
                      {meta(a.role, a.period) && <span className="tp-meta">{meta(a.role, a.period)}</span>}
                      {a.description && <p>{a.description}</p>}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {certificates.length > 0 && (
              <Section id="tp-certificates" titleKey="teamProfile.certificates">
                <TeamCertificates certificates={certificates} />
              </Section>
            )}
          </div>

          {showSide && (
            <aside className="tp-side">
              {expertise.length > 0 && (
                <section className="tp-card" aria-labelledby="tp-expertise-title">
                  <h2 id="tp-expertise-title" className="tp-card__title">{t("teamProfile.expertise")}</h2>
                  <ul className="tp-chips">{expertise.map((x) => <li key={x}>{x}</li>)}</ul>
                </section>
              )}
              {member.funFact && (
                <section className="tp-card" aria-labelledby="tp-fun-title">
                  <h2 id="tp-fun-title" className="tp-card__title">{t("teamProfile.funFact")}</h2>
                  <p className="tp-card__text">{member.funFact}</p>
                </section>
              )}
            </aside>
          )}
        </div>

        <nav className="tp-pager" aria-label={t("teamProfile.pagerLabel")}>
          <Link className="tp-pager__link" to={`/about/team/${prev.slug}`} rel="prev">
            <span className="tp-pager__hint">&larr; {t("teamProfile.previous")}</span>
            <span className="tp-pager__name">{prev.name}</span>
          </Link>
          <Link className="tp-pager__link tp-pager__link--next" to={`/about/team/${next.slug}`} rel="next">
            <span className="tp-pager__hint">{t("teamProfile.next")} &rarr;</span>
            <span className="tp-pager__name">{next.name}</span>
          </Link>
        </nav>
      </div>

      <SiteFooter />
    </main>
  );
}
