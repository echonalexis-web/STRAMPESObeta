import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaArrowLeft, FaCheckCircle } from "react-icons/fa";
import Avatar from "../components/Avatar";
import PersonProfileView from "../components/PersonProfileView";
import ProfileBanner from "../components/ProfileBanner";
import StateBlock from "../components/StateBlock";
import { profileViewAPI } from "../services/api";
import "../styles/profile-redesign.css";
import "../styles/profile-card.css";

// Read-only profile of another person (COVER_PHOTO_PLAN.md section 19), built only
// from what GET /profiles/:id returned for this viewer. A jobseeker is shown as the
// header plus About, Work experience and Skills (PersonProfileView); an employer as
// its public company card. Every case the viewer may not see (hidden, suspended,
// minor, missing) is the same "unavailable" page, with no hint of what exists.

const Section = ({ id, title, children }) => (
  <section className="rd2-section ds-card person-section" aria-labelledby={id}>
    <div className="rd2-section-head">
      <h2 id={id}>{title}</h2>
    </div>
    {children}
  </section>
);

function EmployerCard({ data, onBack }) {
  const { t } = useTranslation();
  const user = data.user || {};
  const name = user.companyName || user.name;
  return (
    <>
      <button type="button" className="person-backbtn" onClick={onBack}>
        <FaArrowLeft aria-hidden="true" /> {t("person.back")}
      </button>
      <header className="rd2-head ds-card">
        <ProfileBanner cover={user.cover} />
        <div className="rd2-head-row">
          <div className="rd2-avatar-wrap rd2-avatar-wrap--company">
            <span className="rd2-avatar rd2-avatar--company" aria-hidden="true">
              <Avatar size="fill" name={name} photo={user.profileImage} />
            </span>
          </div>
          <div className="rd2-head-main">
            <h1 className="rd2-name">{name}</h1>
            <div className="rd2-badges">
              <span className="rd2-role">{t("profileCard.role.employer")}</span>
              {user.industry ? <span className="rd2-role">{user.industry}</span> : null}
              {user.verified ? (
                <span className="pcard__verified">
                  <FaCheckCircle aria-hidden="true" /> {t("profileCard.verified")}
                </span>
              ) : null}
            </div>
            {user.businessAddress ? <p className="person-line">{user.businessAddress}</p> : null}
          </div>
        </div>
      </header>
      <main className="person-main">
        <div className="person-col">
          {user.companyDescription ? (
            <Section id="pe-about" title={t("person.about")}>
              <p>{user.companyDescription}</p>
            </Section>
          ) : null}
          {user.website ? (
            <Section id="pe-website" title={t("person.website")}>
              <a href={user.website} target="_blank" rel="noreferrer">
                {user.website}
              </a>
            </Section>
          ) : null}
        </div>
      </main>
    </>
  );
}

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
  const onBack = () => navigate(-1);

  return (
    <div className="rd-page">
      <section className="rd-shell">{data.role === "employer" ? <EmployerCard data={data} onBack={onBack} /> : <PersonProfileView data={data} onBack={onBack} />}</section>
    </div>
  );
}
