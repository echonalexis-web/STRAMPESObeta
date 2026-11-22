import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaArrowRight, FaChevronLeft, FaChevronRight } from "react-icons/fa";
import { AuthContext } from "../context/AuthContext";
import { jobAPI } from "../services/api";
import AppModal from "./AppModal";
import HomeJobCard from "./HomeJobCard";
import StateBlock from "./StateBlock";
import usePrefersReducedMotion from "../hooks/usePrefersReducedMotion";
import { loginStateFor } from "../utils/returnTo";
import { HOME_JOBS_LIMIT, arrowState, carouselModel, visibleRange } from "../utils/homeJobs";
import "../styles/home-jobs-carousel.css";

// The Home page jobs block for a signed-out visitor: the newest jobs in a horizontal
// carousel (CSS scroll-snap, native touch swipe, no autoplay, no library) followed by a
// "See more" card that opens the full public list. Data comes from the same public
// endpoint as that list, so it follows the same visibility rule: there is no second one.
export default function HomeJobsCarousel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const reducedMotion = usePrefersReducedMotion();
  const trackRef = useRef(null);
  const [state, setState] = useState({ status: "loading", jobs: [], total: 0 });
  const [reloadKey, setReloadKey] = useState(0);
  const [arrows, setArrows] = useState({ canPrev: false, canNext: false });
  const [range, setRange] = useState({ from: 1, to: 1 });
  const [savePrompt, setSavePrompt] = useState(false);

  // Load the newest jobs and the total in one request. A failure is an error state, never a
  // half-built carousel; zero jobs (a fresh system) is its own empty state.
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    jobAPI
      .getPublicJobs({ limit: HOME_JOBS_LIMIT, sortBy: "newest" }, { signal: controller.signal })
      .then(({ data }) => {
        if (!current) return;
        const total = Number(data?.pagination?.total ?? data?.total ?? 0) || 0;
        const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
        setState({ status: jobs.length === 0 && total === 0 ? "empty" : "ready", jobs, total });
      })
      .catch((error) => {
        if (!current || error?.code === "ERR_CANCELED") return;
        setState({ status: "error", jobs: [], total: 0 });
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [reloadKey]);

  const model = carouselModel(state.jobs, state.total);

  // Distance between the left edges of two neighbouring slides (card width plus gap).
  const slideStep = useCallback(() => {
    const track = trackRef.current;
    if (!track) return 0;
    const slides = track.querySelectorAll("[data-slide]");
    if (slides.length > 1) return slides[1].getBoundingClientRect().left - slides[0].getBoundingClientRect().left;
    return slides[0] ? slides[0].getBoundingClientRect().width : 0;
  }, []);

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const metrics = { scrollLeft: track.scrollLeft, clientWidth: track.clientWidth, scrollWidth: track.scrollWidth };
    setArrows(arrowState(metrics));
    setRange(visibleRange({ ...metrics, step: slideStep(), slideCount: model.slideCount }));
  }, [model.slideCount, slideStep]);

  // Keep the arrows and the position label in step with scrolling, swiping and resizing.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || state.status !== "ready") return undefined;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    measure();
    track.addEventListener("scroll", onScroll, { passive: true });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(onScroll) : null;
    if (observer) observer.observe(track);
    return () => {
      track.removeEventListener("scroll", onScroll);
      if (observer) observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [state.status, measure]);

  const scrollByOne = (direction) => {
    const track = trackRef.current;
    if (!track) return;
    const step = slideStep() || track.clientWidth;
    track.scrollBy({ left: direction * step, behavior: reducedMotion ? "auto" : "smooth" });
  };

  const onTrackKeyDown = (event) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      scrollByOne(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      scrollByOne(-1);
    }
  };

  // Saving a job needs an account: ask, then come back to this block after login.
  const goLogin = () => {
    setSavePrompt(false);
    navigate("/login", { state: loginStateFor({ pathname: "/", search: "#available-jobs" }) });
  };

  const ready = state.status === "ready";

  return (
    <div className="hc">
      <div className="hc-head">
        <div className="hc-head__text">
          <h2 className="hc-title">{t("homeJobs.title")}</h2>
          <p className="hc-sub">{t("homeJobs.subtitle")}</p>
        </div>
        {ready ? (
          <div className="hc-head__side">
            <span className="hc-badge">
              {model.hasMore ? t("homeJobs.badgeNewest", { count: model.total }) : t("homeJobs.badgeAll", { count: model.total })}
            </span>
            {model.hasMore ? (
              <div className="hc-controls">
                <span className="hc-position" role="status" aria-live="polite">
                  {t("homeJobs.position", { from: range.from, to: range.to, total: model.slideCount })}
                </span>
                <button type="button" className="hc-arrow" onClick={() => scrollByOne(-1)} disabled={!arrows.canPrev} aria-label={t("homeJobs.previous")}>
                  <FaChevronLeft aria-hidden="true" />
                </button>
                <button type="button" className="hc-arrow" onClick={() => scrollByOne(1)} disabled={!arrows.canNext} aria-label={t("homeJobs.next")}>
                  <FaChevronRight aria-hidden="true" />
                </button>
              </div>
            ) : (
              <Link className="hc-browse" to="/jobs">{t("homeJobs.browseAll")}</Link>
            )}
          </div>
        ) : null}
      </div>

      {state.status === "loading" ? (
        <div className="hc-track hc-track--loading" role="status" aria-live="polite">
          <span className="ds-sr-only">{t("homeJobs.loading")}</span>
          {[0, 1, 2].map((i) => (
            <div key={i} className="hc-slide" aria-hidden="true">
              <div className="vac-card hc-card hc-skeleton">
                <span className="ds-skeleton hc-sk hc-sk--sm" />
                <span className="ds-skeleton hc-sk hc-sk--lg" />
                <span className="ds-skeleton hc-sk" />
                <span className="ds-skeleton hc-sk hc-sk--btn" />
              </div>
            </div>
          ))}
        </div>
      ) : state.status === "error" ? (
        <StateBlock
          kind="error"
          title={t("homeJobs.errorTitle")}
          description={t("homeJobs.errorBody")}
          onRetry={() => {
            setState({ status: "loading", jobs: [], total: 0 });
            setReloadKey((key) => key + 1);
          }}
        />
      ) : state.status === "empty" ? (
        <StateBlock kind="empty" title={t("homeJobs.emptyTitle")} description={t("homeJobs.emptyBody")} />
      ) : (
        <div className="hc-carousel" role="region" aria-roledescription="carousel" aria-label={t("homeJobs.carouselLabel")}>
          <div
            className="hc-track"
            ref={trackRef}
            role="group"
            tabIndex={0}
            aria-label={t("homeJobs.trackLabel")}
            onKeyDown={onTrackKeyDown}
          >
            {model.jobs.map((job, index) => (
              <div
                key={job._id || index}
                className="hc-slide"
                data-slide
                role="group"
                aria-roledescription="slide"
                aria-label={t("homeJobs.slideLabel", { current: index + 1, total: model.slideCount })}
              >
                <HomeJobCard
                  job={job}
                  onOpen={() => navigate(`/jobs/${job._id}`)}
                  onSaveLogin={() => setSavePrompt(true)}
                  loggedIn={Boolean(user)}
                />
              </div>
            ))}
            {model.hasMore ? (
              <div
                className="hc-slide"
                data-slide
                role="group"
                aria-roledescription="slide"
                aria-label={t("homeJobs.slideLabel", { current: model.slideCount, total: model.slideCount })}
              >
                <Link className="vac-card hc-card hc-more" to="/jobs">
                  <span className="hc-more__icon" aria-hidden="true"><FaArrowRight /></span>
                  <span className="hc-more__count">{t("homeJobs.moreCount", { count: model.moreCount })}</span>
                  <span className="hc-more__cta">{t("homeJobs.seeAll")}</span>
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <AppModal
        isOpen={savePrompt}
        onClose={() => setSavePrompt(false)}
        title={t("homeJobs.savePromptTitle")}
        titleId="hc-save-title"
        closeLabel={t("homeJobs.close")}
      >
        <p className="hc-prompt-text">{t("homeJobs.savePromptBody")}</p>
        <div className="hc-prompt-actions">
          <button type="button" className="ds-btn ds-btn--secondary" onClick={() => setSavePrompt(false)}>{t("homeJobs.notNow")}</button>
          <button type="button" className="ds-btn ds-btn--primary" onClick={goLogin}>{t("homeJobs.login")}</button>
        </div>
      </AppModal>
    </div>
  );
}
