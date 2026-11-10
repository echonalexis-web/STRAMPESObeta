const mongoose = require("mongoose");
const BannerTemplate = require("../models/BannerTemplate");
const User = require("../models/User");
const { logAuditEvent } = require("../services/auditService");
const { listActiveTemplates, invalidateCache, publicImage } = require("../services/bannerTemplateService");
const { processTemplateImage, TemplateImageError } = require("../services/bannerTemplateImageService");
const storageService = require("../services/storageService");
const { sendError } = require("../utils/sendError");
const logger = require("../utils/logger");

const fail = (res, status, code, message) => res.status(status).json({ code, message });

// Messages are a fallback: the client translates `code` through errors.codes.*.
const MESSAGES = {
  TEMPLATE_IMAGE_REQUIRED: "Choose an SVG or PNG image to upload.",
  TEMPLATE_IMAGE_TYPE: "The template must be an SVG or PNG image.",
  TEMPLATE_IMAGE_TOO_LARGE: "The image is too large.",
  TEMPLATE_IMAGE_DIMENSIONS: "The image size is not allowed. Use about 1600 by 400 pixels.",
  TEMPLATE_IMAGE_RATIO: "The image must be close to a 4 to 1 banner (for example 1600 by 400).",
  TEMPLATE_IMAGE_UNSAFE: "The SVG contains content that is not allowed (scripts, external links or embedded HTML).",
  TEMPLATE_IMAGE_PROCESSING_FAILED: "We could not read that image. Try another file.",
  TEMPLATE_UPLOAD_FAILED: "We could not store the image. Please try again.",
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

const audit = (req, action, template, metadata) =>
  logAuditEvent({
    req,
    actorId: req.user.id,
    actorRole: req.user.role,
    action: `superadmin.banner_template.${action}`,
    targetType: "banner_template",
    targetId: String(template._id),
    severity: "info",
    // Ids and counts only: never file contents.
    metadata: { templateId: String(template._id), slug: template.slug, ...(metadata || {}) },
  });

const usageCounts = async (ids) => {
  if (!ids.length) return new Map();
  const rows = await User.aggregate([
    { $match: { "cover.templateId": { $in: ids } } },
    { $group: { _id: "$cover.templateId", n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
};

const adminShape = (t, usage) => ({
  id: String(t._id),
  slug: t.slug,
  name: t.name,
  nameFil: t.nameFil || "",
  kind: t.kind,
  // Legacy gradient and pattern templates: still listed and rendered, never editable
  // with a builder. Uploading an image converts one to an image template.
  legacy: t.kind !== "image",
  image: publicImage(t.image),
  ...(t.definition ? { definition: t.definition } : {}),
  overlay: t.overlay,
  sortOrder: t.sortOrder,
  isActive: t.isActive,
  isDefault: t.isDefault,
  archivedAt: t.archivedAt || null,
  usage: usage || 0,
});

// GET /banner-templates (any signed-in user): active templates only.
exports.listForUsers = async (req, res) => {
  try {
    const payload = await listActiveTemplates();
    res.set("Cache-Control", "private, max-age=60");
    return res.json(payload);
  } catch (error) {
    return sendError(res, error, "Failed to load banner templates");
  }
};

// GET /superadmin/banner-templates
exports.listForSuperadmin = async (req, res) => {
  try {
    const rows = await BannerTemplate.find({}).sort({ sortOrder: 1, name: 1 }).lean();
    const usage = await usageCounts(rows.map((r) => r._id));
    return res.json({ templates: rows.map((r) => adminShape(r, usage.get(String(r._id)))) });
  } catch (error) {
    return sendError(res, error, "Failed to load banner templates");
  }
};

const readBody = (body) => {
  const name = String(body.name || "").trim();
  const nameFil = String(body.nameFil || "").trim();
  // Multipart sends strings. Absent means "leave as is" on update.
  let isActive;
  if (body.isActive === true || body.isActive === "true") isActive = true;
  else if (body.isActive === false || body.isActive === "false") isActive = false;
  return { name, nameFil, isActive };
};

const validNames = ({ name, nameFil }) => name.length >= 1 && name.length <= 60 && nameFil.length <= 60;

// Processes the upload and stores both variants. Returns the image subdocument and the
// stored values to clean up if a later step fails. Sends the error response itself and
// returns null on failure.
const processAndStore = async (req, res) => {
  if (!req.file || !req.file.buffer) {
    fail(res, 400, "TEMPLATE_IMAGE_REQUIRED", MESSAGES.TEMPLATE_IMAGE_REQUIRED);
    return null;
  }
  let processed;
  try {
    processed = await processTemplateImage(req.file);
  } catch (error) {
    if (error instanceof TemplateImageError) {
      fail(res, error.status, error.code, MESSAGES[error.code] || error.message);
      return null;
    }
    throw error;
  }

  const stored = [];
  try {
    const large = await storageService.upload({ buffer: processed.large.buffer, mimetype: "image/webp" }, { category: "bannerTemplate" });
    stored.push(large.storedValue);
    const small = await storageService.upload({ buffer: processed.small.buffer, mimetype: "image/webp" }, { category: "bannerTemplate" });
    stored.push(small.storedValue);
    return {
      stored,
      overlay: processed.overlay,
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
    logger.error("Banner template upload failed", { error: error.message });
    fail(res, 502, "TEMPLATE_UPLOAD_FAILED", MESSAGES.TEMPLATE_UPLOAD_FAILED);
    return null;
  }
};

// POST /superadmin/banner-templates  (multipart: image, name, nameFil, isActive)
exports.create = async (req, res) => {
  let stored = [];
  try {
    const body = readBody(req.body || {});
    if (!validNames(body)) return fail(res, 400, "TEMPLATE_DEFINITION_INVALID", "A name of 1 to 60 characters is required.");
    const slug = slugify(body.name);
    if (!slug) return fail(res, 400, "TEMPLATE_DEFINITION_INVALID", "The name must contain letters or numbers.");
    if (await BannerTemplate.exists({ slug })) return fail(res, 409, "TEMPLATE_NAME_TAKEN", "A template with this name already exists.");

    const result = await processAndStore(req, res);
    if (!result) return undefined;
    stored = result.stored;

    const last = await BannerTemplate.findOne({}).sort({ sortOrder: -1 }).select("sortOrder").lean();
    const created = await BannerTemplate.create({
      slug,
      name: body.name,
      nameFil: body.nameFil,
      kind: "image",
      image: result.image,
      overlay: result.overlay,
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
    if (error && error.code === 11000) return fail(res, 409, "TEMPLATE_NAME_TAKEN", "A template with this name already exists.");
    return sendError(res, error, "Failed to create banner template");
  }
};

// PUT /superadmin/banner-templates/:id  (multipart: name, nameFil, isActive, optional image)
// The slug is stable once created. A new image replaces the old one (a legacy gradient
// or pattern template becomes an image template; its stored definition is left as is).
// Without an image only the names and the active flag change.
exports.update = async (req, res) => {
  let stored = [];
  try {
    const template = await BannerTemplate.findById(req.params.id);
    if (!template) return fail(res, 404, "COVER_TEMPLATE_NOT_FOUND", "Template not found.");
    const body = readBody(req.body || {});
    if (!validNames(body)) return fail(res, 400, "TEMPLATE_DEFINITION_INVALID", "A name of 1 to 60 characters is required.");
    if (body.isActive === false && template.isDefault) return fail(res, 409, "TEMPLATE_IS_DEFAULT", "The default template cannot be archived.");

    let replaced = null;
    if (req.file) {
      const result = await processAndStore(req, res);
      if (!result) return undefined;
      stored = result.stored;
      replaced = { storedValue: template.image?.storedValue, thumbStoredValue: template.image?.thumbStoredValue };
      template.image = result.image;
      template.overlay = result.overlay;
      template.kind = "image";
    }

    template.name = body.name;
    template.nameFil = body.nameFil;
    if (typeof body.isActive === "boolean" && body.isActive !== template.isActive) {
      template.isActive = body.isActive;
      template.archivedAt = body.isActive ? null : new Date();
    }
    template.updatedBy = req.user.id;
    await template.save();
    stored = [];
    if (replaced) await removeStored(replaced.storedValue, replaced.thumbStoredValue);
    invalidateCache();
    await audit(req, replaced ? "image_replaced" : "updated", template);
    const usage = await usageCounts([template._id]);
    return res.json(adminShape(template.toObject(), usage.get(String(template._id))));
  } catch (error) {
    await removeStored(...stored);
    return sendError(res, error, "Failed to update banner template");
  }
};

// PATCH /superadmin/banner-templates/:id/active  body { isActive }
exports.setActive = async (req, res) => {
  try {
    if (typeof req.body?.isActive !== "boolean") return fail(res, 400, "TEMPLATE_DEFINITION_INVALID", "isActive must be true or false.");
    const template = await BannerTemplate.findById(req.params.id);
    if (!template) return fail(res, 404, "COVER_TEMPLATE_NOT_FOUND", "Template not found.");
    if (!req.body.isActive && template.isDefault) return fail(res, 409, "TEMPLATE_IS_DEFAULT", "The default template cannot be archived.");

    template.isActive = req.body.isActive;
    template.archivedAt = req.body.isActive ? null : new Date();
    template.updatedBy = req.user.id;
    await template.save();
    invalidateCache();
    const usage = await usageCounts([template._id]);
    await audit(req, req.body.isActive ? "activated" : "archived", template, { usage: usage.get(String(template._id)) || 0 });
    return res.json(adminShape(template.toObject(), usage.get(String(template._id))));
  } catch (error) {
    return sendError(res, error, "Failed to update banner template");
  }
};

// PATCH /superadmin/banner-templates/:id/default
exports.setDefault = async (req, res) => {
  try {
    const template = await BannerTemplate.findById(req.params.id);
    if (!template) return fail(res, 404, "COVER_TEMPLATE_NOT_FOUND", "Template not found.");
    if (!template.isActive) return fail(res, 409, "COVER_TEMPLATE_INACTIVE", "An archived template cannot be the default.");
    if (!template.isDefault) {
      await BannerTemplate.updateMany({ isDefault: true }, { $set: { isDefault: false } });
      template.isDefault = true;
      template.updatedBy = req.user.id;
      await template.save();
    }
    invalidateCache();
    await audit(req, "default_set", template);
    return res.json(adminShape(template.toObject()));
  } catch (error) {
    return sendError(res, error, "Failed to set the default template");
  }
};

// PUT /superadmin/banner-templates/order  body { ids: [...] } (every template exactly once)
exports.reorder = async (req, res) => {
  try {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.some((id) => !mongoose.isValidObjectId(id)) || new Set(ids.map(String)).size !== ids.length) {
      return fail(res, 400, "TEMPLATE_ORDER_INVALID", "ids must list each template once.");
    }
    const existing = await BannerTemplate.find({}).select("_id").lean();
    if (existing.length !== ids.length || !existing.every((e) => ids.map(String).includes(String(e._id)))) {
      return fail(res, 400, "TEMPLATE_ORDER_INVALID", "ids must list every template.");
    }
    await BannerTemplate.bulkWrite(ids.map((id, index) => ({ updateOne: { filter: { _id: id }, update: { $set: { sortOrder: index } } } })));
    invalidateCache();
    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: req.user.role,
      action: "superadmin.banner_template.reordered",
      targetType: "banner_template",
      targetId: "order",
      severity: "info",
      metadata: { count: ids.length },
    });
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error, "Failed to reorder banner templates");
  }
};

// DELETE /superadmin/banner-templates/:id (zero usage only)
exports.remove = async (req, res) => {
  try {
    const template = await BannerTemplate.findById(req.params.id);
    if (!template) return fail(res, 404, "COVER_TEMPLATE_NOT_FOUND", "Template not found.");
    if (template.isDefault) return fail(res, 409, "TEMPLATE_IS_DEFAULT", "The default template cannot be deleted.");
    const usage = await usageCounts([template._id]);
    const used = usage.get(String(template._id)) || 0;
    if (used > 0) return fail(res, 409, "TEMPLATE_IN_USE", `${used} accounts use this template. Archive it instead.`);
    await BannerTemplate.deleteOne({ _id: template._id });
    await removeStored(template.image?.storedValue, template.image?.thumbStoredValue);
    invalidateCache();
    await audit(req, "deleted", template);
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error, "Failed to delete banner template");
  }
};
