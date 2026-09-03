import { useEffect, useMemo, useState } from "react";
import "../styles/about.css";
import pesoLogo from "../assets/images/peso-logo.png";
import provincialSeal from "../assets/images/provincial-seal.png";
import alkimarPhoto from "../assets/images/Alkimar.png";
import alexisPhoto from "../assets/images/Alexis.png";
import jakePhoto from "../assets/images/Jake.png";
import ivyPhoto from "../assets/images/Ivy.png";

const MUNICIPALITIES = {
  boac: {
    name: "Boac",
    text: "The provincial capital - home to the main government offices, PESO Marinduque's main office, and a growing base of retail and service-sector jobs.",
  },
  mogpog: {
    name: "Mogpog",
    text: "A farming and inland-fishing community on the island's north side, with a workforce centered on agriculture and small-scale trade.",
  },
  santacruz: {
    name: "Santa Cruz",
    text: "The province's largest municipality by land area, with a workforce spread across agriculture, trade, and local industry.",
  },
  gasan: {
    name: "Gasan",
    text: "A coastal municipality and port town, where fishing and small enterprise make up a large share of local livelihoods.",
  },
  buenavista: {
    name: "Buenavista",
    text: "The smallest municipality on the island, largely agricultural, with farming households forming the core of the local workforce.",
  },
  torrijos: {
    name: "Torrijos",
    text: "Known for its coastline and marine tourism spots, with livelihoods split between fishing, tourism-linked work, and agriculture.",
  },
};

const TEAM_MEMBERS = [
  {
    key: "m1",
    initials: "AG",
    name: "Alkimar Guitang",
    role: "Team Leader / UI-UX Designer",
    bio: "Leads the team and shaped the portal's look and feel, from layout to the overall user experience.",
    photo: alkimarPhoto,
  },
  {
    key: "m2",
    initials: "AE",
    name: "Alexis Echon",
    role: "Lead Developer",
    bio: "Built out the core application logic and led the technical implementation of the platform.",
    photo: alexisPhoto,
  },
  {
    key: "m3",
    initials: "JS",
    name: "Jake Romar Sescar",
    role: "Database Analyst",
    bio: "Designed the data structure behind the portal and manages how information is stored and organized.",
    photo: jakePhoto,
  },
  {
    key: "m4",
    initials: "IC",
    name: "Ivy Cruzado",
    role: "Documentation",
    bio: "Handles the project's written documentation, keeping the team's process and output clearly recorded.",
    photo: ivyPhoto,
  },
];

export default function About() {
  const year = useMemo(() => new Date().getFullYear(), []);
  const [activeTab, setActiveTab] = useState("lmd");
  const [activeMunicipality, setActiveMunicipality] = useState(null);

  useEffect(() => {
    const revealEls = Array.from(document.querySelectorAll(".about-mock .reveal"));
    if (!revealEls.length) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.15 }
    );

    revealEls.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const blob = document.querySelector("#heroBlobSvg");
    if (!blob) return undefined;

    const handleMove = (event) => {
      const x = (event.clientX / window.innerWidth - 0.5) * 24;
      const y = (event.clientY / window.innerHeight - 0.5) * 24;
      blob.style.transform = `translate(${x}px, ${y}px)`;
    };

    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, []);

  const municipalityData = activeMunicipality
    ? MUNICIPALITIES[activeMunicipality]
    : {
        name: "Marinduque",
        text: "Six municipalities - Boac, Mogpog, Santa Cruz, Gasan, Buenavista, and Torrijos - make up the province. Hover any point on the map to read a short note about that town's local livelihoods.",
      };

  return (
    <main className="about-mock" aria-label="About STRAM PESO">
      <section className="hero">
        <div className="hero-blob" id="heroBlob">
          <svg id="heroBlobSvg" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
            <path fill="#2E7D32" d="M200,40 C260,10 340,60 350,140 C360,230 300,300 210,350 C140,390 60,340 40,260 C20,180 60,90 130,60 C155,50 178,50 200,40 Z" />
          </svg>
        </div>
        <div className="hero-inner wrap">
          <span className="eyebrow">Province of Marinduque · Employment Portal</span>
          <h1>
            Work, mapped across
            <br />
            the <em>heart</em> of the Philippines.
          </h1>
          <p className="sub">A province-wide platform built on Marinduque's Labor Market Data and the daily work of PESO - connecting jobseekers, employers, and the six municipalities that make up the island.</p>
          <div className="pill-row">
            <div className="pill"><span className="dot"></span> 6 Municipalities</div>
            <div className="pill"><span className="dot"></span> Free Employment Facilitation</div>
            <div className="pill"><span className="dot"></span> Student Capstone Project</div>
          </div>
        </div>
        <div className="scroll-cue"><span className="line"></span> Scroll</div>
      </section>

      <section id="about">
        <div className="wrap">
          <div className="head reveal">
            <span className="eyebrow">The Foundation</span>
            <h2>What powers this portal</h2>
            <p>Two things sit behind every listing and every number on this site: the province's Labor Market Data, and the office that collects and acts on it.</p>
          </div>

          <div className="tab-shell reveal">
            <div className="tab-nav">
              <button className={`tab-btn ${activeTab === "lmd" ? "active" : ""}`} onClick={() => setActiveTab("lmd")}>
                Labor Market Data
                <small>The information layer</small>
              </button>
              <button className={`tab-btn ${activeTab === "peso" ? "active" : ""}`} onClick={() => setActiveTab("peso")}>
                PESO Marinduque
                <small>The people behind it</small>
              </button>
            </div>
            <div className="tab-panels">
              <div className={`tab-panel ${activeTab === "lmd" ? "active" : ""}`} id="panel-lmd">
                <h3>Labor Market Data (LMD)</h3>
                <p>LMD refers to the ongoing collection of information on job vacancies, in-demand skills, industry activity, and workforce movement across Marinduque's six municipalities. It's the raw material this portal runs on - turned into listings, guidance, and a clearer picture of where work is happening on the island.</p>
                <p>Edit the figures and summaries in this section once your group has gathered the actual dataset for your capstone.</p>
                <div className="chip-list">
                  <span className="chip">Job vacancies</span>
                  <span className="chip">Skills in demand</span>
                  <span className="chip">Industry trends</span>
                  <span className="chip">Workforce movement</span>
                </div>
              </div>
              <div className={`tab-panel ${activeTab === "peso" ? "active" : ""}`} id="panel-peso">
                <h3>Public Employment Service Office</h3>
                <p>PESO Marinduque provides free employment facilitation to residents - job referrals, labor market information, career guidance, and coordination with national programs. It's the office that turns Labor Market Data into direct help for jobseekers and local employers.</p>
                <p>Replace this description with your own research on PESO Marinduque's specific programs and services.</p>
                <div className="chip-list">
                  <span className="chip">Job referral</span>
                  <span className="chip">Career counseling</span>
                  <span className="chip">Livelihood programs</span>
                  <span className="chip">Employer linkage</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="map-section" id="map">
        <div className="wrap">
          <div className="head reveal">
            <span className="eyebrow">Across the Island</span>
            <h2>Six municipalities, one workforce</h2>
            <p>Hover or tap a point on the map to see a short note on that municipality. Swap in your group's real labor data for each one.</p>
          </div>

          <div className="map-grid reveal">
            <div className="island-wrap">
              <svg viewBox="0 0 400 420" xmlns="http://www.w3.org/2000/svg">
                <path d="M200,20 C270,-10 360,40 370,130 C380,220 330,300 260,350 C210,385 190,405 180,405 C170,405 150,385 100,345 C40,300 15,220 30,140 C45,65 130,50 175,35 C183,32 191,25 200,20 Z" fill="none" stroke="rgba(250,251,245,0.35)" strokeWidth="1.5" />
                <path d="M200,20 C270,-10 360,40 370,130 C380,220 330,300 260,350 C210,385 190,405 180,405 C170,405 150,385 100,345 C40,300 15,220 30,140 C45,65 130,50 175,35 C183,32 191,25 200,20 Z" fill="rgba(139,197,63,0.07)" />

                {[
                  { key: "mogpog", x: 175, y: 80 },
                  { key: "boac", x: 150, y: 165 },
                  { key: "santacruz", x: 275, y: 150 },
                  { key: "gasan", x: 120, y: 230 },
                  { key: "buenavista", x: 155, y: 285 },
                  { key: "torrijos", x: 230, y: 320 },
                ].map((pin) => (
                  <g
                    key={pin.key}
                    className={`pin ${activeMunicipality === pin.key ? "active" : ""}`}
                    transform={`translate(${pin.x},${pin.y})`}
                    onMouseEnter={() => setActiveMunicipality(pin.key)}
                    onClick={() => setActiveMunicipality(pin.key)}
                  >
                    <circle className="ring" r="7" />
                    <circle className="core" r="7" />
                  </g>
                ))}
              </svg>
            </div>

            <div className="muni-info" id="muniInfo">
              <span className="tag">Municipality</span>
              <h3 id="muniName">{municipalityData.name}</h3>
              <p id="muniText">{municipalityData.text}</p>
              <p className="muni-hint">Tip: this text pulls from the data object in the page component - edit the MUNICIPALITIES list to update it.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="offers">
        <div className="wrap">
          <div className="head reveal">
            <span className="eyebrow">On This Portal</span>
            <h2>What jobseekers and employers get</h2>
          </div>
          <div className="feat-grid reveal">
            <div className="feat-card">
              <div className="feat-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
              </div>
              <h3>Job Matching</h3>
              <p>Open positions from local employers, organized by municipality and industry.</p>
            </div>
            <div className="feat-card">
              <div className="feat-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18" /><path d="M7 15l4-6 4 3 5-8" /></svg>
              </div>
              <h3>Labor Market Insights</h3>
              <p>A clearer read on where demand is growing across the island's six towns.</p>
            </div>
            <div className="feat-card">
              <div className="feat-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
              </div>
              <h3>Career Guidance</h3>
              <p>Pointers on skills, training, and programs offered through PESO Marinduque.</p>
            </div>
            <div className="feat-card">
              <div className="feat-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 21v-6h6v6" /></svg>
              </div>
              <h3>Employer Directory</h3>
              <p>A running list of local businesses and offices hiring across the province.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="team-section" id="team">
        <div className="wrap">
          <div className="head reveal">
            <span className="eyebrow">Behind This Page</span>
            <h2>A student capstone project</h2>
            <p>This portal was designed and built by four students as their capstone project. Photos and names below are placeholders - swap them for the real team.</p>
          </div>

          <div className="team-grid reveal">
            {TEAM_MEMBERS.map((member) => (
              <div className="team-card" key={member.key}>
                <div className="avatar-frame">
                  {
                    member.photo ? (<img src={member.photo} alt={member.name} className="avatar-img" />) : 
                    (<div className="avatar-fallback" aria-hidden="true">{member.initials}</div>)
                  }
                </div>
                <div className="team-body">
                  <h3>{member.name}</h3>
                  <span className="team-role">{member.role}</span>
                  <p className="team-bio">{member.bio}.</p>
                </div>
              </div>
            ))}
          </div>

          <div className="capstone-banner reveal">
            <div>
              <strong>About this project</strong>
              <p>Built as a capstone requirement, this platform brings together Marinduque's PESO services and Labor Market Data into a single, easier-to-use portal for the province's jobseekers and employers.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="closing">
        <div className="wrap reveal">
          <span className="eyebrow closing-eyebrow">Isang Marinduque</span>
          <h2>Six towns, one island, one workforce - better connected.</h2>
          <p className="kicker">Update this page's copy, images, and municipality notes as your capstone data comes in.</p>
          <p className="tagalog">"Marinduque, ang puso ng Pilipinas."</p>
        </div>
      </section>

      <footer className="footer-v2">
        <div className="footer-v2-background-overlay"></div>
        <div className="footer-v2-content">
          <div className="footer-v2-logos">
            <div className="footer-v2-yellow-box">
              <img src={pesoLogo} alt="PESO Marinduque Logo" className="footer-v2-logo-img" />
            </div>
            <div className="footer-v2-seal">
              <img src={provincialSeal} alt="Provincial Seal" className="footer-v2-seal-img" />
            </div>
          </div>
          <div className="footer-v2-text">
            <p className="footer-v2-label">LIVELIHOOD MANPOWER DEVELOPMENT</p>
            <h2 className="footer-v2-title">PUBLIC EMPLOYMENT SERVICE OFFICE</h2>
            <p className="footer-v2-subtitle">Lalawigan ng Marinduque</p>
          </div>
          <div className="footer-v2-contact" aria-label="Contact links">
            <a className="footer-v2-contact-link" href="tel:+639567844364" aria-label="Call the office" title="Call the office">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M6.6 10.8c1.5 2.9 3.7 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1.1-.2 1.2.4 2.5.7 3.8.7.6 0 1.1.5 1.1 1.1v3.5c0 .6-.5 1.1-1.1 1.1C11.7 21.4 2.6 12.3 2.6 1.7c0-.6.5-1.1 1.1-1.1h3.5c.6 0 1.1.5 1.1 1.1 0 1.3.2 2.6.7 3.8.1.4 0 .8-.2 1.1l-2.2 2.2Z" />
              </svg>
            </a>
            <a className="footer-v2-contact-link" href="https://compose.mail.yahoo.com/?to=lmdpeso@yahoo.com" target="_blank" rel="noopener noreferrer" aria-label="Email the office" title="Email the office">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M3 5.5h18v13H3v-13Zm1.5 1.8 7.5 5.2 7.5-5.2M4.5 17l5.1-4.1m9.9 4.1-5.1-4.1" />
              </svg>
            </a>
            <a className="footer-v2-contact-link" href="https://web.facebook.com/LMDPESOMarinduqueOfficial" target="_blank" rel="noopener noreferrer" aria-label="Visit our Facebook page" title="Visit our Facebook page">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M13.4 21v-8h2.7l.4-3h-3.1V8.1c0-.9.3-1.5 1.6-1.5h1.7V4a21 21 0 0 0-2.4-.1c-2.4 0-4 1.5-4 4.1V10H7.6v3h2.7v8h3.1Z" />
              </svg>
            </a>
          </div>
        </div>
        <div className="footer-v2-copyright">
          <p>Copyright {year} Provincial Government of Marinduque. All Rights Reserved.</p>
        </div>
      </footer>
    </main>
  );
}
