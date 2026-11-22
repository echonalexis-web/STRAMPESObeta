import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { FaRegHeart } from "react-icons/fa";
import EmployerAvatar from "./EmployerAvatar";
import JobFavoriteButton from "./JobFavoriteButton";
import { employerName, locationLine, postedAgo, salaryAsPosted } from "../utils/homeJobs";
import "../styles/vacancy-card.css";

// One job in the Home carousel. Same visual family as the Browse Jobs card (vac-* styles),
// cleaned up for a first look: job type chip instead of an "Open" badge, one clear
// "View details" button, title and location clamped to two lines so every card is the same
// height. The heart is for saving a job, which needs an account, so for a visitor it opens
// the log in prompt (a signed-in user gets the normal save heart).
export default function HomeJobCard({ job, onOpen, onSaveLogin, loggedIn = false }) {
  const { t } = useTranslation();
  const name = employerName(job, t("homeJobs.neutralEmployer"));
  const title = job?.title || t("homeJobs.untitled");
  const location = locationLine(job?.location) || t("homeJobs.locationUnknown");
  const salary = salaryAsPosted(job?.salary) || t("homeJobs.salaryNegotiable");
  const openings = Number(job?.slots || 0);
  const posted = postedAgo(job?.createdAt);

  return (
    <article className="vac-card hc-card">
      <div className="vac-card-top">
        <div className="vac-brand">
          <EmployerAvatar employer={job?.employer} name={name} className="vac-logo" />
          <div className="vac-brand-text">
            <span className="vac-company hc-clamp-1" title={name}>{name}</span>
            <h3 className="vac-title hc-clamp-2" title={title}>{title}</h3>
          </div>
        </div>
        <div className="vac-tools">
          {loggedIn ? (
            <JobFavoriteButton jobId={job?._id} hideCount variant="heart" />
          ) : (
            <button
              type="button"
              className="btn-favorite-icon"
              onClick={onSaveLogin}
              aria-label={t("homeJobs.saveLogin")}
              title={t("homeJobs.saveLogin")}
            >
              <FaRegHeart aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="hc-chips">
        {job?.jobType ? <span className="ds-badge hc-type">{job.jobType}</span> : null}
        {openings > 0 ? <span className="hc-openings">{t("homeJobs.openings", { count: openings })}</span> : null}
      </div>

      <p className="hc-location hc-clamp-2" title={location}>{location}</p>
      <p className="hc-salary">{salary}</p>

      <div className="vac-footer hc-footer">
        <span className="vac-footer-meta">{posted ? t("homeJobs.posted", { posted }) : null}</span>
        <div className="vac-actions">
          <button type="button" className="ds-btn ds-btn--primary btn-vac btn-vac--primary" onClick={onOpen} aria-label={t("homeJobs.viewDetailsFor", { title })}>
            {t("homeJobs.viewDetails")}
          </button>
        </div>
      </div>
    </article>
  );
}

HomeJobCard.propTypes = {
  job: PropTypes.object.isRequired,
  onOpen: PropTypes.func.isRequired,
  onSaveLogin: PropTypes.func.isRequired,
  loggedIn: PropTypes.bool,
};
