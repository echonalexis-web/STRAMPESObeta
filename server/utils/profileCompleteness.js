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
  { section: "personal", check: (user) => Boolean(user?.dateOfBirth) },
  { section: "personal", check: (user) => Boolean(user?.gender) },
  { section: "contact", check: (user) => Boolean(user?.phone) },
  { section: "contact", check: (user) => Boolean(user?.address) },
  { section: "education", check: (user) => Boolean(user?.educationalAttainment) },
  { section: "education", check: (user) => Boolean(user?.desiredJobTitle) },
  { section: "skills", check: (user) => Array.isArray(user?.skills) && user.skills.length > 0 },
  { section: "documents", check: (user) => Boolean(user?.resumeFile) },
  { section: "documents", check: (user) => Boolean(user?.validIdFile) },
  // JobseekerProfile-side
  { section: "personal", check: (_user, profile) => Boolean(profile?.civilStatus) },
  {
    section: "preferences",
    check: (_user, profile) =>
      Boolean(profile?.presentAddress?.municipality) && Boolean(profile?.presentAddress?.province),
  },
  {
    section: "education",
    check: (_user, profile) =>
      Number.isFinite(profile?.expectedSalaryMin) || Number.isFinite(profile?.expectedSalaryMax),
  },
  { section: "contact", check: (_user, profile) => Array.isArray(profile?.preferredIndustries) && profile.preferredIndustries.length > 0 },
  { section: "preferences", check: (_user, profile) => Array.isArray(profile?.preferredJobTypes) && profile.preferredJobTypes.length > 0 },
  { section: "preferences", check: (_user, profile) => Array.isArray(profile?.workHistory) && profile.workHistory.length > 0 },
  {
    section: "languages",
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

// Sections that still have at least one empty item (names only, never values),
// for the superadmin "Account insights". Same checks as the percentage above.
function listMissingSections(user, profile) {
  const missing = [];
  for (const field of FIELDS) {
    if (!field.check(user, profile) && !missing.includes(field.section)) missing.push(field.section);
  }
  return missing;
}

module.exports = { computeProfileCompleteness, listMissingSections };
