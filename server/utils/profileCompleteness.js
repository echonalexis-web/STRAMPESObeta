// Pure presence-ratio calculator for how filled-in a jobseeker's NSRP
// profile is — item 12 of the mock-defense revision document ("automatically
// calculate ... completion percentage of applicant profiles"). Takes the
// same {user, profile} shape authController.getProfile already fetches.
//
// Deliberately NOT read by the matching engine (server/services/
// semanticService.js) — this is a UI nudge for the applicant, not a scoring
// input.
const FIELDS = [
  // User-side
  { check: (user) => Boolean(user?.dateOfBirth) },
  { check: (user) => Boolean(user?.gender) },
  { check: (user) => Boolean(user?.phone) },
  { check: (user) => Boolean(user?.address) },
  { check: (user) => Boolean(user?.educationalAttainment) },
  { check: (user) => Boolean(user?.desiredJobTitle) },
  { check: (user) => Array.isArray(user?.skills) && user.skills.length > 0 },
  { check: (user) => Boolean(user?.resumeFile) },
  { check: (user) => Boolean(user?.validIdFile) },
  // JobseekerProfile-side
  { check: (_user, profile) => Boolean(profile?.civilStatus) },
  {
    check: (_user, profile) =>
      Boolean(profile?.presentAddress?.municipality) && Boolean(profile?.presentAddress?.province),
  },
  {
    check: (_user, profile) =>
      Number.isFinite(profile?.expectedSalaryMin) || Number.isFinite(profile?.expectedSalaryMax),
  },
  { check: (_user, profile) => Array.isArray(profile?.preferredIndustries) && profile.preferredIndustries.length > 0 },
  { check: (_user, profile) => Array.isArray(profile?.preferredJobTypes) && profile.preferredJobTypes.length > 0 },
  { check: (_user, profile) => Array.isArray(profile?.workHistory) && profile.workHistory.length > 0 },
  {
    // languageProficiency is a fixed-shape sub-document (English/Filipino/
    // Others, each {read,write,speak,understand}) that Mongoose populates
    // with default `false` flags even when the applicant never touched it —
    // checking for object keys alone would always read "filled". Check that
    // at least one flag is actually true instead.
    check: (_user, profile) => {
      const lp = profile?.languageProficiency;
      if (!lp || typeof lp !== "object") return false;
      return Object.values(lp).some(
        (entry) => entry && typeof entry === "object" && Object.values(entry).some(Boolean)
      );
    },
  },
];

function computeProfileCompleteness(user, profile) {
  const filled = FIELDS.reduce((count, field) => (field.check(user, profile) ? count + 1 : count), 0);
  const total = FIELDS.length;
  return { percent: Math.round((filled / total) * 100), filled, total };
}

module.exports = { computeProfileCompleteness };
