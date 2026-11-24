import { useEffect } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import SiteFooter from "../components/SiteFooter";
import { findTeamMember, neighborsOf, profileSections } from "../data/teamMembers";
import "../styles/team-member.css";

const LINK_LABELS = { linkedin: "LinkedIn", github: "GitHub", website: "Portfolio website" };
const LINK_ICONS = { linkedin: "linkedin", github: "github", website: "globe" };

// Only http(s) links are rendered, so a typo in the data file can never produce a
// javascript: URL.
const safeUrl = (url) => (/^https?:\/\//i.test(String(url || "")) ? url : null);

const GITHUB_PATH =
  "M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.9-1.29 2.74-1.02 2.74-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z";
const LINKEDIN_PATH =
  "M6.5 9h-3v11h3V9ZM5 4a1.8 1.8 0 1 0 0 3.6A1.8 1.8 0 0 0 5 4Zm5.5 5H7.6v11h3v-5.8c0-1.6.8-2.5 2.1-2.5 1.2 0 1.9.8 1.9 2.5V20h3v-6.6c0-3-1.6-4.6-3.9-4.6-1.3 0-2.2.6-2.7 1.4V9Z";

// Stroke icons (24px grid) drawn inline so no icon library is needed. `fill` icons are brand marks.
const ICONS = {
  cap: { d: ["M22 10 12 5 2 10l10 5 10-5Z", "M6 12v5c3 2.5 9 2.5 12 0v-5"] },
  building: { d: ["M3 21h18M5 21V9l7-5 7 5v12", "M9 21v-6h6v6"] },
  book: { d: ["M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z", "M19 17H6a2 2 0 0 0-2 2"] },
  calendar: { d: ["M3 10h18M8 3v4M16 3v4", "M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"] },
  code: { d: ["m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"] },
  award: { d: ["M12 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z", "m8.5 14-1.5 7 5-3 5 3-1.5-7"] },
  link: { d: ["M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1", "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"] },
  globe: { d: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18", "M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z"] },
  arrow: { d: ["M7 17 17 7M8 7h9v9"] },
  spark: { d: ["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"] },
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

function CardHead({ icon, title }) {
  return (
    <div className="tp-card__head">
      <span className="tp-icon"><Icon name={icon} /></span>
      <h2 className="tp-card__title">{title}</h2>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="tp-section">
      <h2 className="tp-section__title">{title}</h2>
      {children}
    </section>
  );
}

function DetailList({ items, renderItem }) {
  return <ul className="tp-detail-list">{items.map((item, i) => <li key={i}>{renderItem(item)}</li>)}</ul>;
}

const meta = (...parts) => parts.filter(Boolean).join(" · ");

export default function TeamMember() {
  const { slug } = useParams();
  const member = findTeamMember(slug);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  if (!member) return <Navigate to="/about#team" replace />;

  const has = profileSections(member);
  const { prev, next } = neighborsOf(member.slug);
  const links = Object.entries(member.links || {})
    .map(([key, url]) => [key, safeUrl(url)])
    .filter(([, url]) => url);
  const school = member.school || {};
  const schoolRows = [
    ["School", school.name, "building"],
    ["Program", school.program, "book"],
    ["Year level", school.year, "calendar"],
    ["Major", school.major, "code"],
    ["Standing", school.standing, "award"],
  ].filter(([, v]) => v);
  const showSidebar = has.school || links.length > 0 || has.funFact;

  return (
    <main className="team-profile">
      <header className="tp-hero">
        <div className="tp-wrap">
          <Link className="tp-back" to="/about#team">&larr; Back to team</Link>
          <div className="tp-hero__body">
            <div className="tp-avatar">
              {member.photo ? (
                <img src={member.photo} alt={member.name} />
              ) : (
                <span aria-hidden="true">{member.initials}</span>
              )}
            </div>
            <div className="tp-hero__text">
              <h1 className="tp-name">{member.name}</h1>
              {member.alias && <p className="tp-alias">Goes by &ldquo;{member.alias}&rdquo;</p>}
              <p className="tp-role">{member.role}</p>
            </div>
            {has.quote && (
              <div className="tp-quote-wrap">
                <span className="tp-quote-label">Bio</span>
                <blockquote className="tp-quote">{member.quote}</blockquote>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="tp-wrap">
        <div className={`tp-layout${showSidebar ? "" : " tp-layout--single"}`}>
          {showSidebar && (
            <aside className="tp-side">
              {has.school && (
                <section className="tp-card">
                  <CardHead icon="cap" title="School" />
                  <dl className="tp-facts">
                    {schoolRows.map(([label, value, icon]) => (
                      <div className="tp-fact" key={label}>
                        <span className="tp-fact__icon"><Icon name={icon} /></span>
                        <div>
                          <dt>{label}</dt>
                          <dd>{value}</dd>
                        </div>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
              {links.length > 0 && (
                <section className="tp-card">
                  <CardHead icon="link" title="Links" />
                  <ul className="tp-links">
                    {links.map(([key, url]) => (
                      <li key={key}>
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          <span className="tp-links__icon"><Icon name={LINK_ICONS[key] || "globe"} /></span>
                          <span className="tp-links__label">{LINK_LABELS[key] || key}</span>
                          <span className="tp-links__go"><Icon name="arrow" /></span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {has.funFact && (
                <section className="tp-card">
                  <CardHead icon="spark" title="Fun fact" />
                  <p className="tp-card__text">{member.funFact}</p>
                </section>
              )}
            </aside>
          )}

          <div className="tp-main">
            <Section title="About">
              <p className="tp-text">{member.intro || member.bio}</p>
            </Section>

            {has.bio && (
              <Section title="Bio">
                {member.longBio.split(/\n{2,}/).map((para, i) => <p className="tp-text" key={i}>{para}</p>)}
              </Section>
            )}

            {has.expertise && (
              <Section title="Expertise">
                <ul className="tp-chips">{member.expertise.map((x) => <li key={x}>{x}</li>)}</ul>
              </Section>
            )}

            {has.responsibilities && (
              <Section title="Responsibilities">
                <ul className="tp-bullets">{member.responsibilities.map((x) => <li key={x}>{x}</li>)}</ul>
              </Section>
            )}

            {has.projects && (
              <Section title="Notable projects">
                <DetailList
                  items={member.projects}
                  renderItem={(p) => (
                    <>
                      <strong>{p.title}</strong>
                      {p.year && <span className="tp-meta">{p.year}</span>}
                      {p.description && <p>{p.description}</p>}
                    </>
                  )}
                />
              </Section>
            )}

            {has.achievements && (
              <Section title="Academic achievements">
                <DetailList
                  items={member.achievements}
                  renderItem={(a) => (
                    <>
                      <strong>{a.title}</strong>
                      <span className="tp-meta">{meta(a.issuer, a.year)}</span>
                      {a.description && <p>{a.description}</p>}
                    </>
                  )}
                />
              </Section>
            )}

            {has.activities && (
              <Section title="Extracurricular activities">
                <DetailList
                  items={member.activities}
                  renderItem={(a) => (
                    <>
                      <strong>{a.name}</strong>
                      <span className="tp-meta">{meta(a.role, a.period)}</span>
                      {a.description && <p>{a.description}</p>}
                    </>
                  )}
                />
              </Section>
            )}

            {has.certifications && (
              <Section title="Certifications">
                <DetailList
                  items={member.certifications}
                  renderItem={(c) => (
                    <>
                      <strong>{c.name}</strong>
                      <span className="tp-meta">
                        {meta(c.issuer, c.year, c.expires && `Expires ${c.expires}`)}
                      </span>
                    </>
                  )}
                />
              </Section>
            )}
          </div>
        </div>

        <nav className="tp-pager" aria-label="Other team members">
          <Link className="tp-pager__link" to={`/about/team/${prev.slug}`} rel="prev">
            <span className="tp-pager__hint">&larr; Previous</span>
            <span className="tp-pager__name">{prev.name}</span>
          </Link>
          <Link className="tp-pager__link tp-pager__link--next" to={`/about/team/${next.slug}`} rel="next">
            <span className="tp-pager__hint">Next &rarr;</span>
            <span className="tp-pager__name">{next.name}</span>
          </Link>
        </nav>
      </div>

      <SiteFooter />
    </main>
  );
}
