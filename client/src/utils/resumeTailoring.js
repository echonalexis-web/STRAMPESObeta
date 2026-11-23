// Tailoring a resume to one job, using ONLY what the applicant already has: their own skills are
// put in a better order and the headline names the job. No skill, job or school is ever added.

const key = (value) => String(value || "").trim().toLowerCase();

// The applicant's skills with the ones the job asks for first (their own order kept inside each
// group). `matched` is the list of skill names the job's checklist says the applicant meets;
// a name that is not already one of the applicant's skills is ignored, so nothing is added.
export const reorderSkills = (skills, matched = []) => {
  const own = Array.isArray(skills) ? skills.filter((skill) => String(skill || "").trim()) : [];
  const wanted = new Set(matched.map(key));
  const first = own.filter((skill) => wanted.has(key(skill)));
  const rest = own.filter((skill) => !wanted.has(key(skill)));
  return { skills: [...first, ...rest], matched: first };
};

// The resume headline for a job: the job title, nothing else.
export const tailoredHeadline = (jobTitle, fallback = "") => String(jobTitle || "").trim() || fallback;

// A readable library name: "Cover letter - Service Crew - Acme Foods" (kept under the 120
// characters the library allows).
export const documentTitle = (label, jobTitle, companyName) =>
  [label, String(jobTitle || "").trim(), String(companyName || "").trim()].filter(Boolean).join(" - ").slice(0, 110);

// A file name that is safe on every system.
export const documentFileName = (title) =>
  `${String(title || "document").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "document"}.pdf`;
