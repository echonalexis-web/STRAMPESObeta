// Cover letter body text for the Resume & Cover Letter Studio.
//
// Every tone is a list of lines. A line is either one sentence or a list of alternatives; the
// first alternative whose {tokens} are ALL known is used, and a line with no usable alternative
// is left out. So the letter never contains a bracketed placeholder, and never claims something
// the profile cannot back (no invented achievements, projects or specialisations).

const TOKEN = /\{[a-z_]+\}/g;

export const LETTER_TONE_LINES = {
  professional: {
    intro: [
      "I am writing to express my strong interest in the {position} position at {company}.",
      "With my background in {field}, I am confident that my skills and qualifications align well with the requirements of this role.",
    ],
    experience: [
      [
        "In my previous role as {previous_role}, I developed strong skills in {skills}.",
        "I have developed strong skills in {skills}.",
      ],
      "These experiences have prepared me to contribute effectively to your team.",
    ],
    skills: ["My key strengths include {key_skills}.", "I am particularly proficient in {proficiency}."],
    whyCompany: [
      "I have been following {company}'s work in {industry} and I am impressed by your commitment to {value}.",
      "I am excited about the opportunity to contribute to your mission and grow with your team.",
    ],
    closing: [
      "Thank you for considering my application. I look forward to the opportunity to discuss how my background and skills can contribute to the success of {company}.",
    ],
  },

  enthusiastic: {
    intro: [
      [
        "Hi {company_name} Team! I was thrilled to see the {position} opening.",
        "Hello! I was thrilled to see the {position} opening.",
      ],
      "As someone who is passionate about {field}, I am genuinely excited about the chance to join {company}.",
    ],
    experience: [
      [
        "I bring {skills} from my previous role as {previous_role}, and I am eager to put them to work at {company}.",
        "I bring {skills} and I am eager to put them to work at {company}.",
      ],
    ],
    skills: ["My core competencies include {key_skills}.", "I am always learning and staying up to date in {field}."],
    whyCompany: [
      "What excites me most about {company} is your focus on {value}. I share your values and I am looking forward to contributing to your continued success.",
    ],
    closing: [
      "Let's connect and chat about how I can help {company} achieve even greater things! Looking forward to hearing from you.",
    ],
  },

  concise: {
    intro: [
      "I am applying for the {position} position at {company}.",
      "My experience in {field} makes me a strong candidate for this role.",
    ],
    experience: ["I bring {years} of experience in {field}.", "My previous role was {previous_role}."],
    skills: ["My key skills include {key_skills}."],
    whyCompany: ["I am drawn to {company} because of your focus on {value}. I believe I can contribute to your team."],
    closing: ["Thank you for your consideration. I look forward to hearing from you."],
  },

  // Fresh graduates and first-time jobseekers: never mentions a previous role, years of
  // experience or an achievement, since those would be false for this audience.
  firstTime: {
    intro: [
      "I am writing to apply for the {position} position at {company}.",
      [
        "As a first-time jobseeker with a background in {field}, I am eager to begin my career and bring a strong willingness to learn to your team.",
        "As a first-time jobseeker, I am eager to begin my career and bring a strong willingness to learn to your team.",
      ],
    ],
    experience: [
      [
        "While I have not yet held a formal role, I developed {skills} through my studies, training, and hands-on coursework.",
        "While I have not yet held a formal role, I developed my skills through my studies, training, and hands-on coursework.",
      ],
      "I am a fast learner, highly adaptable, and ready to take on new responsibilities from day one.",
    ],
    skills: [
      "My key strengths include {key_skills}.",
      "I am especially confident in {proficiency}, and I am committed to growing these skills further in a professional setting.",
    ],
    whyCompany: [
      "I am drawn to {company} because of your reputation in {industry}, and starting my career with an organization that values {value} means a great deal to me.",
    ],
    closing: [
      "Thank you for considering my application. I would welcome the chance to discuss how my enthusiasm, dedication, and eagerness to learn can be an asset to {company}.",
    ],
  },
};

const SECTION_ORDER = ["intro", "experience", "skills", "whyCompany", "closing"];

// Values that always have a sensible plain-English fallback.
const DEFAULTS = { "{position}": "advertised", "{company}": "your company", "{industry}": "the industry", "{value}": "excellence" };

const known = (value) => value != null && String(value).trim() !== "";

const resolveLine = (line, replacements) => {
  for (const alternative of Array.isArray(line) ? line : [line]) {
    let complete = true;
    const text = alternative.replace(TOKEN, (token) => {
      if (!known(replacements[token])) {
        complete = false;
        return token;
      }
      return String(replacements[token]).trim();
    });
    if (complete) return text;
  }
  return "";
};

// The paragraphs of a letter body for one tone. `replacements` uses the "{token}" keys.
export const buildLetterParagraphs = (tone, replacements = {}) => {
  const lines = LETTER_TONE_LINES[tone];
  if (!lines) return [];
  const values = { ...DEFAULTS };
  Object.entries(replacements).forEach(([key, value]) => {
    if (known(value)) values[key] = value;
  });
  // The real company name only (no "your company" fallback), for lines that name the team.
  if (known(replacements["{company}"])) values["{company_name}"] = replacements["{company}"];
  return SECTION_ORDER.map((section) =>
    (lines[section] || [])
      .map((line) => resolveLine(line, values))
      .filter(Boolean)
      .join(" "),
  ).filter(Boolean);
};

// A bracketed leftover like "[your notable achievement]" in the letter text.
export const BRACKET_PLACEHOLDER = /\[[^\]\n]{1,120}\]/;
export const hasPlaceholder = (text) => BRACKET_PLACEHOLDER.test(String(text || ""));

// "Dear Maria Santos," when the employer gave a hiring contact, else "Dear Hiring Manager,".
export const salutationFor = (hiringManagerName) => {
  const name = String(hiringManagerName || "").replace(/\s+/g, " ").trim();
  return name ? `Dear ${name},` : "Dear Hiring Manager,";
};
