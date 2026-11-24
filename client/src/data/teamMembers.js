import alkimarPhoto from "../assets/images/Alkimar.png";
import alexisPhoto from "../assets/images/Alexis.png";
import jakePhoto from "../assets/images/Jake.png";
import ivyPhoto from "../assets/images/Ivy.png";

// Team members shown on the About page and on /about/team/:slug.
//
// Fields follow the team portfolio handout. Only `slug`, `initials`, `name`, `role`,
// `bio` and `photo` are required. Every other field is optional: the profile page
// hides any section that has no data, so fill them in over time.
//
// Optional fields (copy into an entry and fill in):
//   alias            "Preferred name"
//   intro            2 to 3 sentences about the member, shown at the top
//   longBio          80 to 150 word biography (blank lines split paragraphs)
//   expertise        ["Skill", ...]
//   responsibilities ["Main responsibility", ...]
//   school           { name, program, year, major, standing, gwa, standingNote }
//   achievements     [{ title, issuer, year, description }]
//   activities       [{ name, role, period, description }]
//   certifications   [{ name, issuer, year, credential, expires }]
//   projects         [{ title, description, year }]
//   links            { linkedin, github, website, email }   (https:// URLs; email is a plain address)
//   order            number; sorts the Previous/Next cards (default: array position)
//   quote            "A personal or professional statement"
//   funFact          "Optional"
//   specialRole      "Founder, lead, developer, designer, etc."
//
// Email shows as a mailto button only when `links.email` is filled in (nobody has one yet).
export const TEAM_MEMBERS = [
  {
    slug: "alkimar-guitang",
    initials: "AG",
    name: "Alkimar Guitang",
    role: "Team Leader / UI-UX Designer",
    bio: "Leads the team and shaped the portal's look and feel, from layout to the overall user experience.",
    photo: alkimarPhoto,
    alias: "Alki",
    specialRole: "Team Leader",
    intro:
      "A versatile Software Developer, Front-End Developer, and Creative Designer with experience in web development, photography, and project leadership. Skilled in developing responsive applications, designing engaging user experiences, and delivering effective presentations and project pitches. Proven ability to lead teams and manage projects from planning to completion.",
    longBio:
      "I am an Information Technology student with skills in software development, front-end development, layout design, and photography. I have experience leading projects as a Capstone Project Leader, where I work with team members to plan, develop, and complete projects. I also enjoy creating websites, designing user-friendly interfaces, taking photos, and presenting ideas through project pitching. As an eSports player, I have learned teamwork, communication, and problem-solving skills. I am always willing to learn new things and improve my skills to create useful and creative solutions.",
    expertise: [
      "Front-End Development (HTML, CSS)",
      "Software Development & System Design",
      "UI/UX Design and Layout Design",
      "Web Application Development",
      "Photography & Photo Editing",
      "Presentation Design",
      "Graphic Design & Digital Content Creation",
      "Responsive Website Design",
    ],
    responsibilities: [
      "Led capstone project development and team coordination",
      "Developed and maintained web and software applications",
      "Designed layouts, user interfaces, and digital assets",
      "Conducted project presentations and pitching activities",
      "Produced and edited professional photography content",
      "Applied teamwork and strategic skills through competitive eSports",
    ],
    school: {
      name: "Marinduque State University",
      program: "Bachelor of Science in Information Technology",
      year: "Graduating 2027",
      major: "Software Development",
    },
    activities: [{ name: "InFocus", role: "Chief Photojournalist", period: "2025 - 2027" }],
    certifications: [
      {
        name: "Introduction to Python",
        issuer: "SoloLearn",
        year: "May 19, 2024",
        credential: "https://www.sololearn.com/certificates/CC-CR4IIZCA",
      },
      {
        name: "Introduction to SQL",
        issuer: "SoloLearn",
        year: "February 10, 2025",
        credential: "https://www.sololearn.com/certificates/CC-3ENTYSZW",
      },
      {
        name: "Java Intermediate",
        issuer: "SoloLearn",
        year: "December 5, 2025",
        credential: "https://www.sololearn.com/certificates/CC-Q1BWATKQ",
      },
      {
        name: "Certificate of Recognition – Digital Creative Fest",
        issuer: "Marinduque Provincial Youth Development",
        year: "September 8, 2026",
      },
      {
        name: "Certificate of Participation – EGames Sports Development Challenge, Innovation Fest 2026",
        issuer: "DOST MIMAROPA",
        year: "October 31, 2026",
      },
    ],
    projects: [
      {
        title: "FESH – Filipino Expedition through Sea's and History",
        year: "2026",
        description:
          "A pixel-art fishing adventure game set on Saltmere Island as the tutorial and starting island. Strange creatures are rising from the waters around the island, and the player, a new fisher, must find out why. The story runs through nine chapters. Five legendary creatures are caught between chapters in which Tomas, the island's keeper, sets the player up with tools, a home, and copper and iron from the caverns. Beyond Saltmere, the player can sail to the Philippine-inspired Amihan Archipelago, the Habagat islands and Marilaya. Each has its own villagers and stories built on real Philippine culture and science, such as earthquake and tsunami safety, volcano alert levels, tides, and sea-life conservation.",
      },
      {
        title: "STRAM-PESO: An Online Employment and Applicant Management System for the Public Employment Service Office of Marinduque",
        year: "2027",
        description:
          "A platform that enhances the employment facilitation system for the constituents of Marinduque. This web application aims to improve work efficiency by automating processes that still rely on traditional methods.",
      },
    ],
    links: { github: "https://github.com/mrwhat-ai" },
    quote: "Combining technology and creativity to bring ideas to life.",
  },
  {
    slug: "alexis-echon",
    initials: "AE",
    name: "Alexis Echon",
    role: "Lead Developer",
    bio: "Built out the core application logic and led the technical implementation of the platform.",
    photo: alexisPhoto,
    alias: "Alekchi",
    specialRole: "Co-founder and Lead Developer",
    intro:
      "Alexis M. Echon is a fourth-year Bachelor of Science in Information Technology student majoring in Software Development. He has acquired knowledge and skills in full-stack web development, system architecture, database design, and software engineering through academic projects and hands-on experience. He currently serves as the Lead Developer in their capstone project, where he leads system design and implementation, builds core application features, coordinates technical workflows, and supports the overall delivery of the application. He is passionate about technology, continuous learning, and improving his technical and problem-solving skills to prepare for a professional career in the IT industry.",
    expertise: [
      "Software Development",
      "Web Application Development",
      "System Analysis and Evaluation",
      "Software Testing",
      "AI Prompting",
      "Vibe Coding",
      "Technical Writing",
    ],
    responsibilities: [
      "Lead in developing the system throughout its initial to final phase",
      "Assist in identifying system errors and areas for improvement",
      "Support the development, testing, and evaluation of the capstone application",
      "Collaborate with team members to ensure project requirements and objectives are met",
    ],
    school: {
      name: "Marinduque State University",
      program: "Bachelor of Science in Information Technology",
      year: "4th year",
      major: "Software Development",
      standing: "Dean's Lister (1.6)",
    },
    achievements: [
      {
        title: "Champion, Hackathon (Marinduque Innovation Fest 2026)",
        issuer: "Department of Science and Technology",
        year: "2026",
        description:
          "Won first place under the team JimBilog by developing Kalinga, a progressive web app that urges individuals to get tested for possible STIs.",
      },
      {
        title: "Civil Service Professional Examination Passer",
        issuer: "Civil Service Commission",
        description: "Passed the Civil Service Professional Examination with a score of 84.81.",
      },
    ],
    activities: [
      { name: "InFocus", role: "Publication Contributor", period: "2024 - 2025" },
      { name: "InFocus", role: "News Writer", period: "2025 - 2026" },
      { name: "InFocus", role: "Copyreader", period: "2026 - 2027" },
    ],
    certifications: [
      { name: "AI Foundation: From Curious to Capable", issuer: "GN Academy", year: "2026" },
      { name: "Cloud Computing", issuer: "Ethel Programming Comp. Prog. Services", year: "2026" },
      {
        name: "Cybersecurity Essentials - Protect Your Data, Secure Your Business",
        issuer: "MV Consultancy",
        year: "2026",
      },
      {
        name: "Modern Software Development Tools, Trends and Practices",
        issuer: "Ethel Programming Comp. Prog. Services",
        year: "2026",
      },
      { name: "CISCO Junior Cybersecurity Analyst", issuer: "CISCO", year: "2025" },
      { name: "CISCO Cyber Threat Management", issuer: "CISCO", year: "2025" },
      { name: "CISCO Network Defense", issuer: "CISCO", year: "2025" },
      { name: "CISCO Endpoint Security", issuer: "CISCO", year: "2025" },
      { name: "CISCO Intro To Cybersecurity", issuer: "CISCO", year: "2025" },
      { name: "CISCO Operating Systems Basic", issuer: "CISCO", year: "2024" },
    ],
    projects: [
      {
        title: "Kalinga",
        year: "2026",
        description:
          "A progressive web app that urges individuals to get tested for possible STIs. Won first place at the Hackathon of Marinduque Innovation Fest 2026 under the team JimBilog.",
      },
      {
        title: "STRAM-PESO",
        year: "2026",
        description:
          "A platform that brings together Marinduque's PESO services and Labor Market Data into a single, easier-to-use portal for the province's jobseekers and employers.",
      },
    ],
    links: {
      linkedin: "https://www.linkedin.com/in/alexis-echon-835a2b451/",
      github: "https://github.com/alexis2005-echon",
    },
    quote: "Eat, sleep, code, repeat. And sometimes drink alcohol, but not too much.",
    funFact: "I sing a lot and like to be in solitude.",
  },
  {
    slug: "jake-romar-sescar",
    initials: "JS",
    name: "Jake Romar Sescar",
    role: "Quality Assurance",
    bio: "Reviews the quality and accuracy of project requirements, tests the system for errors, and helps keep the project's documentation complete.",
    photo: jakePhoto,
    alias: "Seijaro",
    specialRole: "Quality Assurance",
    intro:
      "Hello! My name is Jake Romar I. Sescar, and I serve as the Quality Assurance member in our capstone project. My responsibilities include assisting with documentation, reviewing the quality and accuracy of project requirements, and giving ideas on building the capstone project. I also contribute to the planning, testing, and overall development of the system to help achieve our project's goals.",
    longBio:
      "Jake Romar I. Sescar is a fourth-year Bachelor of Science in Information Technology student majoring in Software Development. He has acquired knowledge and skills in web development, system analysis, software testing, and technical documentation through academic projects and hands-on experience. He currently serves as the Quality Assurance member in their capstone project, where he assists in preparing and organizing project documentation, reviewing system requirements, evaluating the quality of system outputs, and supporting the overall development of the application. He is passionate about technology, continuous learning, and improving his technical and problem-solving skills to prepare for a professional career in the IT industry.",
    expertise: [
      "Software Development",
      "Web Application Development",
      "Technical Documentation",
      "Quality Assurance",
      "System Analysis and Evaluation",
      "Software Testing",
    ],
    responsibilities: [
      "Assist in preparing and organizing capstone project documentation",
      "Assist in identifying system errors and areas for improvement",
      "Support the development, testing, and evaluation of the capstone application",
      "Collaborate with team members to ensure project requirements and objectives are met",
      "Help maintain documentation throughout the system development process",
    ],
    school: {
      name: "Marinduque State University",
      program: "Bachelor of Science in Information Technology",
      year: "4th year",
      major: "Software Development",
    },
    links: { github: "https://github.com/sescarjakeromar-coder" },
    quote: "Work hard in silence, let your success be your noise.",
  },
  {
    slug: "ivy-cruzado",
    initials: "IC",
    name: "Ivy Cruzado",
    role: "Documentation",
    bio: "Handles the project's written documentation, keeping the team's process and output clearly recorded.",
    photo: ivyPhoto,
    alias: "Vhie",
    specialRole: "Documentation Analyst",
    intro:
      "I am a 4th-year Information Technology student specializing in Software Development, serving as a Team Member and Documentation Analyst. I ensure that every phase of our project is clearly documented, well-structured, and aligned with technical and user requirements.",
    longBio:
      "Ivy Larracas Cruzado, also known as Vhie, is a senior Bachelor of Science in Information Technology student majoring in Software Development at Marinduque State University. A consistent Dean's Lister from her first to third year in every second semester, she combines strong analytical skills with a keen eye for detail. As the team's Documentation Analyst, Ivy bridges communication between technical development and project stakeholders by translating complex system requirements, workflows, and testing results into clear, comprehensive documentation. Passionate about organized software engineering processes and quality assurance, she is dedicated to helping teams deliver reliable and well-documented software solutions.",
    expertise: ["Software Requirements Analysis & Process Workflow", "Technical & System Documentation"],
    responsibilities: [
      "Preparing, organizing, and maintaining project documentation, including system specifications, progress reports, and user guidelines",
      "Collaborating with developers to document system workflows, database structures, and testing outcomes",
      "Ensuring accuracy, clarity, and completeness across all project deliverables",
    ],
    school: {
      name: "Marinduque State University",
      program: "Bachelor of Science in Information Technology",
      year: "4th year",
      major: "Software Development",
      standing: "Dean's Lister, 2nd semester of 1st year through 3rd year",
    },
    achievements: [
      {
        title: "Dean's Lister",
        issuer: "Marinduque State University",
        year: "2024, 2025, 2026",
        description: "Recognized for consistent academic excellence from the 2nd semester of 1st year through 3rd year.",
      },
    ],
    activities: [
      {
        name: "University Athlete in Athletics",
        role: "Sprinter",
        period: "2023 - 2026",
        description: "Three-time gold medalist in the 100-meter and 200-meter dash.",
      },
    ],
    projects: [
      {
        title: "STRAM-PESO: An Online Employment and Applicant Management System for the Public Employment Service Office of Marinduque",
        year: "2026",
        description:
          "A centralized online platform designed to streamline job matching, applicant tracking, and employment services for the Public Employment Service Office (PESO) of Marinduque.",
      },
    ],
    links: { linkedin: "https://www.linkedin.com/in/ivy-cruzado-aa3465449/" },
    quote: "Whether on the track or in software development, consistency and focus turn goals into results.",
    funFact:
      "I'm a three-time university gold medalist in the 100m and 200m dash, so I bring sprinter-level speed and focus to meeting project deadlines!",
  },
];

export const findTeamMember = (slug) => TEAM_MEMBERS.find((m) => m.slug === slug) || null;

// Members in display order: the optional `order` field wins, otherwise array position.
export const orderedMembers = () =>
  TEAM_MEMBERS.map((m, i) => ({ m, k: Number.isFinite(m.order) ? m.order : i }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.m);

// Previous and next member, wrapping around at both ends.
export const neighborsOf = (slug) => {
  const list = orderedMembers();
  const i = list.findIndex((m) => m.slug === slug);
  if (i < 0) return { prev: null, next: null };
  const n = list.length;
  return { prev: list[(i - 1 + n) % n], next: list[(i + 1) % n] };
};

// Which optional sections have data, in display order. Used by the profile page and tests.
export const profileSections = (m) => ({
  intro: Boolean(m.intro),
  bio: Boolean(m.longBio),
  expertise: Boolean(m.expertise?.length),
  responsibilities: Boolean(m.responsibilities?.length),
  projects: Boolean(m.projects?.length),
  achievements: Boolean(m.achievements?.length),
  activities: Boolean(m.activities?.length),
  certifications: Boolean(m.certifications?.length),
  school: Boolean(m.school && Object.values(m.school).some(Boolean)),
  links: Boolean(m.links && Object.values(m.links).some(Boolean)),
  funFact: Boolean(m.funFact),
  quote: Boolean(m.quote),
});
