// client/src/constants/jobTypes.js
// Canonical employment-arrangement list, shared by JobPostingForm.jsx (post
// a job), JobSearchFilters.jsx (filter the job board), and EditProfile.jsx
// (preferred job types) so the enum only has to change in one place.
// Mirrors server/data/jobTypes.js — keep both in sync.
//
// "Remote" is intentionally not in this list — it's expressed through
// workNature instead (see jobTypes.js on the server for why) — except for
// JobPostingForm.jsx and JobSearchFilters.jsx, which still need to post/filter
// pre-existing "Remote" jobType vacancies; they append it themselves via
// JOB_TYPES_FOR_VACANCY below rather than it living in the base list.
export const JOB_TYPES = [
  "Contract",
  "Full-time",
  "Internship",
  "On-the-job training",
  "Part-time",
  "Seasonal",
  "Temporary",
];

export const JOB_TYPES_FOR_VACANCY = [...JOB_TYPES, "Remote"].sort((a, b) => a.localeCompare(b));

// Display-only relabeling — the submitted/stored value stays exactly the
// enum string above, only the chip text changes.
export const JOB_TYPE_LABELS = { Contract: "Contractual" };
