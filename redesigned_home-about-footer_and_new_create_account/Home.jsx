import { useContext, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FaMapMarkerAlt, FaBuilding, FaArrowRight, FaChevronLeft, FaChevronRight } from "react-icons/fa";
import { AuthContext } from "../context/AuthContext";
import { jobAPI } from "../services/api";
import "../styles/home.css";
import heroVideo from "../assets/videos/hero-video.mp4";
import pesoLogo from "../assets/images/peso-logo.png";
import provincialSeal from "../assets/images/provincial-seal.png";
import searchBannerBg from "../assets/images/search-banner-background.png";
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

const formatAddress = (address) => {
  if (!address) return "Marinduque";
  if (typeof address !== "string") return "Marinduque";
  const parts = address.split(", ");
  if (parts.length >= 2) return `${parts[0]}, ${parts.slice(1).join(", ")}`;
  return address;
};

export default function Home() {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  const location = useLocation();
  const jobsRef = useRef(null);
  const heroRef = useRef(null);
  const carouselRef = useRef(null);
  const cardRefs = useRef([]);

  const [showRegisterPrompt, setShowRegisterPrompt] = useState(false);
  const [selectedProgram, setSelectedProgram] = useState(null);
  const [featuredJobs, setFeaturedJobs] = useState(HOME_FEATURED_JOBS);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [visibleCards, setVisibleCards] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [experienceIndex, setExperienceIndex] = useState(0);

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
    const cards = Array.from(document.querySelectorAll("[data-fade-card]"));
    if (!cards.length) return undefined;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const cardId = entry.target.getAttribute("data-card-id");
        if (cardId) setVisibleCards((current) => ({ ...current, [cardId]: true }));
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.18, rootMargin: "0px 0px -40px 0px" });
    
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [featuredJobs]);

  useEffect(() => {
    const debounceTimer = setTimeout(() => setIsSearching(false), 300);
    return () => clearTimeout(debounceTimer);
  }, [searchQuery]);

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

  const getClosestCardIndex = () => {
    if (!carouselRef.current || !cardRefs.current.length) return 0;
    const viewportRect = carouselRef.current.getBoundingClientRect();
    const viewportCenter = viewportRect.left + viewportRect.width / 2;

    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    cardRefs.current.forEach((card, idx) => {
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const cardCenter = rect.left + rect.width / 2;
      const distance = Math.abs(cardCenter - viewportCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = idx;
      }
    });

    return closestIndex;
  };

  const scrollCarousel = (direction) => {
    const currentIndex = getClosestCardIndex();
    const nextIndex = Math.max(0, Math.min(currentIndex + direction, filteredJobs.length - 1));
    scrollToCard(nextIndex);
  };

  const scrollToCard = (index) => {
    const clampedIndex = Math.max(0, Math.min(index, filteredJobs.length - 1));
    const targetCard = cardRefs.current[clampedIndex];
    if (!targetCard) return;
    targetCard.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    setActiveIndex(clampedIndex);
  };

  const handleCarouselScroll = () => {
    const index = getClosestCardIndex();
    if (index !== activeIndex) setActiveIndex(index);
  };

  const handleWheel = (e) => {
    if (e.deltaY !== 0 && carouselRef.current) {
      e.preventDefault();
      carouselRef.current.scrollLeft += e.deltaY;
    }
  };

  const scrollToAvailableJobs = () => {
    const availableJobsSection = document.getElementById("available-jobs");
    if (availableJobsSection) {
      setShowScrollButton(false);
      availableJobsSection.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
    }
  };

  const getFilteredJobs = () => {
    try {
      if (!searchQuery.trim()) return featuredJobs;
      const query = searchQuery.toLowerCase().trim();
      const results = featuredJobs.filter(job => {
        if (!job) return false;
        const title = (job.title || "").toLowerCase().trim();
        const employer = (typeof job.employer === 'string' ? job.employer : job.employer?.companyName || job.employer?.name || "").toLowerCase().trim();
        const location = (job.location || "").toLowerCase().trim();
        let jobType = "";
        if (job.jobType && typeof job.jobType === 'string') jobType = job.jobType.toLowerCase().trim();
        else if (job.type && typeof job.type === 'string') jobType = job.type.toLowerCase().trim();
        else if (job.employmentType && typeof job.employmentType === 'string') jobType = job.employmentType.toLowerCase().trim();
        
        let isMatch = false;
        if (title && title.includes(query)) isMatch = true;
        if (employer && employer.includes(query) && employer !== "employer") isMatch = true;
        if (location && location.includes(query)) isMatch = true;
        if (jobType && jobType.includes(query)) isMatch = true;
        return isMatch;
      });
      return results;
    } catch (error) {
      console.error("Error filtering jobs:", error);
      return featuredJobs;
    }
  };

  const filteredJobs = getFilteredJobs();
  const hasNoResults = searchQuery.trim() !== "" && filteredJobs.length === 0 && !jobsLoading;

  useEffect(() => {
    cardRefs.current = cardRefs.current.slice(0, filteredJobs.length);
    setActiveIndex(0);
    window.requestAnimationFrame(() => {
      if (!carouselRef.current || !cardRefs.current[0]) return;
      cardRefs.current[0].scrollIntoView({ behavior: "auto", inline: "center", block: "nearest" });
    });
  }, [filteredJobs.length]);

  const openRegisterPrompt = () => setShowRegisterPrompt(true);
  const closeRegisterPrompt = () => setShowRegisterPrompt(false);
  const goToRegister = (route) => { closeRegisterPrompt(); navigate(route); };
  const closeProgramModal = () => setSelectedProgram(null);
  const handleViewJob = (job) => { if (!job?._id) return; navigate(`/jobs/${job._id}`); };
  const clearSearch = () => { setSearchQuery(""); setIsSearching(false); };

  const getJobStatus = (job) => {
    try {
      const deadlineValue = job?.applicationDeadline || job?.deadline;
      if (!deadlineValue) return { label: "Open", variant: "open" };
      const deadlineDate = new Date(deadlineValue);
      if (Number.isNaN(deadlineDate.getTime())) return { label: "Open", variant: "open" };
      const daysRemaining = Math.ceil((deadlineDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (daysRemaining <= 7 && daysRemaining >= 0) {
        return { label: `Closing soon${daysRemaining > 0 ? ` · ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left` : ""}`, variant: "closing" };
      }
      return { label: "Open", variant: "open" };
    } catch {
      return { label: "Open", variant: "open" };
    }
  };

  const getEmployerName = (job) => {
    try {
      if (typeof job?.employer === "string") return job.employer;
      if (job?.employer?.companyName) return job.employer.companyName;
      if (job?.employer?.name) return job.employer.name;
      return "";
    } catch { return ""; }
  };

  const handleSearchChange = (e) => { setSearchQuery(e.target.value); setIsSearching(true); };

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
        <div className="jobs-search-banner">
          <div className="jobs-search-banner-left">
            <div className="jobs-search-banner-image"><img src={searchBannerBg} alt="Search banner background" /></div>
            <div className="jobs-search-banner-diagonal"></div>
          </div>
          <div className="jobs-search-banner-right">
            <h2 className="jobs-search-banner-title">Find the right one for you</h2>
            <p className="jobs-search-banner-subtitle">Discover livelihood support, emergency employment, and skills training opportunities designed for Marinduqueños.</p>
            <div className="jobs-search-input-wrapper">
              <span className="jobs-search-icon">🔍</span>
              <input type="text" className="jobs-search-input" placeholder="Search by job title, employer, location, or type..." value={searchQuery} onChange={handleSearchChange} />
              {searchQuery && <button className="search-clear-btn" onClick={clearSearch}>✕</button>}
            </div>
          </div>
        </div>

        <div className="section-heading-wrap">
          <span className="section-kicker">Available Jobs</span>
          <h2>Current employer openings</h2>
          <p>Browse featured vacancies from local employers. Visitors can preview openings here and log in to apply.</p>
        </div>

        {jobsLoading ? (
          <div className="section-loading"><p>Loading available jobs...</p></div>
        ) : isSearching ? (
          <div className="section-loading"><p>Searching for "{searchQuery}"...</p></div>
        ) : hasNoResults ? (
          <div className="no-results-container">
            <div className="no-results-icon">🔍</div>
            <h3>No jobs found for "{searchQuery}"</h3>
            <p>We couldn't find any matching jobs. Try adjusting your search terms.</p>
            <div className="suggestions"><p>💡 Suggestions:</p><ul><li>Check for typos or spelling errors</li><li>Use more general keywords (e.g., "assistant" instead of "admin assistant")</li><li>Try searching by job type (e.g., "full-time", "contract")</li><li>Browse all available jobs below</li></ul></div>
            <button className="jobs-see-more-btn" onClick={clearSearch}>View All Jobs</button>
          </div>
        ) : (
          <>
            {searchQuery && (
              <div className="search-summary">
                <p>Found <strong>{filteredJobs.length}</strong> job{filteredJobs.length !== 1 ? 's' : ''} matching "<strong>{searchQuery}</strong>"</p>
                <button className="clear-search-link" onClick={clearSearch}>Clear search</button>
              </div>
            )}

            {/* CAROUSEL CONTAINER */}
            <div className="jobs-carousel" ref={carouselRef} onWheel={handleWheel} onScroll={handleCarouselScroll}>
              {filteredJobs.length > 0 ? (
                filteredJobs.map((job, index) => {
                  const title = job?.title || "Untitled Position";
                  const jobId = job?._id || job?.id || title;
                  const employerName = getEmployerName(job) || "Employer";
                  const status = getJobStatus(job);
                  const employerInitial = employerName.charAt(0).toUpperCase() || "E";
                  const jobType = job?.jobType || job?.type || job?.employmentType || "";
                  const description = job?.description || "";
                  return (
                    <article
                      key={jobId}
                      className={`job-card-v2 ${visibleCards[jobId] ? "is-visible" : ""} ${status.variant === "closing" ? "job-card-v2--closing" : ""}`}
                      data-fade-card="true"
                      data-card-id={jobId}
                      ref={(element) => { cardRefs.current[index] = element; }}
                      style={{ "--card-delay": `${index * 90}ms` }}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleViewJob(job)}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handleViewJob(job); } }}
                    >
                      <div className="job-card-v2-top">
                        <div className="job-card-v2-logo">
                          <div className="job-card-v2-logo-circle">{employerInitial}</div>
                        </div>
                        <div className="job-card-v2-badges">
                          {jobType && <span className="job-card-v2-type-badge">{jobType}</span>}
                          <div className={`job-card-v2-status job-card-v2-status--${status.variant}`}>
                            <span className={`job-card-v2-status-dot job-card-v2-status-dot--${status.variant}`}></span>
                            {status.variant === "closing" ? "Closing" : "Open"}
                          </div>
                        </div>
                      </div>

                      <div className="job-card-v2-body">
                        <span className="job-card-v2-employer" title={employerName}>
                          <FaBuilding className="job-card-v2-employer-icon" />
                          <span>{employerName}</span>
                        </span>
                        <h3 className="job-card-v2-title" title={title}>{title}</h3>
                        <div className="job-card-v2-location" title={typeof job.location === "string" ? job.location : ""}>
                          <FaMapMarkerAlt className="job-card-v2-loc-icon" />
                          <span>{formatAddress(job.location)}</span>
                        </div>
                        {description && (
                          <p className="job-card-v2-description">{description}</p>
                        )}
                      </div>

                      <div className="job-card-v2-footer">
                        <button type="button" className="job-card-v2-button" onClick={(event) => { event.stopPropagation(); handleViewJob(job); }}>
                          <span>View Details</span>
                          <FaArrowRight className="job-card-v2-btn-arrow" />
                        </button>
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="no-results-container"><div className="no-results-icon">🔍</div><h3>No jobs available</h3><p>There are currently no job postings. Please check back later.</p></div>
              )}
            </div>

            {/* Carousel Indicators (Dots) */}
            <div className="carousel-indicators">
              {filteredJobs.map((job, index) => (
                <button
                  key={index}
                  className={`carousel-dot ${activeIndex === index ? 'is-active' : ''}`}
                  onClick={() => scrollToCard(index)}
                  aria-label={`Go to slide ${index + 1}`}
                />
              ))}
            </div>

            {/* Carousel Navigation Controls (Below Carousel) */}
            <div className="carousel-nav-controls">
              <button className="carousel-btn" onClick={() => scrollCarousel(-1)} aria-label="Previous jobs">
                <FaChevronLeft />
              </button>
              <button className="carousel-btn" onClick={() => scrollCarousel(1)} aria-label="Next jobs">
                <FaChevronRight />
              </button>
            </div>

            <div className="jobs-see-more-wrapper">
              <button className="jobs-see-more-btn" onClick={() => navigate("/jobs")}>See More Jobs</button>
            </div>
          </>
        )}
      </section>

      {showRegisterPrompt && (
        <div className="register-choice-overlay" onClick={closeRegisterPrompt}>
          <div className="register-choice-modal" onClick={(event) => event.stopPropagation()}>
            <h3>Register as</h3><p>Select your account type to continue.</p>
            <div className="register-choice-actions">
              <button type="button" className="register-choice-btn" onClick={() => goToRegister("/register")}>Resident / Jobseeker</button>
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

      <section class="how-it-works-v2">
        <div class="how-it-works-v2-container">
          <h2 class="how-it-works-v2-title">How it Works</h2>
          <div class="how-it-works-v2-layout">
            <div class="how-it-works-v2-steps">
              <div class="how-it-works-v2-step-card">
                <div class="how-it-works-v2-step-number">1</div>
                <h3 class="how-it-works-v2-step-title">Register</h3>
                <p class="how-it-works-v2-step-description">
                  Create an account as a job seeker or employer.
                </p>
              </div>
              <div class="how-it-works-v2-step-card">
                <div class="how-it-works-v2-step-number">2</div>
                <h3 class="how-it-works-v2-step-title">Login</h3>
                <p class="how-it-works-v2-step-description">Sign in with your credentials.</p>
              </div>
              <div class="how-it-works-v2-step-card">
                <div class="how-it-works-v2-step-number">3</div>
                <h3 class="how-it-works-v2-step-title">Apply</h3>
                <p class="how-it-works-v2-step-description">
                  Upload your resume and submit applications.
                </p>
              </div>
              <div class="how-it-works-v2-step-card">
                <div class="how-it-works-v2-step-number">4</div>
                <h3 class="how-it-works-v2-step-title">Manage</h3>
                <p class="how-it-works-v2-step-description">
                  Employers review applicants and admins monitor analytics.
                </p>
              </div>
            </div>
            <div class="how-it-works-v2-video-wrapper">
              <div class="how-it-works-v2-video-card">
                <iframe
                  class="how-it-works-v2-video"
                  src="https://www.youtube.com/embed/dQw4w9WgXcQ"
                  title="How it works video"
                  frameborder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowfullscreen
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