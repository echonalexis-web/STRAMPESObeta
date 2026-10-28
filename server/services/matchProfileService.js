// Single authoritative source for which User / JobseekerProfile fields the
// matching engine (server/services/semanticService.js) actually reads, and
// how to shape them into the `{ user, profile }` object it expects.
//
// Before this existed, three call sites — recommendationController
// (job board), jobController (job detail), employerRecommendationController
// (employer's ranked applicants) — each hand-picked their own .select()
// field list, and each one forgot a different subset. The same applicant
// could get a different credential score or education rank depending on
// which page asked. Every call site must build its seeker through
// buildSeekerForMatching() (or at minimum select these exact fields) so
// adding a dimension that needs a new profile field means editing this one
// file, not finding every place a seeker gets assembled.
//
// Deliberately scoped to the fields the engine's ten dimensions read today —
// including `presentAddress`, `preferredWorkLocationLocal`,
// `preferredJobTypes` and `preferredWorkNature`, added for the location/
// employment-type dimensions (markdowns/JOB_MATCHMAKING_IMPROVEMENT_PLAN.md
// §A.1). A dimension that needs a new profile field in the future gets it
// added here when it ships, not preemptively.

// Mongoose .select() string for the User side of a matching seeker.
// industryPreferenceLevel ('strict'|'flexible') feeds the industry dimension
// alongside profile.preferredIndustries — added for P0-02 (job board/detail
// scoring parity, markdowns/MATCHMAKING_DEPLOYMENT_CHECKLIST.md).
const SEEKER_USER_FIELDS =
  "skills educationalAttainment workExperience desiredJobTitle dateOfBirth industryPreferenceLevel";

// Mongoose .select() string for the JobseekerProfile side. Callers that
// query many profiles at once (e.g. `JobseekerProfile.find({ userId: { $in: ... } })`)
// should prepend 'userId' themselves to map results back to a user — it's
// left out here because a single-profile `findOne({ userId })` lookup never
// needs it echoed back.
const SEEKER_PROFILE_FIELDS =
  "skills expectedSalaryMin expectedSalaryMax preferredIndustries " +
  "preferredOccupations course yearGraduated workHistory " +
  "vocationalTrainings eligibilities professionalLicenses languageProficiency " +
  "presentAddress preferredWorkLocationLocal preferredJobTypes preferredWorkNature";

// Shapes a raw User doc + JobseekerProfile doc (lean or Mongoose document,
// either is fine — only plain field access is used) into the `{ user, profile }`
// object semanticService.js's scoring functions expect. Does NOT merge or
// dedupe skills across the two sides — getApplicantSkills() and
// getApplicantCredentials() in semanticService.js already do that; passing
// the raw per-source arrays through keeps this function a pure reshape.
function buildSeekerForMatching(user = {}, profile = {}) {
  const u = user || {};
  const p = profile || {};
  return {
    user: {
      skills: Array.isArray(u.skills) ? u.skills : [],
      educationalAttainment: u.educationalAttainment || null,
      workExperience: u.workExperience || null,
      desiredJobTitle: u.desiredJobTitle || null,
      dateOfBirth: u.dateOfBirth || null,
      industryPreferenceLevel: u.industryPreferenceLevel === 'strict' ? 'strict' : 'flexible',
    },
    profile: {
      skills: Array.isArray(p.skills) ? p.skills : [],
      expectedSalaryMin: Number.isFinite(p.expectedSalaryMin) ? p.expectedSalaryMin : null,
      expectedSalaryMax: Number.isFinite(p.expectedSalaryMax) ? p.expectedSalaryMax : null,
      preferredIndustries: Array.isArray(p.preferredIndustries) ? p.preferredIndustries : [],
      preferredOccupations: Array.isArray(p.preferredOccupations) ? p.preferredOccupations : [],
      course: p.course || null,
      yearGraduated: p.yearGraduated || null,
      workHistory: Array.isArray(p.workHistory) ? p.workHistory : [],
      vocationalTrainings: Array.isArray(p.vocationalTrainings) ? p.vocationalTrainings : [],
      eligibilities: Array.isArray(p.eligibilities) ? p.eligibilities : [],
      professionalLicenses: Array.isArray(p.professionalLicenses) ? p.professionalLicenses : [],
      languageProficiency: p.languageProficiency || null,
      presentAddress: p.presentAddress && typeof p.presentAddress === "object" ? p.presentAddress : null,
      preferredWorkLocationLocal: Array.isArray(p.preferredWorkLocationLocal) ? p.preferredWorkLocationLocal : [],
      preferredJobTypes: Array.isArray(p.preferredJobTypes) ? p.preferredJobTypes : [],
      preferredWorkNature: Array.isArray(p.preferredWorkNature) ? p.preferredWorkNature : [],
    },
  };
}

module.exports = { SEEKER_USER_FIELDS, SEEKER_PROFILE_FIELDS, buildSeekerForMatching };
