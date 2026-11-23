// Catalog values the dashboard filters may use (industries and job types come from the
// admin-maintained SystemOption catalog; work natures are a fixed enum). Retired
// (inactive) values stay selectable because old postings still carry them.

const SystemOption = require("../../models/SystemOption");
const VALID_JOB_TYPES = require("../../data/jobTypes");
const { MUNICIPALITY_LABELS } = require("./municipality");
const { AGE_BRACKETS } = require("./privacy");
const { currentManilaYear } = require("./period");

const WORK_NATURES = Object.freeze(["remote", "onsite", "hybrid"]);
const FIRST_YEAR = 2000;

const loadCatalog = async () => {
  const rows = await SystemOption.find({ category: { $in: ["industry", "jobType"] } })
    .sort({ order: 1, value: 1 })
    .select("category value")
    .lean();
  const industries = rows.filter((row) => row.category === "industry").map((row) => row.value);
  const jobTypeValues = rows.filter((row) => row.category === "jobType").map((row) => row.value);
  const jobTypes = [...new Set([...(Array.isArray(VALID_JOB_TYPES) ? VALID_JOB_TYPES : []), ...jobTypeValues])];
  return {
    industries: new Set(industries),
    jobTypes: new Set(jobTypes),
    workNatures: new Set(WORK_NATURES),
    lists: { industries, jobTypes, workNatures: [...WORK_NATURES] },
  };
};

// GET /admin/analytics/filter-options
const getFilterOptions = async (now = new Date()) => {
  const { lists } = await loadCatalog();
  const thisYear = currentManilaYear(now);
  const years = [];
  for (let year = thisYear; year >= Math.max(FIRST_YEAR, thisYear - 9); year -= 1) years.push(year);
  return {
    municipalities: MUNICIPALITY_LABELS,
    industries: lists.industries,
    jobTypes: lists.jobTypes,
    workNatures: lists.workNatures,
    years,
    ageBrackets: AGE_BRACKETS,
  };
};

module.exports = { WORK_NATURES, loadCatalog, getFilterOptions };
