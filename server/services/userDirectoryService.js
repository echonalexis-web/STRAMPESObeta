// Numbers the superadmin User Management page needs next to the directory:
// tab and filter-chip counts, and a few per-row figures for the page of rows
// on screen. Everything here is aggregated, never one query per row.
const User = require("../models/User");
const JobApplication = require("../models/JobApplication");
const JobVacancy = require("../models/JobVacancy");
const JobseekerProfile = require("../models/JobseekerProfile");
const { buildDirectoryQuery } = require("../utils/userDirectoryQuery");
const { computeProfileCompleteness } = require("../utils/profileCompleteness");

// Which chips exist on which tab. The count of a chip is what clicking that chip
// alone would list: this tab only, deleted accounts excluded, and the search box
// and the other filters ignored. The same builder as the list, so they agree.
// Lockout applies to jobseekers only, and employers always have an email, so
// those two chips do not exist for employers.
const CHIPS = {
  employer: { pendingReview: { verificationStatus: "pending,under_review" }, idle90: { idle90: "true" } },
  jobseeker: { noEmail: { noEmail: "true" }, idle90: { idle90: "true" }, lockedNow: { lockedNow: "true" } },
};

const getDirectoryCounts = async ({ now = Date.now() } = {}) => {
  const entries = [];
  for (const [role, chips] of Object.entries(CHIPS)) {
    entries.push([role, "total", {}]);
    for (const [name, query] of Object.entries(chips)) entries.push([role, name, query]);
  }
  const counts = await Promise.all(
    entries.map(([role, , query]) =>
      User.countDocuments(buildDirectoryQuery({ role, ...query }, { isSuperadmin: true, now }).filter)
    )
  );
  const result = { employers: {}, jobseekers: {} };
  entries.forEach(([role, name], index) => {
    result[role === "employer" ? "employers" : "jobseekers"][name] = counts[index];
  });
  // Staff accounts are not a directory tab; this only feeds the "pending staff
  // activations" notice on the User Management page.
  result.staff = {
    pendingActivation: await User.countDocuments({
      role: "admin",
      accountStatus: "pending_activation",
      deletedAt: null,
    }),
  };
  return result;
};

const COMPLETENESS_USER_FIELDS =
  "dateOfBirth gender phone address educationalAttainment desiredJobTitle skills resumeFile validIdFile";
const COMPLETENESS_PROFILE_FIELDS =
  "userId civilStatus presentAddress expectedSalaryMin expectedSalaryMax preferredIndustries preferredJobTypes workHistory languageProficiency";

// users: plain objects from the directory page. Returns Map(id -> details):
//   jobseeker { applications, profilePercent }
//   employer  { postings, hires }
// Raw profile fields are used only to compute the percentage and are not returned.
const getRowDetails = async (users) => {
  const jobseekerIds = users.filter((u) => u.role === "jobseeker").map((u) => u._id);
  const employerIds = users.filter((u) => u.role === "employer").map((u) => u._id);
  const details = new Map();

  const [applicationRows, completenessUsers, profiles, vacancyRows] = await Promise.all([
    jobseekerIds.length
      ? JobApplication.aggregate([{ $match: { applicant: { $in: jobseekerIds } } }, { $group: { _id: "$applicant", count: { $sum: 1 } } }])
      : [],
    jobseekerIds.length ? User.find({ _id: { $in: jobseekerIds } }).select(COMPLETENESS_USER_FIELDS).lean() : [],
    jobseekerIds.length ? JobseekerProfile.find({ userId: { $in: jobseekerIds } }).select(COMPLETENESS_PROFILE_FIELDS).lean() : [],
    employerIds.length
      ? JobVacancy.aggregate([{ $match: { employer: { $in: employerIds } } }, { $group: { _id: "$employer", ids: { $push: "$_id" } } }])
      : [],
  ]);

  const applications = new Map(applicationRows.map((row) => [String(row._id), row.count]));
  const userById = new Map(completenessUsers.map((u) => [String(u._id), u]));
  const profileById = new Map(profiles.map((p) => [String(p.userId), p]));
  for (const id of jobseekerIds) {
    const key = String(id);
    const { percent } = computeProfileCompleteness(userById.get(key) || {}, profileById.get(key) || {});
    details.set(key, { applications: applications.get(key) || 0, profilePercent: percent });
  }

  const allVacancyIds = vacancyRows.flatMap((row) => row.ids);
  const hireRows = allVacancyIds.length
    ? await JobApplication.aggregate([
        { $match: { vacancy: { $in: allVacancyIds }, status: "hired" } },
        { $group: { _id: "$vacancy", hires: { $sum: 1 } } },
      ])
    : [];
  const hiresByVacancy = new Map(hireRows.map((row) => [String(row._id), row.hires]));
  const vacanciesByEmployer = new Map(vacancyRows.map((row) => [String(row._id), row.ids]));
  for (const id of employerIds) {
    const ids = vacanciesByEmployer.get(String(id)) || [];
    details.set(String(id), {
      postings: ids.length,
      hires: ids.reduce((sum, vacancyId) => sum + (hiresByVacancy.get(String(vacancyId)) || 0), 0),
    });
  }
  return details;
};

module.exports = { getDirectoryCounts, getRowDetails, CHIPS };
