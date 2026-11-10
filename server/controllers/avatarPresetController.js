const mongoose = require("mongoose");
const AvatarPreset = require("../models/AvatarPreset");
const User = require("../models/User");
const { logAuditEvent } = require("../services/auditService");
const { listActivePresets, resolveAvatarPreset, invalidateCache } = require("../services/avatarPresetService");
const { publicImage } = require("../services/bannerTemplateService");
const { processTemplateImage, TemplateImageError, PROFILES } = require("../services/bannerTemplateImageService");
const { parseManifest, installBuiltIns, summarize } = require("../services/builtInTemplateService");
const { normalizeRole } = require("../services/profileProjection");
const storageService = require("../services/storageService");
const { sendError } = require("../utils/sendError");
const logger = require("../utils/logger");

const fail = (res, status, code, message, extra) => res.status(status).json({ code, message, ...(extra || {}) });

const MESSAGES = {
  AVATAR_IMAGE_REQUIRED: "Choose an SVG or PNG image to upload.",
  AVATAR_IMAGE_TYPE: "The avatar must be an SVG or PNG image.",
  AVATAR_IMAGE_TOO_LARGE: "The image is too large.",
  AVATAR_IMAGE_DIMENSIONS: "The image size is not allowed. Use a square image of about 512 by 512 pixels.",
  AVATAR_IMAGE_RATIO: "The avatar must be square (about 1 to 1).",
  AVATAR_IMAGE_UNSAFE: "The SVG contains content that is not allowed (scripts, external links or embedded HTML).",
  AVATAR_IMAGE_PROCESSING_FAILED: "We could not read that image. Try another file.",
  AVATAR_UPLOAD_FAILED: "We could not store the image. Please try again.",
  AVATAR_BUILTIN_PROTECTED: "Built-in avatars cannot be deleted. Archive it instead.",
  AVATAR_BUILTIN_IMAGE_LOCKED: "The image of a built-in avatar cannot be replaced.",
  AVATAR_MANIFEST_INVALID: "The built-in install request is not valid.",
};

const removeStored = async (...values) => {
  await Promise.allSettled(values.filter(Boolean).map((value) => storageService.remove(value)));
};

const slugify = (text) =>
  String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

const audit = (req, action, preset, metadata) =>
  logAuditEvent({
    req,
    actorId: req.user.id,
    actorRole: req.user.role,
    action: `superadmin.avatar_preset.${action}`,
    targetType: "avatar_preset",
    targetId: String(preset._id),
    severity: "info",
    metadata: { presetId: String(preset._id), slug: preset.slug, ...(metadata || {}) },
  });

const usageCounts = async (ids) => {
  if (!ids.length) return new Map();
  const rows = await User.aggregate([
    { $match: { "avatar.presetId": { $in: ids } } },
    { $group: { _id: "$avatar.presetId", n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
};

const adminShape = (p, usage) => ({
  id: String(p._id),
  slug: p.slug,
  name: p.name,
  nameFil: p.nameFil || "",
  image: publicImage(p.image),
  isBuiltIn: Boolean(p.isBuiltIn),
  builtInKey: p.builtInKey || null,
  sortOrder: p.sortOrder,
  isActive: p.isActive,
  archivedAt: p.archivedAt || null,
  usage: usage || 0,
});

// ---------------------------------------------------------------- jobseeker side

// GET /avatar-presets (any signed-in user): active presets only.
exports.listForUsers = async (req, res) => {
  try {
    res.set("Cache-Control", "private, max-age=60");
    return res.json({ presets: await listActivePresets() });
  } catch (error) {
    return sendError(res, error, "Failed to load avatars");
  }
};

// PUT /auth/profile/avatar/preset  body { presetId } or { presetId: null }
// A jobseeker picks one of the preset avatars for their OWN account. The body may hold
// nothing but `presetId`; any image, url or other key is refused. Their uploaded photo
// (profileImage) is not touched: a chosen preset is shown instead of it, and clearing
// the choice shows the photo (or initials) again.
exports.chooseOwnPreset = async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : null;
    if (!body || !Object.prototype.hasOwnProperty.call(body, "presetId") || Object.keys(body).some((k) => k !== "presetId")) {
      return fail(res, 400, "AVATAR_ONLY_PRESET_ALLOWED", "Send only a presetId.");
    }
    const { presetId } = body;
    if (presetId !== null && typeof presetId !== "string") {
      return fail(res, 400, "AVATAR_ONLY_PRESET_ALLOWED", "presetId must be a string or null.");
    }

    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId).select("role avatar");
    if (!user) return fail(res, 404, "NOT_FOUND", "User not found.");
    if (normalizeRole(user.role) !== "jobseeker") return fail(res, 403, "AVATAR_NOT_ALLOWED", "This account type cannot choose a preset avatar.");

    let update;
    if (presetId === null) {
      update = { $unset: { avatar: 1 } };
    } else {
      if (!mongoose.isValidObjectId(presetId)) return fail(res, 404, "AVATAR_PRESET_NOT_FOUND", "That avatar could not be found.");
      const preset = await AvatarPreset.findById(presetId).select("isActive archivedAt").lean();
      if (!preset) return fail(res, 404, "AVATAR_PRESET_NOT_FOUND", "That avatar could not be found.");
      if (!preset.isActive || preset.archivedAt) return fail(res, 409, "AVATAR_PRESET_INACTIVE", "That avatar is no longer available.");
      update = { $set: { "avatar.presetId": preset._id, "avatar.updatedAt": new Date() } };
    }
    const updated = await User.findByIdAndUpdate(userId, update, { new: true }).select("avatar");
    return res.json({ avatarPreset: await resolveAvatarPreset(updated?.avatar) });
  } catch (error) {
    return sendError(res, error, "Failed to save the avatar");
  }
};

// ---------------------------------------------------------------- superadmin side

// GET /superadmin/avatar-presets
exports.listForSuperadmin = async (req, res) => {
  try {
    const rows = await AvatarPreset.find({}).sort({ sortOrder: 1, name: 1 }).lean();
    const usage = await usageCounts(rows.map((r) => r._id));
    return res.json({ presets: rows.map((r) => adminShape(r, usage.get(String(r._id)))) });
  } catch (error) {
    return sendError(res, error, "Failed to load avatars");
  }
};

const readBody = (body) => {
  const name = String(body.name || "").trim();
  const nameFil = String(body.nameFil || "").trim();
  let isActive;
  if (body.isActive === true || body.isActive === "true") isActive = true;
  else if (body.isActive === false || body.isActive === "false") isActive = false;
  return { name, nameFil, isActive };
};
const validNames = ({ name, nameFil }) => name.length >= 1 && name.length <= 60 && nameFil.length <= 60;

const processAndStore = async (req, res) => {
  if (!req.file || !req.file.buffer) {
    fail(res, 400, "AVATAR_IMAGE_REQUIRED", MESSAGES.AVATAR_IMAGE_REQUIRED);
    return null;
  }
  let processed;
  try {
    processed = await processTemplateImage(req.file, PROFILES.avatar);
  } catch (error) {
    if (error instanceof TemplateImageError) {
      fail(res, error.status, error.code, MESSAGES[error.code] || error.message);
      return null;
    }
    throw error;
  }
  const stored = [];
  try {
    const large = await storageService.upload({ buffer: processed.large.buffer, mimetype: "image/webp" }, { category: "avatarPreset" });
    stored.push(large.storedValue);
    const small = await storageService.upload({ buffer: processed.small.buffer, mimetype: "image/webp" }, { category: "avatarPreset" });
    stored.push(small.storedValue);
    return {
      stored,
      image: {
        url: large.storedValue,
        thumbUrl: small.storedValue,
        storedValue: large.storedValue,
        thumbStoredValue: small.storedValue,
        width: processed.large.width,
        height: processed.large.height,
        bytes: processed.large.bytes + processed.small.bytes,
        placeholderColor: processed.placeholderColor || undefined,
        luminance: processed.luminance,
      },
    };
  } catch (error) {
    await removeStored(...stored);
    logger.error("Avatar preset upload failed", { error: error.message });
    fail(res, 502, "AVATAR_UPLOAD_FAILED", MESSAGES.AVATAR_UPLOAD_FAILED);
    return null;
  }
};

// POST /superadmin/avatar-presets  (multipart: image, name, nameFil, isActive)
exports.create = async (req, res) => {
  let stored = [];
  try {
    const body = readBody(req.body || {});
    if (!validNames(body)) return fail(res, 400, "TEMPLATE_DEFINITION_INVALID", "A name of 1 to 60 characters is required.");
    const slug = slugify(body.name);
    if (!slug) return fail(res, 400, "TEMPLATE_DEFINITION_INVALID", "The name must contain letters or numbers.");
    if (await AvatarPreset.exists({ slug })) return fail(res, 409, "TEMPLATE_NAME_TAKEN", "An avatar with this name already exists.");

    const result = await processAndStore(req, res);
    if (!result) return undefined;
    stored = result.stored;

    const last = await AvatarPreset.findOne({}).sort({ sortOrder: -1 }).select("sortOrder").lean();
    const created = await AvatarPreset.create({
      slug,
      name: body.name,
      nameFil: body.nameFil,
      image: result.image,
      isActive: body.isActive !== false,
      archivedAt: body.isActive === false ? new Date() : null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
      createdBy: req.user.id,
      updatedBy: req.user.id,
    });
    stored = [];
    invalidateCache();
    await audit(req, "created", created);
    return res.status(201).json(adminShape(created.toObject(), 0));
  } catch (error) {
    await removeStored(...stored);
    if (error && error.code === 11000) return fail(res, 409, "TEMPLATE_NAME_TAKEN", "An avatar with this name already exists.");
    return sendError(res, error, "Failed to create the avatar");
  }
};

// PUT /superadmin/avatar-presets/:id  (multipart: name, nameFil, isActive, optional image)
exports.update = async (req, res) => {
  let stored = [];
  try {
    const preset = await AvatarPreset.findById(req.params.id);
    if (!preset) return fail(res, 404, "AVATAR_PRESET_NOT_FOUND", "Avatar not found.");
    const body = readBody(req.body || {});
    if (!validNames(body)) return fail(res, 400, "TEMPLATE_DEFINITION_INVALID", "A name of 1 to 60 characters is required.");
    if (req.file && preset.isBuiltIn) return fail(res, 409, "AVATAR_BUILTIN_IMAGE_LOCKED", MESSAGES.AVATAR_BUILTIN_IMAGE_LOCKED);

    let replaced = null;
    if (req.file) {
      const result = await processAndStore(req, res);
      if (!result) return undefined;
      stored = result.stored;
      replaced = { storedValue: preset.image?.storedValue, thumbStoredValue: preset.image?.thumbStoredValue };
      preset.image = result.image;
    }
    preset.name = body.name;
    preset.nameFil = body.nameFil;
    if (typeof body.isActive === "boolean" && body.isActive !== preset.isActive) {
      preset.isActive = body.isActive;
      preset.archivedAt = body.isActive ? null : new Date();
    }
    preset.updatedBy = req.user.id;
    await preset.save();
    stored = [];
    if (replaced) await removeStored(replaced.storedValue, replaced.thumbStoredValue);
    invalidateCache();
    await audit(req, replaced ? "image_replaced" : "updated", preset);
    const usage = await usageCounts([preset._id]);
    return res.json(adminShape(preset.toObject(), usage.get(String(preset._id))));
  } catch (error) {
    await removeStored(...stored);
    return sendError(res, error, "Failed to update the avatar");
  }
};

// PATCH /superadmin/avatar-presets/:id/active  body { isActive }
exports.setActive = async (req, res) => {
  try {
    if (typeof req.body?.isActive !== "boolean") return fail(res, 400, "TEMPLATE_DEFINITION_INVALID", "isActive must be true or false.");
    const preset = await AvatarPreset.findById(req.params.id);
    if (!preset) return fail(res, 404, "AVATAR_PRESET_NOT_FOUND", "Avatar not found.");
    preset.isActive = req.body.isActive;
    preset.archivedAt = req.body.isActive ? null : new Date();
    preset.updatedBy = req.user.id;
    await preset.save();
    invalidateCache();
    const usage = await usageCounts([preset._id]);
    await audit(req, req.body.isActive ? "activated" : "archived", preset, { usage: usage.get(String(preset._id)) || 0 });
    return res.json(adminShape(preset.toObject(), usage.get(String(preset._id))));
  } catch (error) {
    return sendError(res, error, "Failed to update the avatar");
  }
};

// PUT /superadmin/avatar-presets/order  body { ids: [...] } (every preset exactly once)
exports.reorder = async (req, res) => {
  try {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.some((id) => !mongoose.isValidObjectId(id)) || new Set(ids.map(String)).size !== ids.length) {
      return fail(res, 400, "TEMPLATE_ORDER_INVALID", "ids must list each avatar once.");
    }
    const existing = await AvatarPreset.find({}).select("_id").lean();
    if (existing.length !== ids.length || !existing.every((e) => ids.map(String).includes(String(e._id)))) {
      return fail(res, 400, "TEMPLATE_ORDER_INVALID", "ids must list every avatar.");
    }
    await AvatarPreset.bulkWrite(ids.map((id, index) => ({ updateOne: { filter: { _id: id }, update: { $set: { sortOrder: index } } } })));
    invalidateCache();
    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: req.user.role,
      action: "superadmin.avatar_preset.reordered",
      targetType: "avatar_preset",
      targetId: "order",
      severity: "info",
      metadata: { count: ids.length },
    });
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error, "Failed to reorder the avatars");
  }
};

// DELETE /superadmin/avatar-presets/:id[?confirmUsage=true]
// Built-ins are never deleted. A custom avatar that people use is deleted only with
// confirmUsage=true; their profiles then fall back to their photo or initials.
exports.remove = async (req, res) => {
  try {
    const preset = await AvatarPreset.findById(req.params.id);
    if (!preset) return fail(res, 404, "AVATAR_PRESET_NOT_FOUND", "Avatar not found.");
    if (preset.isBuiltIn) return fail(res, 409, "AVATAR_BUILTIN_PROTECTED", MESSAGES.AVATAR_BUILTIN_PROTECTED);
    const usage = await usageCounts([preset._id]);
    const used = usage.get(String(preset._id)) || 0;
    if (used > 0 && req.query?.confirmUsage !== "true") {
      return fail(res, 409, "TEMPLATE_IN_USE", `${used} accounts use this avatar.`, { usage: used });
    }
    await AvatarPreset.deleteOne({ _id: preset._id });
    await removeStored(preset.image?.storedValue, preset.image?.thumbStoredValue);
    invalidateCache();
    await audit(req, "deleted", preset, { usage: used });
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error, "Failed to delete the avatar");
  }
};

// POST /superadmin/avatar-presets/builtins  (multipart: manifest JSON + images[])
exports.installBuiltIns = async (req, res) => {
  try {
    const parsed = parseManifest(req.body?.manifest, "avatar");
    const files = Array.isArray(req.files) ? req.files : [];
    if (!parsed.ok || files.length !== parsed.entries.length) {
      return fail(res, 400, "AVATAR_MANIFEST_INVALID", MESSAGES.AVATAR_MANIFEST_INVALID);
    }
    const results = await installBuiltIns({
      Model: AvatarPreset,
      profile: PROFILES.avatar,
      category: "avatarPreset",
      entries: parsed.entries,
      files,
      makeDoc: (entry, ctx) => ({
        slug: entry.key,
        name: entry.name,
        nameFil: entry.nameFil,
        image: ctx.image,
        isBuiltIn: true,
        builtInKey: entry.key,
        isActive: true,
        sortOrder: ctx.sortOrder,
        createdBy: req.user.id,
        updatedBy: req.user.id,
      }),
    });
    const counts = summarize(results);
    invalidateCache();
    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: req.user.role,
      action: "superadmin.avatar_preset.builtins_installed",
      targetType: "avatar_preset",
      targetId: "builtins",
      severity: "info",
      metadata: { created: counts.created, existing: counts.existing, failed: counts.failed, keys: counts.createdKeys },
    });
    return res.json({ created: counts.created, existing: counts.existing, failed: counts.failed, results });
  } catch (error) {
    return sendError(res, error, "Failed to install the built-in avatars");
  }
};
