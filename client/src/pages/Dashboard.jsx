import { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { jobAPI, newsAPI, resolveAssetUrl } from "../services/api";
import VacancyCard from "../components/VacancyCard";
import ApplyModal from "../components/ApplyModal";
import PageHero from "../components/PageHero";
import MetricCard from "../components/MetricCard";
import StateBlock from "../components/StateBlock";
import Reveal from "../components/Reveal";
import "../styles/dashboard.css";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Briefcase, CircleCheck, Clock, FileText, Lightbulb, Newspaper, Search, Star } from "lucide-react";
import { jobMatchesAnyIndustry } from "../utils/industries";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";
const REC_PER_PAGE = 4;

// Same percent VacancyCard shows for a job: the checklist percent when the
// job has one, otherwise the relevance estimate. 0 when the seeker has no
// skills on file (the cards hide the percent then, so the rail does too).
const jobMatchPercent = (job, hasSkills) => {
  if (!hasSkills) return 0;
  if (job?.checklistMatch) return Number(job.checklistMatch.percent) || 0;
  return Math.round((job?.relevanceScore || 0) * 100);
};

const NEWS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Newest published item inside the last 7 days, or null. Future-dated
// (scheduled) posts and unparsable dates are skipped.
const latestRecentNews = (items) => {
  const now = Date.now();
  let best = null;
  (Array.isArray(items) ? items : []).forEach((item) => {
    const ts = new Date(item?.publishedAt || item?.createdAt).getTime();
    if (Number.isNaN(ts) || ts > now || now - ts > NEWS_WINDOW_MS) return;
    if (!best || ts > best.ts) best = { item, ts };
  });
  return best;
};

const newsExcerpt = (text, max = 140) => {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
};

const greetingForNow = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
};

export default function Dashboard() {
  const { user, login } = useContext(AuthContext);
  const navigate = useNavigate();
  const { t } = useTranslation();
  // Computed once per visit (lazy initializer) so render stays pure.
  const [greetingKey] = useState(greetingForNow);
  const preferredIndustries = useMemo(() => user?.preferredIndustries || [], [user]);

  const [jobs, setJobs] = useState([]);
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasSkills, setHasSkills] = useState(true);
  const [recPage, setRecPage] = useState(1);
  const [applyModalJobId, setApplyModalJobId] = useState(null);
  const [latestNews, setLatestNews] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  // News is a side widget: it loads independently and a failure just shows
  // the empty state instead of breaking the dashboard.
  useEffect(() => {
    let cancelled = false;
    newsAPI
      .list({ page: 1, limit: 10 })
      .then(({ data }) => {
        if (!cancelled) setLatestNews(latestRecentNews(data?.items));
      })
      .catch(() => {
        if (!cancelled) setLatestNews(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError("");

    try {
      if (!user) {
        setError('Please login to view your dashboard');
        setLoading(false);
        return;
      }

      const [jobRes, applicationRes] = await Promise.all([
        jobAPI.searchJobsWithSemantic({}),
        jobAPI.getMyApplications(),
      ]);

      setJobs(Array.isArray(jobRes.data?.jobs) ? jobRes.data.jobs : []);
      setHasSkills(jobRes.data?.hasSkills !== undefined ? jobRes.data.hasSkills : true);
      setApplications(Array.isArray(applicationRes.data) ? applicationRes.data : []);

      if (jobRes.data?.preferredIndustries && Array.isArray(jobRes.data.preferredIndustries)) {
        const token = localStorage.getItem("token");
        const updatedUser = { ...user, preferredIndustries: jobRes.data.preferredIndustries };
        if (token) {
          login(token, updatedUser);
        }
      }

    } catch (err) {
      if (err.response?.status === 401) {
        setError('Your session has expired. Please login again.');
        setTimeout(() => navigate('/login'), 2000);
      } else if (err.response?.status === 403) {
        setError('You do not have permission to view this content.');
      } else if (err.response?.status === 404) {
        setError('API endpoint not found. Please check your server configuration.');
      } else if (err.code === 'ERR_NETWORK' || err.message === 'Network Error') {
        setError(`Cannot connect to server. Please make sure the server is running. (${API_BASE_URL})`);
      } else {
        setError(err.response?.data?.message || err.message || 'Failed to load dashboard content');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = () => {
    fetchData();
  };

  const initials = user?.name?.split(" ").map((part) => part[0]).join("").toUpperCase().slice(0, 2) || "U";
  const profileImageUrl = user?.profileImage ? resolveAssetUrl(user.profileImage) : "";

  const isJobAlreadyApplied = (jobId) =>
    applications.some((app) => String(app.vacancy?._id) === String(jobId));

  const cardProps = (job) => ({
    job,
    applied: isJobAlreadyApplied(job._id),
    followed: Boolean(job.isFollowedEmployer),
    preferred: jobMatchesAnyIndustry(job, preferredIndustries),
    matchAvailable: hasSkills,
    onOpen: () => navigate(`/jobs/${job._id}`),
    onApply: () => setApplyModalJobId(job._id),
  });

  // Jobs from a followed employer are fast-tracked into recommendations
  // regardless of industry match, and sorted ahead of the plain matches.
  const recommendedAll = useMemo(
    () =>
      jobs
        .filter((job) => job.isFollowedEmployer || jobMatchesAnyIndustry(job, preferredIndustries))
        .sort((a, b) => Number(Boolean(b.isFollowedEmployer)) - Number(Boolean(a.isFollowedEmployer))),
    [jobs, preferredIndustries]
  );

  const recTotalPages = Math.max(1, Math.ceil(recommendedAll.length / REC_PER_PAGE));
  const recSafePage = Math.min(recPage, recTotalPages);
  const recSlice = recommendedAll.slice((recSafePage - 1) * REC_PER_PAGE, recSafePage * REC_PER_PAGE);

  const recentJobs = useMemo(() => {
    const topRecommended = recommendedAll.slice(0, 4);
    const filler = jobs
      .filter((job) => !job.isFollowedEmployer && !jobMatchesAnyIndustry(job, preferredIndustries))
      .slice(0, 4 - topRecommended.length);
    return [...topRecommended, ...filler];
  }, [jobs, recommendedAll, preferredIndustries]);

  // §A.4 — the most frequent missing requirement across jobs this seeker
  // "nearly" matches (at least one must-have already met, at most two
  // missing — not "unrelated job", genuinely close). Needs it to recur in
  // at least 2 jobs before calling it out, so a single posting's one-off
  // requirement doesn't read as a trend from a sample of one. For a PESO
  // this is also a training-demand signal, not just an applicant nudge.
  const skillGapInsight = useMemo(() => {
    const tally = new Map();
    jobs.forEach((job) => {
      const m = job.checklistMatch;
      if (!m || !m.totalMustHaves || m.metMustHaves === 0) return;
      const missingCount = m.totalMustHaves - m.metMustHaves;
      if (missingCount < 1 || missingCount > 2) return;
      (m.missingRequired || []).forEach((q) => {
        tally.set(q.value, (tally.get(q.value) || 0) + 1);
      });
    });
    let best = null;
    tally.forEach((count, value) => {
      if (count >= 2 && (!best || count > best.count)) best = { value, count };
    });
    return best;
  }, [jobs]);

  // Presentation only: the three loaded jobs with the highest match percent
  // (hero "Best match today" card + the "Top matches" rail).
  const topMatches = useMemo(
    () =>
      jobs
        .map((job) => ({ job, percent: jobMatchPercent(job, hasSkills) }))
        .filter((entry) => entry.percent > 0)
        .sort((a, b) => b.percent - a.percent)
        .slice(0, 3),
    [jobs, hasSkills]
  );

  if (!user) {
    return (
      <div className="jsd">
        <div className="jsd-inner">
          <StateBlock
            kind="error"
            title={t("dashboard.loginRequiredTitle")}
            description={t("dashboard.loginRequired")}
            action={
              <button type="button" onClick={() => navigate('/login')} className="ds-btn ds-btn--primary">
                {t("dashboard.goToLogin")}
              </button>
            }
          />
        </div>
      </div>
    );
  }

  const totalApplications = applications.length;
  const pendingApplications = applications.filter(a =>
    a.status === 'pending' || a.status === 'applied' || a.status === 'reviewed'
  ).length;
  const acceptedApplications = applications.filter(a =>
    a.status === 'accepted' || a.status === 'hired'
  ).length;

  const stats = [
    { key: 'jobs', icon: <Briefcase size={20} />, value: jobs.length, label: t("dashboard.metrics.availableJobs") },
    { key: 'total', icon: <FileText size={20} />, value: totalApplications, label: t("dashboard.metrics.totalApplications") },
    { key: 'pending', icon: <Clock size={20} />, value: pendingApplications, label: t("dashboard.metrics.pending") },
    { key: 'accepted', icon: <CircleCheck size={20} />, value: acceptedApplications, label: t("dashboard.metrics.accepted") },
  ];

  const firstName = user.name?.split(' ')[0] || t("dashboard.nameFallback");
  const bestMatch = topMatches[0] || null;
  const employerLabel = (job) => job?.employer?.companyName || job?.employer?.name || t("dashboard.employerFallback");

  return (
    <div className="jsd">
      <div className="jsd-inner">
        <PageHero
          large
          className="jsd-hero2"
          title={t(`dashboard.greeting.${greetingKey}`)}
          accent={`${firstName}.`}
          body={loading ? t("dashboard.heroBodyLoading") : t("dashboard.heroBody", { count: jobs.length })}
          actions={
            <button type="button" className="ds-btn ds-btn--gold jsd-hero2__cta" onClick={() => navigate("/jobs")}>
              <Search size={18} aria-hidden="true" />
              {t("dashboard.browseJobs")}
              <ArrowRight size={18} className="jsd-hero2__arrow" aria-hidden="true" />
            </button>
          }
          aside={
            !loading && bestMatch ? (
              <div className="jsd-best">
                <h2 className="jsd-best__heading">{t("dashboard.bestMatch")}</h2>
                <p className="jsd-best__title">{bestMatch.job.title}</p>
                <p className="jsd-best__sub">{employerLabel(bestMatch.job)}</p>
                <div className="jsd-best__meter">
                  <div className="ds-progress" aria-hidden="true">
                    <span className="ds-progress__bar" style={{ "--ds-progress": `${Math.min(100, bestMatch.percent)}%` }} />
                  </div>
                  <span className="jsd-best__percent">{t("dashboard.matchPercent", { percent: bestMatch.percent })}</span>
                </div>
                <button
                  type="button"
                  className="ds-btn ds-btn--secondary jsd-best__open"
                  onClick={() => navigate(`/jobs/${bestMatch.job._id}`)}
                >
                  {t("dashboard.viewJob")}
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </div>
            ) : null
          }
        />

        <Reveal className="ds-metrics ds-metrics--4 jsd-metrics">
          {stats.map((st) => (
            <MetricCard key={st.key} icon={st.icon} value={st.value} label={st.label} />
          ))}
        </Reveal>

        {error && (
          <StateBlock
            kind="error"
            title={t("dashboard.errorTitle")}
            description={error}
            onRetry={handleRetry}
          />
        )}

        {loading ? (
          <div className="jsd-loading" role="status" aria-busy="true">
            <span className="ds-sr-only">{t("dashboard.loading")}</span>
            <div className="ds-card jsd-profile" aria-hidden="true">
              <span className="ds-skeleton jsd-sk-avatar" />
              <div className="jsd-sk-lines">
                <span className="ds-skeleton jsd-sk-line jsd-sk-line--lg" />
                <span className="ds-skeleton jsd-sk-line" />
              </div>
            </div>
            <div className="jsd-grid" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div className="ds-card jsd-sk-card" key={i}>
                  <span className="ds-skeleton jsd-sk-line jsd-sk-line--lg" />
                  <span className="ds-skeleton jsd-sk-line" />
                  <span className="ds-skeleton jsd-sk-line jsd-sk-line--sm" />
                  <span className="ds-skeleton jsd-sk-btn" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="jsd-layout">
            {/* Side rail first in source so the profile card keeps its
                place at the top of the phone layout; from 1101px it moves
                to the right-hand column (dashboard.css). */}
            <aside className="jsd-side" aria-label={t("dashboard.sideLabel")}>
              <div className="ds-card jsd-profile">
                <div className="jsd-profile__who">
                  <div className="jsd-profile__avatar">
                    {profileImageUrl ? <img src={profileImageUrl} alt={user.name || t("dashboard.avatarAlt")} /> : initials}
                  </div>
                  <div className="jsd-profile__details">
                    <h2>{user.name}</h2>
                    <p className="jsd-profile__email">{user.email}</p>
                    <span className="ds-badge">{t("dashboard.jobSeeker")}</span>
                  </div>
                </div>
                <button type="button" className="ds-btn ds-btn--secondary jsd-profile__edit" onClick={() => navigate("/profile")}>{t("dashboard.editProfile")}</button>
              </div>

              {topMatches.length > 0 && (
                <section className="jsd-top" aria-labelledby="jsd-top-title">
                  <h2 id="jsd-top-title" className="jsd-top__title">{t("dashboard.topMatchesTitle")}</h2>
                  <ol className="ds-list jsd-top__list">
                    {topMatches.map(({ job, percent }, index) => (
                      <li key={job._id}>
                        <button
                          type="button"
                          className="ds-list-row jsd-top__row"
                          onClick={() => navigate(`/jobs/${job._id}`)}
                        >
                          <span className="ds-list-row__lead" aria-hidden="true">{index + 1}</span>
                          <span className="ds-list-row__main">
                            <span className="ds-list-row__title">{job.title}</span>
                            <span className="ds-list-row__sub">{employerLabel(job)}</span>
                          </span>
                          <span className="ds-list-row__end">{t("dashboard.matchPercent", { percent })}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              <section className="ds-card jsd-news" aria-labelledby="jsd-news-title">
                <div className="jsd-news__head">
                  <h2 id="jsd-news-title" className="jsd-news__title">
                    <Newspaper size={18} aria-hidden="true" /> {t("dashboard.newsTitle")}
                  </h2>
                  <button type="button" className="jsd-news__all" onClick={() => navigate("/news")}>
                    {t("dashboard.newsAll")}
                  </button>
                </div>
                {latestNews ? (
                  <button
                    type="button"
                    className="jsd-news__item"
                    onClick={() => navigate(`/news/${latestNews.item._id}`)}
                  >
                    {latestNews.item.imageUrl && (
                      <span className="jsd-news__thumb">
                        <img src={resolveAssetUrl(latestNews.item.imageUrl)} alt="" loading="lazy" />
                      </span>
                    )}
                    <span className="jsd-news__body">
                      <time className="jsd-news__date" dateTime={new Date(latestNews.ts).toISOString()}>
                        {new Date(latestNews.ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      </time>
                      <span className="jsd-news__headline">{latestNews.item.title || t("dashboard.newsUntitled")}</span>
                      <span className="jsd-news__excerpt">{newsExcerpt(latestNews.item.content)}</span>
                    </span>
                  </button>
                ) : (
                  <div className="jsd-news__empty">
                    <span className="jsd-news__empty-icon" aria-hidden="true">
                      <Newspaper size={24} />
                    </span>
                    <p>{t("dashboard.newsEmpty")}</p>
                  </div>
                )}
              </section>
            </aside>

            <div className="jsd-main">
              {skillGapInsight && (
                <div className="jsd-note">
                  <Lightbulb size={18} className="jsd-note__icon" aria-hidden="true" />
                  <span>
                    <strong>{skillGapInsight.value}</strong>{" "}
                    {t("dashboard.skillGap", { count: skillGapInsight.count })}
                  </span>
                </div>
              )}

              {/* Recent Job Openings — a short teaser; the full list lives on the Job Board */}
              <div className="jsd-section-head">
                <h2>{t("dashboard.recentTitle")}</h2>
                <button type="button" className="jsd-view-all" onClick={() => navigate("/jobs")}>
                  {t("dashboard.viewAll")} <ArrowRight size={16} aria-hidden="true" />
                </button>
              </div>

              {!hasSkills && user && (
                <div className="jsd-note jsd-note--action">
                  <p>{t("dashboard.noSkills")}</p>
                  <button type="button" className="ds-btn ds-btn--secondary" onClick={() => navigate("/profile")}>{t("dashboard.editProfile")}</button>
                </div>
              )}

              {recentJobs.length === 0 ? (
                <StateBlock kind="empty" title={t("dashboard.noJobsTitle")} description={t("dashboard.noJobsBody")} />
              ) : (
                <div className="jsd-grid">
                  {recentJobs.map((job, index) => (
                    <Reveal key={job._id} index={index + 1} className="jsd-cell">
                      <VacancyCard {...cardProps(job)} />
                    </Reveal>
                  ))}
                </div>
              )}

              {/* Recommended for You — paginated */}
              <div className="jsd-section-head">
                <h2><Star size={20} className="jsd-star" aria-hidden="true" /> {t("dashboard.recommendedTitle")}</h2>
              </div>

              {preferredIndustries.length === 0 ? (
                <StateBlock
                  kind="empty"
                  title={t("dashboard.setupIndustriesTitle")}
                  description={t("dashboard.setupIndustriesBody")}
                  action={
                    <button type="button" className="ds-btn ds-btn--primary" onClick={() => navigate("/profile")}>
                      {t("dashboard.goToProfile")}
                    </button>
                  }
                />
              ) : recommendedAll.length === 0 ? (
                <StateBlock kind="empty" title={t("dashboard.noRecommendedTitle")} description={t("dashboard.noRecommendedBody")} />
              ) : (
                <>
                  <div className="jsd-grid">
                    {recSlice.map((job) => <VacancyCard key={job._id} {...cardProps(job)} />)}
                  </div>
                  <nav className="jsd-pager" aria-label={t("dashboard.pagerLabel")}>
                    <button
                      type="button"
                      className="ds-btn ds-btn--secondary"
                      onClick={() => setRecPage((p) => Math.max(1, p - 1))}
                      disabled={recSafePage <= 1}
                    >
                      <ArrowLeft size={16} aria-hidden="true" /> {t("dashboard.previous")}
                    </button>
                    <div className="jsd-pager__info" aria-live="polite">{t("dashboard.pageOf", { page: recSafePage, total: recTotalPages })}</div>
                    <button
                      type="button"
                      className="ds-btn ds-btn--secondary"
                      onClick={() => setRecPage((p) => Math.min(recTotalPages, p + 1))}
                      disabled={recSafePage >= recTotalPages}
                    >
                      {t("dashboard.next")} <ArrowRight size={16} aria-hidden="true" />
                    </button>
                  </nav>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <ApplyModal
        isOpen={Boolean(applyModalJobId)}
        onClose={() => setApplyModalJobId(null)}
        jobId={applyModalJobId}
        job={jobs.find((j) => j._id === applyModalJobId) || null}
        onSuccess={() => {
          setApplyModalJobId(null);
          fetchData();
        }}
      />
    </div>
  );
}
