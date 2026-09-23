import { useContext, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FaArrowRight, FaSearch } from "react-icons/fa";
import { AuthContext } from "../context/AuthContext";
import { jobAPI } from "../services/api";
import EmployerAvatar from "../components/EmployerAvatar";
import "../styles/home.css";
import heroVideo from "../assets/videos/hero-video.mp4";
import pesoLogo from "../assets/images/peso-logo.png";
import provincialSeal from "../assets/images/provincial-seal.png";
import carouselImage1 from "../assets/images/Picture 1.jpg";
import carouselImage2 from "../assets/images/Picture 2.png";
import carouselImage3 from "../assets/images/Picture 3.png";
import carouselImage4 from "../assets/images/Picture 4.png";
import provincialBuilding from "../assets/images/provincial-building.jpg";

const HOME_FEATURED_JOBS = [
  {
    _id: "community-liaison-assistant",
    title: "Community Liaison Assistant",
    employer: "Marinduque Community Development Group",
    location: "Boac, Marinduque",
    jobType: "Full-time",
    type: "Full-time",
    description: "Support field coordination, community outreach, and documentation for local livelihood programs.",
  },
  {
    _id: "admin-support-staff",
    title: "Administrative Support Staff",
    employer: "Island Cooperative Services",
    location: "Gasan, Marinduque",
    jobType: "Contract",
    type: "Contract",
    description: "Handle office coordination, records management, and front-line support for daily operations.",
  },
  {
    _id: "field-encoder",
    title: "Field Encoder",
    employer: "Provincial Field Assistance Office",
    location: "Santa Cruz, Marinduque",
    jobType: "Project-Based",
    type: "Project-Based",
    description: "Encode beneficiary records, update reports, and assist in local employment program monitoring.",
  },
  {
    _id: "service-associate",
    title: "Customer Service Associate",
    employer: "Marinduque Trade Center",
    location: "Torrijos, Marinduque",
    jobType: "Full-time",
    type: "Full-time",
    description: "Support customer inquiries, assist transactions, and maintain service quality in a retail setting.",
  },
];

export default function Home() {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  const location = useLocation();
  const jobsRef = useRef(null);
  const heroRef = useRef(null);

  const [showRegisterPrompt, setShowRegisterPrompt] = useState(false);
  const [selectedProgram, setSelectedProgram] = useState(null);
  const [featuredJobs, setFeaturedJobs] = useState(HOME_FEATURED_JOBS);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeJobFilter, setActiveJobFilter] = useState("all");
  const [showScrollButton, setShowScrollButton] = useState(true);
  const [experienceIndex, setExperienceIndex] = useState(0);

  useEffect(() => {
    const carouselTimer = window.setInterval(() => {
      setExperienceIndex((current) => (current + 4) % 5);
    }, 5000);

    return () => window.clearInterval(carouselTimer);
  }, []);

  useEffect(() => {
    const hash = location.hash.replace("#", "");
    const target = hash === "available-jobs" ? jobsRef.current : null;
    if (target) {
      window.requestAnimationFrame(() => target.scrollIntoView({ behavior: "smooth", block: "start" }));
      return;
    }
    if (location.pathname === "/" && !location.hash) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [location.hash, location.pathname]);

  useEffect(() => {
    let active = true;
    const loadJobs = async () => {
      setJobsLoading(true);
      try {
        const { data } = await jobAPI.getHomepageJobs();
        if (!active) return;
        if (Array.isArray(data) && data.length > 0) setFeaturedJobs(data);
        else setFeaturedJobs(HOME_FEATURED_JOBS);
      } catch (error) {
        console.error("Error loading jobs:", error);
        if (active) setFeaturedJobs(HOME_FEATURED_JOBS);
      } finally {
        if (active) setJobsLoading(false);
      }
    };
    loadJobs();
    return () => { active = false; };
  }, [user]);

  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        if (heroRef.current) setShowScrollButton(heroRef.current.getBoundingClientRect().bottom > 100);
        ticking = false;
      });
    };
    handleScroll();
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToAvailableJobs = () => {
    const availableJobsSection = document.getElementById("available-jobs");
    if (availableJobsSection) {
      setShowScrollButton(false);
      availableJobsSection.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
    }
  };

  const getFilteredJobs = () => {
    try {
      const query = searchQuery.toLowerCase().trim();
      return featuredJobs.filter(job => {
        if (!job) return false;
        const title = (job.title || "").toLowerCase().trim();
        const employer = (typeof job.employer === 'string' ? job.employer : job.employer?.companyName || job.employer?.name || "").toLowerCase().trim();
        const location = (job.location || "").toLowerCase().trim();
        let jobType = "";
        if (job.jobType && typeof job.jobType === 'string') jobType = job.jobType.toLowerCase().trim();
        else if (job.type && typeof job.type === 'string') jobType = job.type.toLowerCase().trim();
        else if (job.employmentType && typeof job.employmentType === 'string') jobType = job.employmentType.toLowerCase().trim();
        
        const normalizedType = jobType.replace(/\s+/g, "-");
        const jobMode = String(job.workMode || job.mode || job.locationType || "").toLowerCase().trim();
        const filterMatches = activeJobFilter === "all"
          || jobType === activeJobFilter.toLowerCase()
          || normalizedType === activeJobFilter.toLowerCase()
          || jobMode === activeJobFilter.toLowerCase();
        if (!filterMatches) return false;

        if (!query) return true;
        return (
          title.includes(query) ||
          (employer.includes(query) && employer !== "employer") ||
          location.includes(query) ||
          jobType.includes(query)
        );
      });
    } catch (error) {
      console.error("Error filtering jobs:", error);
      return featuredJobs;
    }
  };

  const filteredJobs = getFilteredJobs();
  const hasNoResults = searchQuery.trim() !== "" && filteredJobs.length === 0 && !jobsLoading;

  const openRegisterPrompt = () => setShowRegisterPrompt(true);
  const closeRegisterPrompt = () => setShowRegisterPrompt(false);
  const goToRegister = (route) => { closeRegisterPrompt(); navigate(route); };
  const closeProgramModal = () => setSelectedProgram(null);
  const handleViewJob = (job) => {
    const jobId = job?._id || job?.id;
    // Only a real posting (Mongo ObjectId) has a detail page to go to — the
    // static fallback list shown when the API call fails/returns nothing
    // uses slug-like placeholder ids that don't exist in the database.
    if (!jobId || !/^[a-f0-9]{24}$/i.test(String(jobId))) return;
    navigate(`/jobs/${jobId}`);
  };
  const clearSearch = () => { setSearchQuery(""); };
  const selectJobFilter = (filter) => { setActiveJobFilter(filter); };

  const getJobSlots = (job) => {
    const slots = job?.numberOfPositions || job?.positionsAvailable || job?.vacancies || job?.slots;
    return slots ? `${slots} ${Number(slots) === 1 ? "slot" : "slots"}` : "";
  };

  const getEmployerName = (job) => {
    try {
      if (typeof job?.employer === "string") return job.employer;
      if (job?.employer?.companyName) return job.employer.companyName;
      if (job?.employer?.name) return job.employer.name;
      return "";
    } catch { return ""; }
  };

  const handleSearchChange = (e) => { setSearchQuery(e.target.value); };

  const getExperienceOffset = (slideIndex) => {
    let offset = slideIndex - experienceIndex;
    if (offset > 2) offset -= 5;
    if (offset < -2) offset += 5;
    return offset;
  };

  return (
    <div className="home-container">
      <section className="video-hero-section" ref={heroRef}>
        <video className="hero-video" autoPlay loop muted playsInline>
          <source src={heroVideo} type="video/mp4" />
          Your browser does not support HTML5 video.
        </video>
        <div className="video-overlay"></div>
        <div className="video-hero-content">
          <div className="hero-logo-container"><img src={pesoLogo} alt="PESO Marinduque Logo" className="hero-logo" /></div>
          <h1 className="hero-main-title">TRABAHO MANDIN!</h1>
          <p className="hero-tagline">Trabaho para sa Marinduqueño</p>
          <div className="hero-description"><p>Marinduque, proudly known as the Heart of the Philippines, is a province rich in culture, resilience, and community spirit. Through Online Employment in Marinduque, we connect local talent with opportunities, empowering every Marinduqueño to build a stronger future at home and beyond</p></div>
          {!user && (
            <div className="hero-mobile-quick-actions">
              <button type="button" className="hero-mobile-btn hero-mobile-login-btn" onClick={() => navigate("/login")}>Login</button>
              <button type="button" className="hero-mobile-btn hero-mobile-register-btn" onClick={openRegisterPrompt}>Register</button>
            </div>
          )}
        </div>
      </section>

      {showScrollButton && (
        <button className="scroll-down-button" onClick={scrollToAvailableJobs}>
          <span className="scroll-down-text">Scroll Down for More</span>
          <span className="scroll-down-arrow">↓</span>
        </button>
      )}

      <section className="available-jobs-section" id="available-jobs" ref={jobsRef}>
        <div className="jobs-design-wrap">
          <div className="jobs-design-hero">

            <div className="jobs-design-search-shell">
              <div className="jobs-design-search-bar">
                <FaSearch className="jobs-design-search-icon" aria-hidden="true" />
                <input type="text" placeholder="Search by job title, employer, or type…" value={searchQuery} onChange={handleSearchChange} />
                <button type="button">Search</button>
              </div>
              <div className="jobs-design-chips" aria-label="Filter jobs by type">
                {[
                  ["all", "All"],
                  ["Full-time", "Full-time"],
                  ["Contract", "Contract"],
                  ["Project-based", "Project-based"],
                  ["Online", "Online"],
                  ["Onsite", "Onsite"],
                ].map(([value, label]) => (
                  <button key={value} type="button" className={`jobs-design-chip ${activeJobFilter === value ? "is-active" : ""}`} onClick={() => selectJobFilter(value)}>{label}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="jobs-design-section-head">
            <div>
              <h3>Current employer openings</h3>
              <p>Select a card to view the full posting.</p>
            </div>
            <span className="jobs-design-count">{filteredJobs.length} {filteredJobs.length === 1 ? "opening" : "openings"}</span>
          </div>

          {jobsLoading ? (
            <div className="section-loading"><p>Loading available jobs...</p></div>
          ) : hasNoResults ? (
            <div className="no-results-container">
              <div className="no-results-icon">🔍</div>
              <h3>No jobs found for "{searchQuery}"</h3>
              <p>We couldn't find any matching jobs. Try adjusting your search terms.</p>
              <div className="suggestions"><p>💡 Suggestions:</p><ul><li>Check for typos or spelling errors</li><li>Use more general keywords</li><li>Try searching by job type</li><li>Browse all available jobs below</li></ul></div>
              <button className="jobs-see-more-btn" onClick={clearSearch}>View All Jobs</button>
            </div>
          ) : (
            <>
              <div className="jobs-design-grid">
                {filteredJobs.length > 0 ? (
                  filteredJobs.map((job, index) => {
                    const title = job?.title || "Untitled Position";
                    const jobId = job?._id || job?.id || title;
                    // Mirrors the guard inside handleViewJob — used here just to
                    // grey the button out for the fallback list's placeholder ids.
                    const hasDetailPage = /^[a-f0-9]{24}$/i.test(String(jobId));
                    const employerName = getEmployerName(job) || "Employer";
                    return (
<article
  key={jobId}
  className={`jobs-design-card${hasDetailPage ? " jobs-design-card--clickable" : ""}`}
  role={hasDetailPage ? "button" : undefined}
  tabIndex={hasDetailPage ? 0 : -1}
  onClick={() => { if (hasDetailPage) handleViewJob(job); }}
  onKeyDown={(e) => {
    if (!hasDetailPage) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleViewJob(job);
    }
  }}
>
  <div className="jobs-design-card-top">
    <EmployerAvatar
      employer={job?.employer}
      name={employerName}
      className={`jobs-design-logo jobs-design-logo-${index % 5}`}
    />
    <span className="jobs-design-open">
      <span></span>Open
    </span>
  </div>

  <div className="jobs-design-card-body">
    <p className="jobs-design-employer" title={employerName}>
      {employerName}
    </p>
    <p className="jobs-design-role" title={title}>
      {title}
    </p>
    {getJobSlots(job) && (
      <span className="jobs-design-slot">{getJobSlots(job)}</span>
    )}
  </div>

  <div className="jobs-design-card-footer">
    <button
      type="button"
      className="jobs-design-details"
      disabled={!hasDetailPage}
      onClick={(e) => { e.stopPropagation(); handleViewJob(job); }}
    >
      Details <FaArrowRight />
    </button>
  </div>
</article>
                    );
                  })
                ) : (
                  <div className="no-results-container"><div className="no-results-icon">🔍</div><h3>No jobs available</h3><p>There are currently no job postings. Please check back later.</p></div>
                )}
              </div>

              <div className="more-wrap">
                <button className="more-btn" onClick={() => navigate("/jobs")}>See More Jobs</button>
              </div>
            </>
          )}
        </div>
      </section>

      {showRegisterPrompt && (
        <div className="register-choice-overlay" onClick={closeRegisterPrompt}>
          <div className="register-choice-modal" onClick={(event) => event.stopPropagation()}>
            <h3>Register as</h3><p>Select your account type to continue.</p>
            <div className="register-choice-actions">
              <button type="button" className="register-choice-btn" onClick={() => goToRegister("/register")}>Jobseeker</button>
              <button type="button" className="register-choice-btn" onClick={() => goToRegister("/register-employer")}>Employer</button>
            </div>
            <button type="button" className="register-choice-cancel" onClick={closeRegisterPrompt}>Cancel</button>
          </div>
        </div>
      )}

      {selectedProgram && (
        <div className="register-choice-overlay" onClick={closeProgramModal}>
          <div className="register-choice-modal program-detail-modal" onClick={(event) => event.stopPropagation()}>
            <h3>{selectedProgram.title}</h3><p className="program-detail-tag">{selectedProgram.tag}</p><p>{selectedProgram.description}</p>
            <button type="button" className="register-choice-cancel" onClick={closeProgramModal}>Close</button>
          </div>
        </div>
      )}

      <section className="features-section">
        <h2>Find Work or Hire Talent</h2>
        <div className="features-grid">
          <div className="feature-card"><span className="icon">👨‍💼</span><h3>Job Seekers</h3><p>Discover local job openings and apply online.</p></div>
          <div className="feature-card"><span className="icon">🏢</span><h3>Employers</h3><p>Post vacancies and manage applicants in one place.</p></div>
          <div className="feature-card"><span className="icon">📄</span><h3>Resume Upload</h3><p>Attach your resume when applying for jobs.</p></div>
          <div className="feature-card"><span className="icon">📊</span><h3>Admin Analytics</h3><p>Track users, vacancies, and application activity.</p></div>
        </div>
      </section>

      <section className="how-it-works-v2">
        <div className="how-it-works-v2-container">
          <h2 className="how-it-works-v2-title">How it Works</h2>
          <div className="how-it-works-v2-layout">
            <div className="how-it-works-v2-steps">
              <div className="how-it-works-v2-step-card">
                <div className="how-it-works-v2-step-number">1</div>
                <h3 className="how-it-works-v2-step-title">Register</h3>
                <p className="how-it-works-v2-step-description">Create an account as a job seeker or employer.</p>
              </div>
              <div className="how-it-works-v2-step-card">
                <div className="how-it-works-v2-step-number">2</div>
                <h3 className="how-it-works-v2-step-title">Login</h3>
                <p className="how-it-works-v2-step-description">Sign in with your credentials.</p>
              </div>
              <div className="how-it-works-v2-step-card">
                <div className="how-it-works-v2-step-number">3</div>
                <h3 className="how-it-works-v2-step-title">Apply</h3>
                <p className="how-it-works-v2-step-description">Upload your resume and submit applications.</p>
              </div>
              <div className="how-it-works-v2-step-card">
                <div className="how-it-works-v2-step-number">4</div>
                <h3 className="how-it-works-v2-step-title">Manage</h3>
                <p className="how-it-works-v2-step-description">Employers review applicants and admins monitor analytics.</p>
              </div>
            </div>
            <div className="how-it-works-v2-video-wrapper">
              <div className="how-it-works-v2-video-card">
                <iframe
                  className="how-it-works-v2-video"
                  src="https://www.youtube.com/embed/waJz6hNShdo?list=RDwaJz6hNShdo"
                  title="How it works video"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                ></iframe>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="infinite-experience" aria-label="Marinduque experiences">
        <div className="infinite-carousel" tabIndex="0" aria-roledescription="carousel" aria-label="Marinduque experiences">
          <div className="infinite-carousel__viewport">
            <div className="infinite-carousel__track">
              <article className="infinite-card" data-slide="0" data-offset={getExperienceOffset(0)} aria-roledescription="slide" aria-label="Marinduque view">
                <img className="infinite-card__image" src={carouselImage1} alt="Marinduque view" />
              </article>
              <article className="infinite-card" data-slide="1" data-offset={getExperienceOffset(1)} aria-roledescription="slide" aria-label="Marinduque landscape" aria-hidden={experienceIndex !== 1}>
                <img className="infinite-card__image" src={carouselImage2} alt="Madrid city streets" />
              </article>
              <article className="infinite-card" data-slide="2" data-offset={getExperienceOffset(2)} aria-roledescription="slide" aria-label="Marinduque scenery" aria-hidden={experienceIndex !== 2}>
                <img className="infinite-card__image" src={carouselImage3} alt="A Madrid building facade" />
              </article>
              <article className="infinite-card" data-slide="3" data-offset={getExperienceOffset(3)} aria-roledescription="slide" aria-label="Marinduque architecture" aria-hidden={experienceIndex !== 3}>
                <img className="infinite-card__image" src={carouselImage4} alt="Madrid architecture against the sky" />
              </article>
              <article className="infinite-card" data-slide="4" data-offset={getExperienceOffset(4)} aria-roledescription="slide" aria-label="Provincial building" aria-hidden={experienceIndex !== 4}>
                <img className="infinite-card__image" src={provincialBuilding} alt="Provincial building in Marinduque" />
              </article>
            </div>
          </div>
          <div className="infinite-carousel__controls">
            <button className="infinite-carousel__button" type="button" data-slide-direction="prev" aria-label="Previous experience" onClick={() => setExperienceIndex((current) => (current + 4) % 5)}>&#8592;</button>
            <button className="infinite-carousel__button" type="button" data-slide-direction="next" aria-label="Next experience" onClick={() => setExperienceIndex((current) => (current + 1) % 5)}>&#8594;</button>
          </div>
        </div>
        <p className="infinite-experience__hint">Use the arrows to browse Marinduque experiences</p>
      </section>

      <footer className="footer-v2">
        <div className="footer-v2-background-overlay"></div>
        <div className="footer-v2-content">
          <div className="footer-v2-logos">
            <div className="footer-v2-yellow-box"><img src={pesoLogo} alt="PESO Marinduque Logo" className="footer-v2-logo-img" /></div>
            <div className="footer-v2-seal"><img src={provincialSeal} alt="Provincial Seal" className="footer-v2-seal-img" /></div>
          </div>
          <div className="footer-v2-text">
            <p className="footer-v2-label">LIVELIHOOD MANPOWER DEVELOPMENT</p>
            <h2 className="footer-v2-title">PUBLIC EMPLOYMENT SERVICE OFFICE</h2>
            <p className="footer-v2-subtitle">Lalawigan ng Marinduque</p>
          </div>
          <div className="footer-v2-contact" aria-label="Contact links">
            <a className="footer-v2-contact-link" href="tel:+639567844364" aria-label="Call the office" title="Call the office">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.6 10.8c1.5 2.9 3.7 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1.1-.2 1.2.4 2.5.7 3.8.7.6 0 1.1.5 1.1 1.1v3.5c0 .6-.5 1.1-1.1 1.1C11.7 21.4 2.6 12.3 2.6 1.7c0-.6.5-1.1 1.1-1.1h3.5c.6 0 1.1.5 1.1 1.1 0 1.3.2 2.6.7 3.8.1.4 0 .8-.2 1.1l-2.2 2.2Z" /></svg>
            </a>
            <a className="footer-v2-contact-link" href="https://compose.mail.yahoo.com/?to=lmdpeso@yahoo.com" target="_blank" rel="noopener noreferrer" aria-label="Email the office" title="Email the office">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 5.5h18v13H3v-13Zm1.5 1.8 7.5 5.2 7.5-5.2M4.5 17l5.1-4.1m9.9 4.1-5.1-4.1" /></svg>
            </a>
            <a className="footer-v2-contact-link" href="https://web.facebook.com/LMDPESOMarinduqueOfficial" target="_blank" rel="noopener noreferrer" aria-label="Visit our Facebook page" title="Visit our Facebook page">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M13.4 21v-8h2.7l.4-3h-3.1V8.1c0-.9.3-1.5 1.6-1.5h1.7V4a21 21 0 0 0-2.4-.1c-2.4 0-4 1.5-4 4.1V10H7.6v3h2.7v8h3.1Z" /></svg>
            </a>
          </div>
        </div>
        <div className="footer-v2-copyright"><p>© 2025 Provincial Government of Marinduque. All Rights Reserved.</p></div>
      </footer>
    </div>
  );
}