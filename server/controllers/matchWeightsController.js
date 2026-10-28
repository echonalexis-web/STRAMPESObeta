// §C.1 — configurable job-matching weights. See
// markdowns/MATCH_WEIGHTS_BACKEND_HANDOFF.md for the full contract this
// implements (the client UI was built against that document).
const MatchWeightProfile = require("../models/MatchWeightProfile");
const MatchWeightBounds = require("../models/MatchWeightBounds");
const JobVacancy = require("../models/JobVacancy");
const matchWeightsService = require("../services/matchWeightsService");
const { validateWeights, validateBounds, CODE_FALLBACK_WEIGHTS } = require("../utils/matchWeights");
const { logAuditEvent } = require("../services/auditService");
const logger = require("../utils/logger");

const getUserId = (req) => req.user.id || req.user._id;

// Upserts a MatchWeightProfile at a given {owner, vacancy} key. `owner`/
// `vacancy` are each either an id or null — never `undefined`, so the
// unique index always sees the same two "slots" regardless of which kind
// of profile this is (platform default / employer default / per-vacancy).
async function upsertProfile({ owner, vacancy, weights, updatedBy }) {
  return MatchWeightProfile.findOneAndUpdate(
    { owner: owner || null, vacancy: vacancy || null },
    { weights, updatedBy, owner: owner || null, vacancy: vacancy || null },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

// ============================================================
// Employer default profile — GET/PUT/DELETE /api/employers/match-weights
// ============================================================
exports.getEmployerMatchWeights = async (req, res) => {
  try {
    const employerId = getUserId(req);
    const [resolved, bounds] = await Promise.all([
      matchWeightsService.resolveEmployerWeights(employerId),
      matchWeightsService.getBounds(),
    ]);
    res.json({ weights: resolved.weights, isCustom: resolved.isCustom, bounds });
  } catch (error) {
    logger.error("Get employer match weights error:", error.message);
    res.status(500).json({ message: "Failed to load matching preferences." });
  }
};

exports.updateEmployerMatchWeights = async (req, res) => {
  try {
    const employerId = getUserId(req);
    const bounds = await matchWeightsService.getBounds();
    const check = validateWeights(req.body?.weights, bounds);
    if (!check.valid) return res.status(400).json({ message: check.message });

    const before = await matchWeightsService.getEmployerDefaultProfile(employerId);
    await upsertProfile({ owner: employerId, vacancy: null, weights: req.body.weights, updatedBy: employerId });

    await logAuditEvent({
      req,
      actorId: employerId,
      actorRole: "employer",
      action: "employer.match_weights.updated",
      targetType: "user",
      targetId: String(employerId),
      severity: "info",
      metadata: { before: before?.weights || null, after: req.body.weights },
    });

    res.json({ weights: req.body.weights, isCustom: true });
  } catch (error) {
    logger.error("Update employer match weights error:", error.message);
    res.status(500).json({ message: "Failed to save matching preferences." });
  }
};

exports.resetEmployerMatchWeights = async (req, res) => {
  try {
    const employerId = getUserId(req);
    const before = await matchWeightsService.getEmployerDefaultProfile(employerId);
    if (before) await MatchWeightProfile.deleteOne({ owner: employerId, vacancy: null });

    await logAuditEvent({
      req,
      actorId: employerId,
      actorRole: "employer",
      action: "employer.match_weights.reset",
      targetType: "user",
      targetId: String(employerId),
      severity: "info",
      metadata: { before: before?.weights || null },
    });

    const resolved = await matchWeightsService.resolveEmployerWeights(employerId);
    res.json({ weights: resolved.weights, isCustom: resolved.isCustom });
  } catch (error) {
    logger.error("Reset employer match weights error:", error.message);
    res.status(500).json({ message: "Failed to reset matching preferences." });
  }
};

// ============================================================
// Per-vacancy override — GET/PUT/DELETE /api/jobs/:id/match-weights
// ============================================================
// Loads the job and verifies the caller owns it. Returns the job doc on
// success, or null after already sending a 404/403 response.
async function loadOwnedJob(req, res) {
  const job = await JobVacancy.findById(req.params.id).select("employer").lean();
  if (!job) {
    res.status(404).json({ message: "Job not found" });
    return null;
  }
  const employerId = String(job.employer?._id || job.employer || "");
  if (employerId !== String(getUserId(req))) {
    res.status(403).json({ message: "You can only manage matching weights for your own jobs." });
    return null;
  }
  return job;
}

exports.getJobMatchWeights = async (req, res) => {
  try {
    const job = await loadOwnedJob(req, res);
    if (!job) return;
    const [resolved, bounds] = await Promise.all([
      matchWeightsService.resolveJobWeightsForEditing(job),
      matchWeightsService.getBounds(),
    ]);
    res.json({ ...resolved, bounds });
  } catch (error) {
    logger.error("Get job match weights error:", error.message);
    res.status(500).json({ message: "Failed to load this job's matching weights." });
  }
};

exports.updateJobMatchWeights = async (req, res) => {
  try {
    const job = await loadOwnedJob(req, res);
    if (!job) return;
    const bounds = await matchWeightsService.getBounds();
    const check = validateWeights(req.body?.weights, bounds);
    if (!check.valid) return res.status(400).json({ message: check.message });

    const employerId = getUserId(req);
    const before = await matchWeightsService.getVacancyOverrideProfile(job._id);
    await upsertProfile({ owner: employerId, vacancy: job._id, weights: req.body.weights, updatedBy: employerId });

    await logAuditEvent({
      req,
      actorId: employerId,
      actorRole: "employer",
      action: "employer.job_match_weights.updated",
      targetType: "job",
      targetId: String(job._id),
      severity: "info",
      metadata: { before: before?.weights || null, after: req.body.weights },
    });

    res.json({ weights: req.body.weights, isCustom: true });
  } catch (error) {
    logger.error("Update job match weights error:", error.message);
    res.status(500).json({ message: "Failed to save this job's matching weights." });
  }
};

exports.resetJobMatchWeights = async (req, res) => {
  try {
    const job = await loadOwnedJob(req, res);
    if (!job) return;
    const employerId = getUserId(req);
    const before = await matchWeightsService.getVacancyOverrideProfile(job._id);
    if (before) await MatchWeightProfile.deleteOne({ vacancy: job._id });

    await logAuditEvent({
      req,
      actorId: employerId,
      actorRole: "employer",
      action: "employer.job_match_weights.reset",
      targetType: "job",
      targetId: String(job._id),
      severity: "info",
      metadata: { before: before?.weights || null },
    });

    res.json({ ok: true });
  } catch (error) {
    logger.error("Reset job match weights error:", error.message);
    res.status(500).json({ message: "Failed to remove this job's custom weights." });
  }
};

// ============================================================
// Platform default profile — GET/PUT /api/admin/match-weight-defaults
// (admin or superadmin — gated by the router's isAdmin, no extra check here)
// ============================================================
exports.getMatchWeightDefaults = async (req, res) => {
  try {
    const [profile, bounds] = await Promise.all([
      matchWeightsService.getPlatformDefaultProfile(),
      matchWeightsService.getBounds(),
    ]);
    res.json({ weights: profile ? profile.weights : { ...CODE_FALLBACK_WEIGHTS }, bounds });
  } catch (error) {
    logger.error("Get platform match weight defaults error:", error.message);
    res.status(500).json({ message: "Failed to load the platform default weights." });
  }
};

exports.updateMatchWeightDefaults = async (req, res) => {
  try {
    const bounds = await matchWeightsService.getBounds();
    const check = validateWeights(req.body?.weights, bounds);
    if (!check.valid) return res.status(400).json({ message: check.message });

    const actorId = getUserId(req);
    const before = await matchWeightsService.getPlatformDefaultProfile();
    await upsertProfile({ owner: null, vacancy: null, weights: req.body.weights, updatedBy: actorId });

    await logAuditEvent({
      req,
      actorId,
      actorRole: req.user.role,
      action: "admin.match_weight_defaults.updated",
      targetType: "system",
      targetId: "platform-match-weights",
      severity: "warning",
      metadata: { before: before?.weights || null, after: req.body.weights },
    });

    res.json({ weights: req.body.weights });
  } catch (error) {
    logger.error("Update platform match weight defaults error:", error.message);
    res.status(500).json({ message: "Failed to save the platform default weights." });
  }
};

// ============================================================
// Per-criterion bounds — GET/PUT /api/admin/match-weight-bounds
// (superadmin only — enforced by the route, re-asserted here per §8's
// "enforced server-side regardless of what the client sends")
// ============================================================
exports.getMatchWeightBounds = async (req, res) => {
  try {
    const bounds = await matchWeightsService.getBounds();
    res.json({ bounds });
  } catch (error) {
    logger.error("Get match weight bounds error:", error.message);
    res.status(500).json({ message: "Failed to load matching weight bounds." });
  }
};

exports.updateMatchWeightBounds = async (req, res) => {
  try {
    if (req.user.role !== "superadmin") {
      return res.status(403).json({ message: "Superadmin access required" });
    }
    const check = validateBounds(req.body?.bounds);
    if (!check.valid) return res.status(400).json({ message: check.message });

    const before = await matchWeightsService.getBounds();
    const actorId = getUserId(req);
    await MatchWeightBounds.findOneAndUpdate(
      { singletonKey: "global" },
      { bounds: req.body.bounds, updatedBy: actorId },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    await logAuditEvent({
      req,
      actorId,
      actorRole: "superadmin",
      action: "superadmin.match_weight_bounds.updated",
      targetType: "system",
      targetId: "match-weight-bounds",
      severity: "warning",
      metadata: { before, after: req.body.bounds },
    });

    res.json({ bounds: req.body.bounds });
  } catch (error) {
    logger.error("Update match weight bounds error:", error.message);
    res.status(500).json({ message: "Failed to save matching weight bounds." });
  }
};
