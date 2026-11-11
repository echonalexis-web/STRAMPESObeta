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

module.exports = { isJobPastDeadline, isJobVisibleToJobseekers, buildVisibleJobFilter };
