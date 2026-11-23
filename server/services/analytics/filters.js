// The one filter object behind every dashboard number, ranking and report.
// parseAnalyticsFilter turns a query string (or a stored report's parameters) into a
// validated, canonical object. Whitelists only: enum values, catalog values, a
// 24-character id. Nothing from the query string is ever used as a regex or an operator.

const crypto = require("crypto");
const { matchMunicipalityLabel } = require("./municipality");
const { AGE_BRACKETS } = require("./privacy");
const { parsePeriodQuery, formatManilaDate } = require("./period");
const { invalidFilter } = require("./errors");

const SECTIONS = Object.freeze(["jobs", "employers", "applicants"]);
const JOB_STATUSES = Object.freeze(["draft", "active", "closed", "archived"]);
const APPLICATION_STATUSES = Object.freeze(["pending", "under_review", "shortlisted", "approved", "rejected", "hired", "withdrawn"]);
const VERIFICATION_STATUSES = Object.freeze(["unverified", "pending", "under_review", "verified", "resubmission_required", "rejected"]);
const ACCOUNT_STATUSES = Object.freeze(["active", "suspended", "banned", "deactivated"]);
const DATASETS = Object.freeze(["regular", "spes"]);
const SCOPES = Object.freeze(["all", "public"]);
const DATE_FIELDS = Object.freeze(["applied", "registered"]);

// Which filters each section understands. A filter outside its section is dropped
// (never an error), so switching section keeps the shared ones and sheds the rest.
const SECTION_FIELDS = Object.freeze({
  jobs: ["municipality", "barangay", "industry", "jobType", "workNature", "employerId", "dataset", "jobStatus", "scope"],
  employers: ["municipality", "industry", "verification", "accountStatus", "scope"],
  applicants: ["municipality", "ageBracket", "accountStatus", "applicationStatus", "dateField", "dataset"],
});

const FREE_TEXT = /^[\p{L}\p{N} &,.\-/'()]{1,80}$/u;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

// A single string from a query value. Objects and arrays of objects are refused.
const scalar = (value, name) => {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value) && value.some((item) => typeof item !== "string")) throw invalidFilter(`${name} is not valid.`);
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") throw invalidFilter(`${name} is not valid.`);
  const text = raw.trim();
  return text === "" ? null : text;
};

const oneOf = (value, allowed, name) => {
  const text = scalar(value, name);
  if (text === null) return null;
  if (!allowed.includes(text)) throw invalidFilter(`${name} is not an allowed value.`);
  return text;
};

const fromCatalog = (value, name, catalogSet) => {
  const text = scalar(value, name);
  if (text === null) return null;
  if (catalogSet) {
    if (!catalogSet.has(text)) throw invalidFilter(`${name} is not in the catalog.`);
    return text;
  }
  if (!FREE_TEXT.test(text)) throw invalidFilter(`${name} is not valid.`);
  return text;
};

const verificationList = (value) => {
  const text = scalar(value, "verification");
  if (text === null) return null;
  const wanted = text.split(",").map((part) => part.trim());
  if (wanted.some((part) => !VERIFICATION_STATUSES.includes(part))) throw invalidFilter("verification is not an allowed value.");
  const list = VERIFICATION_STATUSES.filter((status) => wanted.includes(status));
  return list.length ? list : null;
};

// parseAnalyticsFilter(query, { section, now, catalog })
//   catalog (optional): { industries, jobTypes, workNatures } as Sets of allowed values.
// Returns { filter, period } where `filter` is canonical and serializable and `period`
// carries the instants (from, to, isPartial, asOf, previous) used by the queries.
const parseAnalyticsFilter = (query = {}, { section, now = new Date(), catalog = {} } = {}) => {
  if (!SECTIONS.includes(section)) throw invalidFilter("Unknown section.");
  const period = parsePeriodQuery(query, now);
  const allowed = new Set(SECTION_FIELDS[section]);

  const filter = { section };
  const take = (field, read) => {
    if (allowed.has(field)) {
      const value = read();
      if (value !== null) filter[field] = value;
    }
  };

  take("municipality", () => {
    const text = scalar(query.municipality, "municipality");
    if (text === null) return null;
    const label = matchMunicipalityLabel(text);
    if (!label) throw invalidFilter("municipality is not an allowed value.");
    return label;
  });
  take("barangay", () => {
    const text = scalar(query.barangay, "barangay");
    if (text === null) return null;
    if (!FREE_TEXT.test(text)) throw invalidFilter("barangay is not valid.");
    // A barangay only means something inside a municipality.
    return query.municipality ? text : null;
  });
  take("industry", () => fromCatalog(query.industry, "industry", catalog.industries));
  take("jobType", () => fromCatalog(query.jobType, "jobType", catalog.jobTypes));
  take("workNature", () => fromCatalog(query.workNature, "workNature", catalog.workNatures));
  take("employerId", () => {
    const text = scalar(query.employerId, "employerId");
    if (text === null) return null;
    if (!OBJECT_ID.test(text)) throw invalidFilter("employerId is not valid.");
    return text.toLowerCase();
  });
  take("dataset", () => oneOf(query.dataset, DATASETS, "dataset"));
  take("jobStatus", () => oneOf(query.jobStatus, JOB_STATUSES, "jobStatus"));
  take("verification", () => verificationList(query.verification));
  take("accountStatus", () => oneOf(query.accountStatus, ACCOUNT_STATUSES, "accountStatus"));
  take("ageBracket", () => oneOf(query.ageBracket, AGE_BRACKETS, "ageBracket"));
  take("applicationStatus", () => oneOf(query.applicationStatus, APPLICATION_STATUSES, "applicationStatus"));
  take("dateField", () => oneOf(query.dateField, DATE_FIELDS, "dateField"));
  take("scope", () => oneOf(query.scope, SCOPES, "scope"));

  // Staff statistics include postings hidden from the public unless asked otherwise.
  if (allowed.has("scope") && !filter.scope) filter.scope = "all";
  if (allowed.has("dataset") && !filter.dataset) filter.dataset = "regular";
  if (allowed.has("dateField") && !filter.dateField) filter.dateField = "applied";

  // SPES postings belong to the office, not to an employer.
  if (filter.dataset === "spes") {
    delete filter.employerId;
    delete filter.industry;
    delete filter.jobType;
    delete filter.workNature;
  }

  filter.period = periodSpec(period);
  return { filter, period };
};

// The period as stored and echoed: the choice that was made, not the instants.
const periodSpec = (period) => {
  const spec = { type: period.type };
  if (period.year) spec.year = period.year;
  if (period.quarter) spec.quarter = period.quarter;
  if (period.month) spec.month = period.month;
  if (period.type === "custom") {
    spec.from = formatManilaDate(period.from);
    spec.to = formatManilaDate(new Date(period.to.getTime() - 1));
  }
  return spec;
};

// Stable JSON (keys sorted) so the same filter always produces the same text and hash.
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const filterHash = (filter) => crypto.createHash("sha256").update(canonicalJson(filter)).digest("hex");

const LABELS = {
  municipality: "Municipality",
  barangay: "Barangay",
  industry: "Industry",
  jobType: "Job type",
  workNature: "Work nature",
  employerId: "Employer",
  dataset: "Dataset",
  jobStatus: "Job status",
  verification: "Verification",
  accountStatus: "Account status",
  ageBracket: "Age bracket",
  applicationStatus: "Application status",
  dateField: "Date used",
  scope: "Scope",
};

// Human-readable summary for report headers: [{ label, value }]. Never contains an id
// that is not already part of the filter itself.
const summarizeFilter = (filter, period) => {
  const rows = [];
  if (period) rows.push({ label: "Period", value: period.label });
  for (const field of Object.keys(LABELS)) {
    if (filter[field] === undefined) continue;
    const value = Array.isArray(filter[field]) ? filter[field].join(", ") : String(filter[field]);
    rows.push({ label: LABELS[field], value: field === "scope" ? (value === "all" ? "All postings (includes postings hidden from the public)" : "Public postings only") : value });
  }
  return rows;
};

module.exports = {
  SECTIONS,
  JOB_STATUSES,
  APPLICATION_STATUSES,
  VERIFICATION_STATUSES,
  ACCOUNT_STATUSES,
  DATASETS,
  SCOPES,
  SECTION_FIELDS,
  parseAnalyticsFilter,
  canonicalJson,
  filterHash,
  summarizeFilter,
};
