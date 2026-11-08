const { getAgeFromDate, MIN_ACCOUNT_AGE, SPES_MIN_AGE, SPES_MAX_AGE, JOB_VACANCY_MIN_AGE } = require("./age");

// Jobseeker-type roles are the only ones subject to age rules. Employers,
// admins and superadmins never are (employers attest 18+ at registration).
const JOBSEEKER_ROLES = ["jobseeker", "employee", "resident"];

// Stable codes the client translates. English messages are fallbacks only and
// never contain the date of birth.
const AGE_DENIALS = {
  DOB_REQUIRED: {
    status: 403,
    message: "Add your date of birth to continue.",
  },
  AGE_UNDER_MINIMUM: {
    status: 403,
    message: `You must be at least ${MIN_ACCOUNT_AGE} years old to use STRAM PESO.`,
  },
  JOB_APPLY_AGE_RESTRICTED: {
    status: 403,
    message: `Applications to job vacancies open at ${JOB_VACANCY_MIN_AGE}. You can apply to SPES programs instead.`,
    legacyCode: "AGE_RESTRICTED",
  },
  SPES_AGE_BELOW_MIN: {
    status: 403,
    message: `SPES applicants must be at least ${SPES_MIN_AGE} years old.`,
  },
  SPES_AGE_ABOVE_MAX: {
    status: 403,
    message: `SPES applications are limited to applicants ${SPES_MAX_AGE} years old and below.`,
    legacyCode: "AGE_RESTRICTED",
  },
};

// Returns null when the action is allowed, otherwise the denial code.
//   jobView   - browse the job board / job details (15+)
//   spesView  - browse SPES postings (15+; 31 and older see them read-only)
//   jobApply  - apply to regular job vacancies (18+)
//   spesApply - apply to SPES (15-30)
// A missing date of birth fails closed (DOB_REQUIRED). An account flagged
// ageReviewRequired is treated as under the minimum age until an admin clears it.
const getAgeDenial = (user, action, now = new Date()) => {
  if (!user || !JOBSEEKER_ROLES.includes(user.role)) return null;
  if (user.ageReviewRequired === true) return "AGE_UNDER_MINIMUM";

  const age = getAgeFromDate(user.dateOfBirth, now);
  if (age === null) return "DOB_REQUIRED";
  if (age < MIN_ACCOUNT_AGE) return "AGE_UNDER_MINIMUM";

  if (action === "jobApply" && age < JOB_VACANCY_MIN_AGE) return "JOB_APPLY_AGE_RESTRICTED";
  if (action === "spesApply") {
    if (age < SPES_MIN_AGE) return "SPES_AGE_BELOW_MIN";
    if (age > SPES_MAX_AGE) return "SPES_AGE_ABOVE_MAX";
  }
  return null;
};

// Sends the 403 for a denial code.
const sendAgeDenial = (res, code) => {
  const { status, message, legacyCode } = AGE_DENIALS[code];
  return res.status(status).json({ code, message, ...(legacyCode ? { legacyCode } : {}) });
};

const requireAge = (action) => (req, res, next) => {
  const code = getAgeDenial(req.user, action);
  if (code) return sendAgeDenial(res, code);
  return next();
};

module.exports = { JOBSEEKER_ROLES, AGE_DENIALS, getAgeDenial, sendAgeDenial, requireAge };
