// Profile viewing for every signed-in role (COVER_PHOTO_PLAN.md sections 15 to 17).
// Controllers never pick fields: they load the documents, resolve the
// relationship, and ask services/profileProjection.js what this viewer may see.
// Every "can't show you this" case (missing, malformed id, suspended, deleted,
// hidden, minor, not allowed) gets the SAME answer, so nothing is revealed.

const mongoose = require("mongoose");
const User = require("../models/User");
const JobseekerProfile = require("../models/JobseekerProfile");
const EmployerProfile = require("../models/EmployerProfile");
const { resolveCover } = require("../services/bannerTemplateService");
const { resolveAvatarPreset } = require("../services/avatarPresetService");
const { normalizeRole, projectJobseeker, projectEmployer, projectEmployerPosting, resolveRelationship, allowedContact, municipalityOf } = require("../services/profileProjection");
const { sendError } = require("../utils/sendError");
const { getAgeDenial, sendAgeDenial } = require("../utils/ageAccess");
const { buildVisibleJobFilter, isEmployerUnlisted, withListedEmployers } = require("../utils/jobVisibility");

const POSTINGS_DEFAULT_LIMIT = 10;
const POSTINGS_MAX_LIMIT = 50;

const unavailable = (res) => {
  res.set("Cache-Control", "no-store");
  return res.status(404).json({ code: "PROFILE_UNAVAILABLE", message: "This profile is unavailable." });
};

const placeOf = (address) => {
  if (!address || typeof address !== "object") return null;
  const parts = [address.municipality, address.province].filter((p) => p && String(p).trim());
  return parts.length ? parts.join(", ") : null;
};

// Loads the target and returns { viewer, target, profile, role } or null when the
// viewer may not know the account exists.
const load = async (req) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return null;
  const viewer = { id: String(req.user._id || req.user.id), role: req.user.role };
  const target = await User.findById(id);
  if (!target) return null;
  const role = normalizeRole(target.role);
  if (role !== "jobseeker" && role !== "employer") return null; // staff accounts have no public profile
  const profile = role === "jobseeker" ? await JobseekerProfile.findOne({ userId: target._id }) : await EmployerProfile.findOne({ userId: target._id });
  return { viewer, target, profile, role };
};

// Runs the projection for the loaded target. Returns { mode, user, profile } or null.
const project = async ({ viewer, target, profile, role }) => {
  const cover = await resolveCover(target.cover);
  if (role === "employer") {
    return projectEmployer({ viewer, target, profile, cover });
  }
  const relationship = await resolveRelationship({ viewer, target });
  const projected = projectJobseeker({ viewer, target, profile, relationship, cover });
  if (projected) projected.relationship = relationship;
  return projected;
};

const setViewHeaders = (res) => {
  // Private: the content depends on who is asking.
  res.set("Cache-Control", "private, max-age=60");
  res.set("Vary", "Authorization");
};

// GET /profiles/:id/summary  (hover card)
exports.getSummary = async (req, res) => {
  try {
    const ctx = await load(req);
    if (!ctx) return unavailable(res);
    const projected = await project(ctx);
    if (!projected) return unavailable(res);

    const { user } = projected;
    const avatarPreset = user.profileImage !== undefined ? await resolveAvatarPreset(ctx.target.avatar) : null;
    const isOwner = String(ctx.target._id) === ctx.viewer.id;
    const employer = ctx.role === "employer";
    const summary = {
      id: String(ctx.target._id),
      role: ctx.role,
      name: user.name,
      ...(user.profileImage ? { avatar: user.profileImage } : {}),
      // A chosen preset avatar is shown wherever the projection allows the person's photo.
      ...(avatarPreset ? { avatarPreset } : {}),
      ...(user.cover ? { cover: user.cover } : {}),
      ...(employer
        ? { headline: user.industry || undefined, location: placeOf(ctx.profile?.businessAddress) || undefined, verified: Boolean(user.verified) }
        : {
            headline: user.desiredJobTitle || undefined,
            location: municipalityOf(ctx.profile && typeof ctx.profile.toObject === "function" ? ctx.profile.toObject() : ctx.profile) || undefined,
          }),
      ownerLink: isOwner,
    };
    // Drop undefined keys so absent really means absent.
    Object.keys(summary).forEach((k) => summary[k] === undefined && delete summary[k]);
    setViewHeaders(res);
    return res.json(summary);
  } catch (error) {
    return sendError(res, error, "Failed to load the profile");
  }
};

// GET /profiles/:id  (full profile for this viewer)
exports.getProfile = async (req, res) => {
  try {
    const ctx = await load(req);
    if (!ctx) return unavailable(res);
    const projected = await project(ctx);
    if (!projected) return unavailable(res);

    const body = { mode: projected.mode, role: ctx.role, user: projected.user, profile: projected.profile || {} };
    // A chosen preset avatar is part of the picture, shown wherever the projection allows the person's photo.
    if (ctx.role === "jobseeker" && body.user && body.user.profileImage !== undefined) {
      const avatarPreset = await resolveAvatarPreset(ctx.target.avatar);
      if (avatarPreset) body.user.avatarPreset = avatarPreset;
    }
    if (ctx.role === "jobseeker" && projected.mode === "hiring") {
      // Lets the page say "contact is shown after the jobseeker applies" without sending numbers.
      const contact = allowedContact(projected.relationship);
      body.contactShared = contact.phone || contact.email;
    }
    setViewHeaders(res);
    return res.json(body);
  } catch (error) {
    return sendError(res, error, "Failed to load the profile");
  }
};

const positiveInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// GET /profiles/:id/jobs  (an employer's open postings, for a jobseeker viewer)
// Same visibility as the job board (utils/jobVisibility.js), newest first, paginated
// with a capped page size, and only the fields the job card shows.
exports.getEmployerJobs = async (req, res) => {
  try {
    // Only jobseekers browse postings here; everyone else gets the neutral answer.
    if (normalizeRole(req.user?.role) !== "jobseeker") return unavailable(res);
    const ageDenial = getAgeDenial(req.user, "jobView");
    if (ageDenial) return sendAgeDenial(res, ageDenial);

    const ctx = await load(req);
    if (!ctx || ctx.role !== "employer") return unavailable(res);
    const projected = await project(ctx);
    if (!projected || projected.mode !== "jobseeker") return unavailable(res);

    const JobVacancy = require("../models/JobVacancy");
    const JobApplication = require("../models/JobApplication");
    const { getHiredCountMap } = require("../utils/jobDisplay");

    const limit = Math.min(positiveInt(req.query.limit, POSTINGS_DEFAULT_LIMIT), POSTINGS_MAX_LIMIT);
    const page = positiveInt(req.query.page, 1);

    // A suspended or deactivated employer lists nothing (same empty answer as no postings).
    if (isEmployerUnlisted(ctx.target)) return res.json({ items: [], total: 0, page, limit });
    const filter = await withListedEmployers(buildVisibleJobFilter(ctx.target._id));
    // The board hides jobs the viewer was already hired for; so does this list.
    const hired = await JobApplication.find({ applicant: ctx.viewer.id, status: { $in: ["hired", "Accepted"] } }).select("vacancy");
    const hiredIds = (hired || []).map((a) => a.vacancy);
    if (hiredIds.length) filter._id = { $nin: hiredIds };

    const total = await JobVacancy.countDocuments(filter);
    const jobs = total
      ? await JobVacancy.find(filter)
          .select("title location salary jobType createdAt applicationDeadline slots")
          .sort({ createdAt: -1, _id: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean()
      : [];
    const hiredCounts = jobs.length ? await getHiredCountMap(jobs.map((j) => j._id)) : {};
    const employer = { _id: ctx.target._id, name: ctx.target.name, companyName: ctx.target.companyName, profileImage: ctx.target.profileImage };
    const items = jobs.map((job) =>
      projectEmployerPosting({ ...job, remainingSlots: Math.max(0, Number(job.slots || 0) - Number(hiredCounts[String(job._id)] || 0)) }, employer)
    );
    setViewHeaders(res);
    return res.json({ items, total, page, limit });
  } catch (error) {
    return sendError(res, error, "Failed to load the job postings");
  }
};
