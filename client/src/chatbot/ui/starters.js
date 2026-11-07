// Pure: starter question ids shown as chips for each role. Every id must exist
// in ALL_ENTRIES and be visible to that role (starters.test.js enforces it).
export const STARTERS = Object.freeze({
  public: Object.freeze(['public.login.how', 'public.register.jobseeker', 'public.jobs.see']),
  jobseeker: Object.freeze(['jobseeker.jobs.browse', 'jobseeker.resume.build', 'jobseeker.applications.track']),
  employer: Object.freeze(['employer.post.how', 'employer.applicants.review', 'employer.dashboard.open']),
});

export function startersFor(role) {
  return STARTERS[role] || STARTERS.public;
}
