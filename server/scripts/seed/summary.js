// Plain-text summary of a generated plan. Pure: builds strings, prints nothing itself
// except through the `log` callback.

const countBy = (items, fn) => items.reduce((acc, item) => ((acc[fn(item)] = (acc[fn(item)] || 0) + 1), acc), {});
const jobKind = (job) => (job.archived ? "Archived" : job.status === "closed" ? "Closed" : job.status === "draft" ? "Draft" : "Open");

const summarize = (plan) => {
  const townLabel = (key) => key.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const towns = [...new Set([...plan.employers.map((e) => e.townKey), ...plan.jobseekers.map((j) => j.townKey)])];
  const rows = towns.map((key) => ({
    town: townLabel(key),
    employers: plan.employers.filter((e) => e.townKey === key).length,
    jobseekers: plan.jobseekers.filter((j) => j.townKey === key).length,
    basic: plan.jobseekers.filter((j) => j.townKey === key && !j.isProtected).length,
    protected: plan.jobseekers.filter((j) => j.townKey === key && j.isProtected).length,
  }));
  return {
    totals: {
      employers: plan.employers.length,
      jobs: plan.jobs.length,
      jobseekers: plan.jobseekers.length,
      applications: plan.applications.length,
    },
    towns: rows,
    jobsByStatus: countBy(plan.jobs, jobKind),
    applicationsByStatus: countBy(plan.applications, (a) => a.status),
    accountTypes: countBy(plan.jobseekers, (j) => (j.isProtected ? "protected" : "basic")),
  };
};

const formatSummary = (plan, { manifestPath, credentialsPath, sampleRows = 3 } = {}) => {
  const s = summarize(plan);
  const pad = (v, n) => String(v).padEnd(n);
  const lines = [];
  lines.push("", "Plan summary", "------------");
  lines.push(`Employers ${s.totals.employers} | Jobs ${s.totals.jobs} | Jobseekers ${s.totals.jobseekers} | Applications ${s.totals.applications}`);
  lines.push("", `${pad("Town", 12)}${pad("Employers", 11)}${pad("Jobseekers", 12)}${pad("Basic", 7)}Protected`);
  for (const r of s.towns) lines.push(`${pad(r.town, 12)}${pad(r.employers, 11)}${pad(r.jobseekers, 12)}${pad(r.basic, 7)}${r.protected}`);
  lines.push("", `Jobs by status:         ${Object.entries(s.jobsByStatus).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  lines.push(`Applications by status: ${Object.entries(s.applicationsByStatus).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  lines.push(`Jobseeker accounts:     ${Object.entries(s.accountTypes).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  lines.push("", "Sample employers:");
  for (const e of plan.employers.slice(0, sampleRows)) lines.push(`  ${e.user.companyName} | ${e.townKey} | ${e.user.industry} | ${e.user.email}`);
  lines.push("Sample jobs:");
  for (const j of plan.jobs.slice(0, sampleRows)) lines.push(`  ${j.title} | ${jobKind(j)} | ${j.salary || "no salary"} | slots ${j.slots}`);
  lines.push("Sample jobseekers:");
  for (const j of plan.jobseekers.slice(0, sampleRows)) lines.push(`  ${j.user.username} | ${j.townKey} | ${j.isProtected ? "protected" : "basic"} | ${j.user.educationalAttainment}`);
  if (manifestPath) lines.push("", `Manifest:    ${manifestPath}`);
  if (credentialsPath) lines.push(`Credentials: ${credentialsPath}`);
  return lines.join("\n");
};

module.exports = { summarize, formatSummary, jobKind };
