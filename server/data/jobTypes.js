// server/data/jobTypes.js
// Canonical employment-arrangement enum, shared by JobVacancy.jobType,
// JobseekerProfile.preferredJobTypes, and the job-posting validation
// middleware so the three copies that used to drift independently now come
// from one list.
//
// "Remote" is intentionally NOT in this list: it's expressed through
// JobVacancy.workNature / JobseekerProfile.preferredWorkNature instead, so a
// job can't end up with a self-contradictory jobType="Remote" + onsite
// workNature. "Work-from-home" (requested alongside Seasonal and On-the-job
// training) is covered the same way, via workNature, rather than added here.
//
// JobVacancy.jobType and the job-posting validator still need to accept the
// pre-existing "Remote" value on legacy postings — they append it themselves
// (`[...VALID_JOB_TYPES, "Remote"]`) rather than it living in this base list,
// since JobseekerProfile.preferredJobTypes (which also uses this list)
// deliberately has no Remote option — see semanticService.employmentTypeScore.
const VALID_JOB_TYPES = [
  "Contract",
  "Full-time",
  "Internship",
  "On-the-job training",
  "Part-time",
  "Seasonal",
  "Temporary",
];

module.exports = VALID_JOB_TYPES;
