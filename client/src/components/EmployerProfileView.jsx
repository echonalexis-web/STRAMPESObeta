import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaArrowLeft, FaCheckCircle, FaMapMarkerAlt } from "react-icons/fa";
import Avatar from "./Avatar";
import Pagination from "./Pagination";
import ProfileBanner from "./ProfileBanner";
import StateBlock from "./StateBlock";
import VacancyCard from "./VacancyCard";
import { profileViewAPI } from "../services/api";
import { addressLines, jobseekerSections, locationLine, postingsViewState, representativeRows } from "../utils/employerProfileView";
import "../styles/employer-profile-view.css";

// The company page a signed-in jobseeker sees (the server answers mode "jobseeker"):
// header, About, Business address, Owner and authorized person, Job postings, in
// that order. The server sends only those fields; nothing here asks for more.

function Card({ id, title, children }) {
  return (
    <section className="rd2-section ds-card person-section epv-card" aria-labelledby={id}>
      <div className="rd2-section-head">
        <h2 id={id}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Postings({ employerId }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const listRef = useRef(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ key: "", failed: false, items: [], total: 0, loadedOnce: false });
  const key = `${employerId}|${page}|${pageSize}|${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    profileViewAPI
      .jobs(employerId, { page, limit: pageSize }, controller.signal)
      .then((res) => {
        const body = res.data || {};
        setResult({ key, failed: false, items: Array.isArray(body.items) ? body.items : [], total: Number(body.total) || 0, loadedOnce: true });
      })
      .catch((error) => {
        if (error?.name === "CanceledError" || error?.code === "ERR_CANCELED") return;
        setResult((prev) => ({ ...prev, key, failed: true }));
      });
    return () => controller.abort();
  }, [employerId, page, pageSize, key]);

  // Loading is derived: the stored answer belongs to an older request until the new one lands.
  const status = result.key !== key ? "loading" : result.failed ? "error" : "ready";
  const state = { ...result, status };
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const view = postingsViewState(state);
  const title = state.loadedOnce ? t("person.postingsCount", { count: state.total }) : t("person.postings");

  return (
    <Card id="epv-postings" title={title}>
      <div ref={listRef} className="epv-postings" aria-busy={state.status === "loading"}>
        {view === "loading" ? (
          <div className="epv-skeletons" role="status" aria-live="polite">
            <span className="ds-sr-only">{t("common.loading")}</span>
            {[0, 1, 2].map((n) => (
              <span key={n} className="ds-skeleton epv-skeleton" aria-hidden="true" />
            ))}
          </div>
        ) : null}
        {view === "error" ? <StateBlock kind="error" title={t("person.postingsErrorTitle")} description={t("person.postingsErrorBody")} onRetry={retry} /> : null}
        {view === "empty" ? <StateBlock kind="empty" title={t("person.postingsEmpty")} description={t("person.postingsEmptyHint")} /> : null}
        {view === "list" ? (
          <div className="epv-list">
            {state.items.map((job) => (
              <VacancyCard key={job._id} job={job} publicView matchAvailable={false} onOpen={() => navigate(`/jobs/${job._id}`)} />
            ))}
          </div>
        ) : null}
      </div>
      <Pagination
        total={state.total}
        page={page}
        pageSize={pageSize}
        disabled={state.status === "loading"}
        label={t("pagination.items.jobs")}
        idPrefix="employer-postings"
        scrollTargetRef={listRef}
        variant="card"
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </Card>
  );
}

export default function EmployerProfileView({ data, employerId, onBack }) {
  const { t } = useTranslation();
  const user = data.user || {};
  const profile = data.profile || {};
  const name = user.companyName || user.name;
  const sections = jobseekerSections(data);
  const place = locationLine(profile.businessAddress);
  const rows = representativeRows(profile);

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
            {place ? <p className="person-line">{place}</p> : null}
          </div>
        </div>
      </header>
      <main className="person-main epv-main">
        <div className="person-col">
          {sections.about ? (
            <Card id="epv-about" title={t("person.about")}>
              <p className="person-about">{user.companyDescription}</p>
            </Card>
          ) : null}
          {sections.address ? (
            <Card id="epv-address" title={t("person.businessAddress")}>
              <p className="epv-address">
                <FaMapMarkerAlt aria-hidden="true" className="epv-address__icon" />
                <span>
                  {addressLines(profile.businessAddress).map((line, i) => (
                    <span key={i} className="epv-address__line">
                      {line}
                    </span>
                  ))}
                </span>
              </p>
            </Card>
          ) : null}
          {sections.representatives ? (
            <Card id="epv-people" title={t("person.ownerAndAuthorized")}>
              <ul className="epv-people">
                {rows.map((row) => (
                  <li key={row.key}>
                    <dl className="epv-dl">
                      <div>
                        <dt>{t("person.nameLabel")}</dt>
                        <dd>{row.name}</dd>
                      </div>
                      <div>
                        <dt>{t("person.designationLabel")}</dt>
                        <dd>{row.position || (row.key === "owner" ? t("person.ownerDesignation") : t("person.authorizedDesignation"))}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Postings employerId={employerId} />
        </div>
      </main>
    </>
  );
}
