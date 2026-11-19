// The ONE definition of "a job a jobseeker may see". The job board filters in memory
// with isJobVisibleToJobseekers; list endpoints that must paginate in the database
// use buildVisibleJobFilter, which expresses the same rules as a query. Keep the two
// in step: server/tests/employerProfileView.test.js checks that they agree.

// A job past its deadline is hidden.
const isJobPastDeadline = (job, now = new Date()) => {
  if (!job.applicationDeadline) return false;
  return now > new Date(job.applicationDeadline);
};

// Not closed, not past its deadline, not archived.
const isJobVisibleToJobseekers = (job, now = new Date()) => {
  if (job.status === "closed") return false;
  if (isJobPastDeadline(job, now)) return false;
  if (job.archived) return false;
  return true;
};

// Database filter for one employer's postings a jobseeker may see. It is the board's
// rules plus status "active" (a draft is never public; applying already requires it).
// The employer account itself (active, not suspended) is checked by the caller.
const buildVisibleJobFilter = (employerId, now = new Date()) => ({
  employer: employerId,
  isActive: true,
  status: "active",
  archived: { $ne: true },
  $or: [{ applicationDeadline: null }, { applicationDeadline: { $gt: now } }],
});

// ---------------------------------------------------------------------------
// Employer account gate: postings of a suspended, banned or deactivated employer
// are unlisted everywhere public. Derived at query time from the employer's
// CURRENT account status; jobs are never mutated, so reactivating the account
// brings every posting back exactly as it was (a job closed before stays closed).
//
// Source of truth is User.isActive (the runtime gate) plus User.accountStatus
// (the reason). The temporary failed-login lockout (User.loginLock) is a
// separate mechanism and does NOT unlist anything.
//
// Chosen approach: a per-request lookup of the (small) set of locked employer ids,
// applied as one `employer: { $nin }` clause. No per-job lookup, no denormalized
// flag to keep in sync, so there is nothing to repair.
// ---------------------------------------------------------------------------
const UNLISTED_ACCOUNT_STATUSES = ["suspended", "banned", "deactivated"];

const unlistedEmployerQuery = () => ({
  role: "employer",
  $or: [{ isActive: false }, { accountStatus: { $in: UNLISTED_ACCOUNT_STATUSES } }],
});

// Ids of every employer whose postings are currently unlisted.
const getUnlistedEmployerIds = async () => {
  const User = require("../models/User");
  return User.find(unlistedEmployerQuery()).distinct("_id");
};

// Adds the employer gate to a JobVacancy filter (keeps any existing employer clause).
const withListedEmployers = async (filter = {}, unlistedIds = null) => {
  const ids = unlistedIds || (await getUnlistedEmployerIds());
  if (!ids.length) return filter;
  if (filter.employer === undefined) return { ...filter, employer: { $nin: ids } };
  return { $and: [filter, { employer: { $nin: ids } }] };
};

// For an employer document (or populated ref) already in hand.
const isEmployerUnlisted = (employer) => {
  if (!employer || typeof employer !== "object") return false;
  if (employer.isActive === false) return true;
  return UNLISTED_ACCOUNT_STATUSES.includes(employer.accountStatus);
};

module.exports = {
  isJobPastDeadline,
  isJobVisibleToJobseekers,
  buildVisibleJobFilter,
  UNLISTED_ACCOUNT_STATUSES,
  getUnlistedEmployerIds,
  withListedEmployers,
  isEmployerUnlisted,
};
