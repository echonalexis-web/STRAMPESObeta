// Derives real profile/job data into the {placeholder} replacements
// coverLetterTemplates.js's applyTemplate() expects, so a generated letter
// reads "Customer Service, Stress Management" instead of the generic
// "[list your key skills]" bracket text every template falls back to.

import { buildSkillsList } from "./resumeDerivation";

// Profile-only replacements — used by the standalone Resume & Cover Letter
// Studio, which has no specific job posting to target.
export const buildProfileCoverLetterReplacements = (user, profile) => {
  const skills = buildSkillsList(user, profile);
  const topSkills = skills.slice(0, 5).join(", ");
  const years = user?.workExperience || "";
  const field = user?.desiredJobTitle || profile?.course || "";
  const industry = Array.isArray(profile?.preferredIndustries) ? profile.preferredIndustries[0] : "";

  const replacements = {};
  if (topSkills) {
    replacements["{skills}"] = topSkills;
    replacements["{key_skills}"] = topSkills;
    replacements["{proficiency}"] = skills.slice(0, 2).join(" and ") || topSkills;
  }
  if (years) replacements["{years}"] = years;
  if (field) replacements["{field}"] = field;
  if (industry) replacements["{industry}"] = industry;
  return replacements;
};

// Job-aware replacements — built only from job.checklistMatch (computed
// server-side for the logged-in applicant), so only qualifications the job
// actually asks for AND the applicant actually meets ever appear here.
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
    replacements["{proficiency}"] = combined.slice(0, 2).join(" and ");
  }

  if (checklist.basicEligibility?.experience?.met && checklist.basicEligibility.experience.label) {
    replacements["{years}"] = checklist.basicEligibility.experience.label;
  }

  const field = Array.isArray(job?.industry) ? job.industry[0] : job?.industry;
  if (field) {
    replacements["{field}"] = field;
    replacements["{industry}"] = field;
  }

  return replacements;
};
