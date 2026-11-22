/**
 * publicJobsService: the list and detail of jobs a signed-out visitor may see.
 *
 *  - "Available" is decided ONLY by utils/jobVisibility.js (buildPublicJobFilter): open,
 *    not archived, deadline respected, employer listed. There is no second rule here.
 *  - Every typed input is trimmed, length-limited and whitelisted; keyword text is
 *    regex-escaped; nothing from the query string reaches Mongo as an object.
 *  - Output is built field by field from an allow-list (toPublicJob), so a field that
 *    is not named here can never appear: no employer email or phone, applicant counts,
 *    match data, documents or notes.
 *  - Newest first by `createdAt` (the same field the logged-in Browse Jobs uses), with
 *    `_id` as the tie-breaker so pages never repeat or skip a job.
 */
const JobVacancy = require("../models/JobVacancy");
const User = require("../models/User");
const { buildPublicJobFilter } = require("../utils/jobVisibility");
const { escapeRegex } = require("../utils/sanitize");
const { getActiveValues } = require("./systemOptionService");

const LIMITS = Object.freeze({
  defaultPageSize: 9,
  maxPageSize: 24,
  // The most results a visitor can page through, however many jobs exist.
  maxWindow: 1000,
  queryMax: 100,
  locationMax: 100,
  industryMax: 80,
  industriesMax: 10,
  jobTypeMax: 60,
  salaryCeiling: 10_000_000,
});

const WORK_NATURES = ["remote", "onsite", "hybrid"];
const SORTS = ["newest", "salary"];

// Everything a visitor may see of a job. Anything not listed here is never returned.
const PUBLIC_SELECT =
  "title description responsibilities qualifications industry workNature jobType location salary salaryMin salaryMax slots createdAt applicationDeadline employer";

// A single trimmed, length-limited string from a query value (an array takes its first
// entry; objects and other types are ignored).
const text = (value, max) => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" && typeof raw !== "number") return "";
  // eslint-disable-next-line no-control-regex
  return String(raw).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
};

// A whole number of at least 1, or the fallback (empty, non-numeric, zero or negative).
const wholeNumber = (value, fallback) => {
  const raw = text(value, 12);
  const n = raw === "" ? NaN : Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? n : fallback;
};

const money = (value) => {
  const raw = text(value, 14);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= LIMITS.salaryCeiling ? n : null;
};

const listFrom = (value) => {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return items.map((item) => text(item, LIMITS.industryMax)).filter(Boolean).slice(0, LIMITS.industriesMax);
};

// Turns the raw query string into a safe query. `noMatch` is set when a filter names a
// value the catalog does not have: the list is then empty, never silently unfiltered.
// `error` is set only for a page beyond the allowed depth.
const parsePublicQuery = async (query = {}) => {
  const limit = Math.min(Math.max(wholeNumber(query.limit, LIMITS.defaultPageSize), 1), LIMITS.maxPageSize);
  const page = Math.max(wholeNumber(query.page, 1), 1);
  const maxPage = Math.max(1, Math.ceil(LIMITS.maxWindow / limit));
  if (page > maxPage) {
    return { error: { code: "PAGE_TOO_DEEP", message: "That page is out of range. Narrow your search instead." } };
  }

  const parsed = {
    q: text(query.q, LIMITS.queryMax),
    location: text(query.location, LIMITS.locationMax),
    jobType: "",
    workNature: "",
    industries: [],
    salaryMin: money(query.salaryMin),
    salaryMax: money(query.salaryMax),
    sortBy: SORTS.includes(text(query.sortBy, 12)) ? text(query.sortBy, 12) : "newest",
    page,
    limit,
    noMatch: false,
  };

  const jobType = text(query.jobType, LIMITS.jobTypeMax);
  if (jobType) {
    const known = await getActiveValues("jobType");
    if (known.size > 0 && !known.has(jobType)) parsed.noMatch = true;
    else parsed.jobType = jobType;
  }

  const workNature = text(query.workNature, 12);
  if (workNature) {
    if (WORK_NATURES.includes(workNature)) parsed.workNature = workNature;
    else parsed.noMatch = true;
  }

  const industries = listFrom(query.industry);
  if (industries.length > 0) {
    const known = await getActiveValues("industry");
    const valid = known.size > 0 ? industries.filter((name) => known.has(name)) : industries;
    if (valid.length === 0) parsed.noMatch = true;
    else parsed.industries = valid;
  }

  return parsed;
};

// The database filter: the one visibility rule, then the visitor's search on top.
const buildSearchFilter = async (parsed, now = new Date()) => {
  const base = await buildPublicJobFilter(now);
  const and = [base];

  if (parsed.location) and.push({ location: { $regex: escapeRegex(parsed.location), $options: "i" } });
  if (parsed.jobType) and.push({ jobType: parsed.jobType });
  if (parsed.workNature) and.push({ workNature: parsed.workNature });
  if (parsed.industries.length > 0) and.push({ industry: { $in: parsed.industries } });

  // A job's salary range overlaps the requested range (same rule as Browse Jobs).
  if (parsed.salaryMin !== null) and.push({ salaryMax: { $ne: null, $gte: parsed.salaryMin } });
  if (parsed.salaryMax !== null) and.push({ salaryMin: { $ne: null, $lte: parsed.salaryMax } });

  // Keyword: job title, company name, or a listed skill / qualification.
  if (parsed.q) {
    const pattern = { $regex: escapeRegex(parsed.q), $options: "i" };
    const companyIds = await User.find({ role: "employer", companyName: pattern }).distinct("_id");
    const keyword = [{ title: pattern }, { "qualifications.value": pattern }];
    if (companyIds.length > 0) keyword.push({ employer: { $in: companyIds } });
    and.push({ $or: keyword });
  }

  return { $and: and };
};

const sortFor = (sortBy) =>
  sortBy === "salary" ? { salaryMax: -1, createdAt: -1, _id: -1 } : { createdAt: -1, _id: -1 };

// Allow-list shape of one job. Built field by field, never by deleting from a document.
const toPublicJob = (job) => {
  const employer = job.employer && typeof job.employer === "object" ? job.employer : null;
  return {
    _id: job._id,
    title: job.title,
    description: job.description,
    responsibilities: job.responsibilities,
    qualifications: (Array.isArray(job.qualifications) ? job.qualifications : [])
      .filter((q) => q && q.value)
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((q) => ({ type: q.type, value: q.value, optional: q.optional === true })),
    industry: job.industry,
    workNature: job.workNature,
    jobType: job.jobType,
    location: job.location,
    salary: job.salary,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    slots: job.slots,
    createdAt: job.createdAt,
    applicationDeadline: job.applicationDeadline,
    // Company name and logo only. The account holder's own name is not a company field.
    employer: employer ? { companyName: employer.companyName || "", profileImage: employer.profileImage || null } : null,
  };
};

const withEmployer = (query) => query.populate("employer", "companyName profileImage");

const searchPublicJobs = async (parsed, now = new Date()) => {
  const emptyPage = { jobs: [], total: 0, pagination: { total: 0, page: parsed.page, pages: 1, limit: parsed.limit }, sortBy: parsed.sortBy };
  if (parsed.noMatch) return emptyPage;

  const filter = await buildSearchFilter(parsed, now);
  const [total, rows] = await Promise.all([
    JobVacancy.countDocuments(filter),
    withEmployer(JobVacancy.find(filter).select(PUBLIC_SELECT))
      .sort(sortFor(parsed.sortBy))
      .skip((parsed.page - 1) * parsed.limit)
      .limit(parsed.limit)
      .lean(),
  ]);
  return {
    jobs: rows.map(toPublicJob),
    total,
    pagination: { total, page: parsed.page, pages: Math.max(1, Math.ceil(total / parsed.limit)), limit: parsed.limit },
    sortBy: parsed.sortBy,
  };
};

// One job by id, only if it is publicly available; otherwise null (the caller answers
// exactly as for a job that does not exist).
const findPublicJob = async (id, now = new Date()) => {
  if (!/^[a-fA-F0-9]{24}$/.test(String(id || ""))) return null;
  const base = await buildPublicJobFilter(now);
  const job = await withEmployer(JobVacancy.findOne({ $and: [base, { _id: id }] }).select(PUBLIC_SELECT)).lean();
  return job ? toPublicJob(job) : null;
};

module.exports = { LIMITS, PUBLIC_SELECT, parsePublicQuery, buildSearchFilter, searchPublicJobs, findPublicJob, toPublicJob };
