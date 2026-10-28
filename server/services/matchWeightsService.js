// §C.1 — resolution logic for the configurable job-matching weights
// feature. Single source of truth for the fallback chain:
//   per-vacancy override → employer default → platform default → code fallback
// Used by both the employer-facing settings endpoints (matchWeightsController.js)
// and the scoring controllers (recommendationController, employerRecommendationController)
// so the chain is never duplicated.
const MatchWeightProfile = require("../models/MatchWeightProfile");
const MatchWeightBounds = require("../models/MatchWeightBounds");
const { CODE_FALLBACK_WEIGHTS } = require("../utils/matchWeights");

async function getBounds() {
  const doc = await MatchWeightBounds.getSingleton();
  return doc.bounds;
}

function getPlatformDefaultProfile() {
  return MatchWeightProfile.findOne({ owner: null, vacancy: null }).lean();
}

function getEmployerDefaultProfile(employerId) {
  if (!employerId) return null;
  return MatchWeightProfile.findOne({ owner: employerId, vacancy: null }).lean();
}

function getVacancyOverrideProfile(vacancyId) {
  if (!vacancyId) return null;
  return MatchWeightProfile.findOne({ vacancy: vacancyId }).lean();
}

// Resolves one employer's effective default weights for SCORING or display:
// their own saved profile, else the platform default, else the code
// fallback. Always returns a complete WeightsMap — never null.
async function resolveEmployerWeights(employerId) {
  const own = await getEmployerDefaultProfile(employerId);
  if (own) return { weights: own.weights, isCustom: true };
  const platform = await getPlatformDefaultProfile();
  if (platform) return { weights: platform.weights, isCustom: false };
  return { weights: { ...CODE_FALLBACK_WEIGHTS }, isCustom: false };
}

// Resolves one job's effective weights for SCORING — always a complete
// WeightsMap. Used by the employer-ranking path (one job, many applicants),
// so a single resolution per request is cheap enough to do directly (3
// queries at most); the job-board path uses buildWeightsByJobId() below
// instead, which batches this same chain across many jobs.
async function resolveJobWeightsForScoring(job) {
  const vacancyId = job?._id || job?.id;
  const employerId = job?.employer?._id || job?.employer;
  const [override, employerResolved] = await Promise.all([
    getVacancyOverrideProfile(vacancyId),
    resolveEmployerWeights(employerId),
  ]);
  return override ? override.weights : employerResolved.weights;
}

// Resolves one job's override state for the EDITING UI
// (GET /jobs/:id/match-weights) — distinguishes "no override saved"
// (weights: null, isCustom: false) from "override saved", and separately
// reports the employer's resolved default so the UI can pre-fill the
// editor with something sensible when there's no override yet.
async function resolveJobWeightsForEditing(job) {
  const vacancyId = job?._id || job?.id;
  const employerId = job?.employer?._id || job?.employer;
  const [override, employerResolved] = await Promise.all([
    getVacancyOverrideProfile(vacancyId),
    resolveEmployerWeights(employerId),
  ]);
  return {
    weights: override ? override.weights : null,
    isCustom: Boolean(override),
    employerDefault: employerResolved.weights,
  };
}

// Batch resolution for the job board (one seeker, many jobs, possibly many
// employers) — exactly 3 queries total regardless of how many jobs are
// being ranked, never one query per job. Returns a plain object keyed by
// job id (string) → WeightsMap.
async function buildWeightsByJobId(jobs) {
  const weightsByJobId = {};
  if (!Array.isArray(jobs) || !jobs.length) return weightsByJobId;

  const jobIds = jobs.map((j) => j._id || j.id).filter(Boolean);
  const employerIds = [...new Set(
    jobs.map((j) => String(j.employer?._id || j.employer || "")).filter(Boolean)
  )];

  const [overrides, employerDefaults, platformDefault] = await Promise.all([
    jobIds.length ? MatchWeightProfile.find({ vacancy: { $in: jobIds } }).lean() : [],
    employerIds.length ? MatchWeightProfile.find({ owner: { $in: employerIds }, vacancy: null }).lean() : [],
    getPlatformDefaultProfile(),
  ]);

  const overrideByVacancy = new Map(overrides.map((doc) => [String(doc.vacancy), doc.weights]));
  const defaultByEmployer = new Map(employerDefaults.map((doc) => [String(doc.owner), doc.weights]));
  const platformWeights = platformDefault ? platformDefault.weights : null;

  jobs.forEach((job) => {
    const jobId = String(job._id || job.id || "");
    if (!jobId) return;
    const employerId = String(job.employer?._id || job.employer || "");
    weightsByJobId[jobId] =
      overrideByVacancy.get(jobId) ||
      defaultByEmployer.get(employerId) ||
      platformWeights ||
      { ...CODE_FALLBACK_WEIGHTS };
  });

  return weightsByJobId;
}

module.exports = {
  getBounds,
  getPlatformDefaultProfile,
  getEmployerDefaultProfile,
  getVacancyOverrideProfile,
  resolveEmployerWeights,
  resolveJobWeightsForScoring,
  resolveJobWeightsForEditing,
  buildWeightsByJobId,
};
