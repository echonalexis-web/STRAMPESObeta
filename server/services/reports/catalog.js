// What the report generator can produce: datasets, their allow-listed columns, groupings,
// who may generate them, and which need a stated purpose. This is an ALLOW-LIST: a column
// that is not here can never be requested, and none of the fields below ever carries contact
// details, dates of birth, addresses below municipality, ids, tokens, document URLs, IPs or
// user agents. The client only displays this catalog; the server enforces it.

const { EXPORT_ROW_CAPS } = require("../analytics/config");

const col = (key, label, isDefault = false) => ({ key, label, default: isDefault });

const DATASETS = Object.freeze({
  jobs: {
    id: "jobs",
    label: "Jobs",
    section: "jobs",
    roles: ["admin", "superadmin"],
    needsPurpose: false,
    municipality: true,
    needsData: true,
    kind: "rows",
    columns: [
      col("title", "Title", true),
      col("employer", "Employer", true),
      col("municipality", "Municipality", true),
      col("industry", "Industry", true),
      col("jobType", "Job type", true),
      col("workNature", "Work nature", true),
      col("slots", "Slots", true),
      col("status", "Status", true),
      col("postedAt", "Posted date", true),
      col("closedAt", "Closed date"),
      col("closeReason", "Close reason"),
      col("applicants", "Applicants"),
      col("hires", "Hires"),
    ],
    groupings: ["none", "month", "municipality", "employer", "status"],
    groupDate: "postedAt",
  },
  employers: {
    id: "employers",
    label: "Employers",
    section: "employers",
    roles: ["admin", "superadmin"],
    needsPurpose: false,
    municipality: true,
    needsData: true,
    kind: "rows",
    columns: [
      col("company", "Company", true),
      col("verificationStatus", "Verification status", true),
      col("accountStatus", "Account status", true),
      col("municipality", "Municipality", true),
      col("industry", "Industry", true),
      col("workforceSize", "Workforce size", true),
      col("registeredAt", "Registered date", true),
      col("verifiedAt", "Verified date"),
      col("postings", "Postings"),
      col("hires", "Hires"),
    ],
    groupings: ["none", "month", "municipality", "verificationStatus"],
    groupDate: "registeredAt",
  },
  applications: {
    id: "applications",
    label: "Applications",
    section: "jobs",
    roles: ["admin", "superadmin"],
    needsPurpose: true,
    municipality: true,
    needsData: true,
    kind: "rows",
    columns: [
      col("ref", "Application ref", true),
      col("jobTitle", "Job title", true),
      col("employer", "Employer", true),
      col("appliedAt", "Applied date", true),
      col("status", "Status", true),
      col("statusAt", "Status date", true),
    ],
    groupings: ["none", "month", "status", "municipality", "employer"],
    groupDate: "appliedAt",
  },
  hires: {
    id: "hires",
    label: "Hires and placements (unnamed)",
    section: "jobs",
    roles: ["admin", "superadmin"],
    needsPurpose: true,
    municipality: true,
    needsData: true,
    kind: "rows",
    columns: [
      col("hiredAt", "Hire date", true),
      col("jobTitle", "Job title", true),
      col("employer", "Employer", true),
      col("municipality", "Municipality", true),
      col("ageBracket", "Applicant age bracket", true),
    ],
    groupings: ["none", "month", "municipality", "employer", "ageBracket"],
    groupDate: "hiredAt",
  },
  jobseekers: {
    id: "jobseekers",
    label: "Jobseekers (counts only)",
    section: "applicants",
    roles: ["admin", "superadmin"],
    needsPurpose: true,
    municipality: true,
    needsData: true,
    kind: "aggregate",
    columns: [col("group", "Group", true), col("count", "Count", true)],
    groupings: ["ageBracket", "municipality", "month"],
    defaultGrouping: "ageBracket",
  },
  spes: {
    id: "spes",
    label: "SPES (counts only)",
    section: "applicants",
    roles: ["admin", "superadmin"],
    needsPurpose: true,
    municipality: false,
    needsData: true,
    kind: "aggregate",
    columns: [col("metric", "Metric", true), col("label", "Label", true), col("count", "Count", true)],
    groupings: [],
  },
  employer_ranking: {
    id: "employer_ranking",
    label: "Employer performance ranking",
    section: "jobs",
    roles: ["admin", "superadmin"],
    needsPurpose: false,
    municipality: false,
    needsData: true,
    kind: "aggregate",
    columns: [
      col("rank", "Rank", true),
      col("employer", "Employer", true),
      col("postings", "Postings", true),
      col("applicants", "Applicants", true),
      col("hires", "Hires", true),
      col("hireRate", "Hire rate (%)", true),
      col("fillRate", "Fill rate (%)", true),
      col("medianDaysToHire", "Median days to hire", true),
      col("responseRate", "Response rate (%)"),
    ],
    groupings: [],
  },
  verification_activity: {
    id: "verification_activity",
    label: "Verification activity",
    section: "employers",
    roles: ["admin", "superadmin"],
    needsPurpose: false,
    kind: "aggregate",
    columns: [
      col("month", "Month", true),
      col("submitted", "Submitted", true),
      col("reviewed", "Reviewed", true),
      col("verified", "Verified", true),
      col("rejected", "Rejected", true),
      col("avgTurnaroundDays", "Average days to review", true),
    ],
    groupings: [],
  },
  audit_summary: {
    id: "audit_summary",
    label: "Audit summary (counts only)",
    section: "jobs",
    roles: ["superadmin"],
    needsPurpose: true,
    kind: "aggregate",
    columns: [col("month", "Month", true), col("category", "Category", true), col("severity", "Severity", true), col("count", "Count", true)],
    groupings: [],
  },
});

const FORMATS = Object.freeze(["csv", "xlsx", "pdf"]);

// Datasets that expose identity-adjacent rows: their audit entry is a warning, not info.
const SENSITIVE_DATASETS = Object.freeze(["applications", "hires", "jobseekers", "spes", "audit_summary"]);

const PURPOSE_MIN = 10;
const PURPOSE_MAX = 200;

const rowCapFor = (format) => EXPORT_ROW_CAPS[format] || EXPORT_ROW_CAPS.csv;

// The catalog as one role sees it (GET /admin/report-exports/catalog).
const catalogForRole = (role) => ({
  datasets: Object.values(DATASETS)
    .filter((dataset) => dataset.roles.includes(role))
    .map((dataset) => ({
      id: dataset.id,
      label: dataset.label,
      section: dataset.section,
      columns: dataset.columns,
      groupings: dataset.groupings,
      defaultGrouping: dataset.defaultGrouping || (dataset.groupings.includes("none") ? "none" : dataset.groupings[0] || "none"),
      needsPurpose: dataset.needsPurpose,
      municipality: Boolean(dataset.municipality),
      maxRows: { csv: rowCapFor("csv"), xlsx: rowCapFor("xlsx"), pdf: rowCapFor("pdf") },
    })),
  formats: FORMATS,
  purpose: { min: PURPOSE_MIN, max: PURPOSE_MAX },
});

module.exports = { DATASETS, FORMATS, SENSITIVE_DATASETS, PURPOSE_MIN, PURPOSE_MAX, rowCapFor, catalogForRole };
