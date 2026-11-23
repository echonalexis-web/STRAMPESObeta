// Derives real profile/job data into the {token} replacements coverLetterText.js expects.
// A token with no value is simply left out: its sentence is dropped, never filled with a
// bracketed placeholder.

import { buildSkillsList } from "./resumeDerivation.js";
import { experienceYearsText } from "./profileLabels.js";

const FRESH_GRADUATE = /fresh\s*graduate/i;

// The newest job's position, from the profile's work history ("" when there is none).
const latestPosition = (profile) => {
  const history = Array.isArray(profile?.workHistory) ? profile.workHistory : [];
  const position = history.find((job) => job?.position && String(job.position).trim())?.position;
  return position ? String(position).trim() : "";
};

// Profile-only replacements.
export const buildProfileCoverLetterReplacements = (user, profile) => {
  const skills = buildSkillsList(user, profile);
  const topSkills = skills.slice(0, 5).join(", ");
  // "Not applicable" (students) and "Fresh Graduate" are not a number of years.
  const yearsText = experienceYearsText(user?.workExperience);
  const years = yearsText && !FRESH_GRADUATE.test(yearsText) ? yearsText : "";
  const field = user?.desiredJobTitle || profile?.course || "";
  const industry = Array.isArray(profile?.preferredIndustries) ? profile.preferredIndustries[0] : "";
  const previousRole = latestPosition(profile);

  const replacements = {};
  if (topSkills) {
    replacements["{skills}"] = topSkills;
    replacements["{key_skills}"] = topSkills;
    // Only a real subset of the list; repeating the whole list as "proficiency" reads as a repeat.
    if (skills.length > 2) replacements["{proficiency}"] = skills.slice(0, 2).join(" and ");
  }
  if (years) replacements["{years}"] = years;
  if (field) replacements["{field}"] = field;
  if (industry) replacements["{industry}"] = industry;
  if (previousRole) replacements["{previous_role}"] = previousRole;
  return replacements;
};

// Job-aware replacements, built only from job.checklistMatch (computed server-side for the
// logged-in applicant), so only qualifications the job asks for AND the applicant meets appear.
// Nothing the applicant doesn't have is ever claimed on their behalf.
export const buildJobMatchedCoverLetterReplacements = (job) => {
  const checklist = job?.checklistMatch;
  const replacements = {};
  if (!checklist) return replacements;

  const metItems = Array.isArray(checklist.items) ? checklist.items.filter((item) => item?.met) : [];
  const metSkills = metItems.filter((item) => item.type === "skill").map((item) => item.value);
  const metCredentials = metItems
    .filter((item) => item.type === "certification" || item.type === "license")
    .map((item) => item.value);

  const combined = [...metSkills, ...metCredentials].filter(Boolean);
  if (combined.length) {
    const list = combined.slice(0, 6).join(", ");
    replacements["{skills}"] = list;
    replacements["{key_skills}"] = list;
    if (combined.length > 2) replacements["{proficiency}"] = combined.slice(0, 2).join(" and ");
  }

  if (checklist.basicEligibility?.experience?.met && checklist.basicEligibility.experience.label) {
    const label = String(checklist.basicEligibility.experience.label);
    if (!FRESH_GRADUATE.test(label)) replacements["{years}"] = label;
  }

  const field = Array.isArray(job?.industry) ? job.industry[0] : job?.industry;
  if (field) {
    replacements["{field}"] = field;
    replacements["{industry}"] = field;
  }

  return replacements;
};

// The skills the applicant lists that the job asks for (case-insensitive), for résumé tailoring.
export const matchedSkillNames = (job) => {
  const items = Array.isArray(job?.checklistMatch?.items) ? job.checklistMatch.items : [];
  return items.filter((item) => item?.met && item.type === "skill" && item.value).map((item) => String(item.value));
};
