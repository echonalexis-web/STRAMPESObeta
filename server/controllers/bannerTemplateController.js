const mongoose = require("mongoose");
const BannerTemplate = require("../models/BannerTemplate");
const User = require("../models/User");
const { logAuditEvent } = require("../services/auditService");
const { validateDefinition, listActiveTemplates, invalidateCache } = require("../services/bannerTemplateService");
const { sendError } = require("../utils/sendError");

const fail = (res, status, code, message) => res.status(status).json({ code, message });

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
    metadata: { slug: template.slug, ...(metadata || {}) },
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
  definition: t.definition,
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
  const overlay = body.overlay === "light" ? "light" : "dark";
  const kind = body.kind === "pattern" ? "pattern" : body.kind === "gradient" ? "gradient" : null;
  return { name, nameFil, overlay, kind };
};

// POST /superadmin/banner-templates
exports.create = async (req, res) => {
  try {
    const { name, nameFil, overlay, kind } = readBody(req.body || {});
    if (!name || name.length > 60) return fail(res, 400, "TEMPLATE_DEFINITION_INVALID", "A name of 1 to 60 characters is required.");
    if (!kind) return fail(res, 400, "TEMPLATE_DEFINITION_INVALID", "kind must be gradient or pattern.");
    const checked = validateDefinition(req.body.definition);
    if (!checked.ok) return fail(res, 400, "TEMPLATE_DEFINITION_INVALID", checked.reason);

    const slug = slugify(name);
    if (!slug) return fail(res, 400, "TEMPLATE_DEFINITION_INVALID", "The name must contain letters or numbers.");
    if (await BannerTemplate.exists({ slug })) return fail(res, 409, "TEMPLATE_NAME_TAKEN", "A template with this name already exists.");

    const last = await BannerTemplate.findOne({}).sort({ sortOrder: -1 }).select("sortOrder").lean();
    const created = await BannerTemplate.create({
      slug,
      name,
      nameFil,
      kind,
      overlay,
      definition: checked.definition,
      sortOrder: (last?.sortOrder ?? -1) + 1,
      createdBy: req.user.id,
      updatedBy: req.user.id,
    });
    invalidateCache();
    await audit(req, "created", created);
    return res.status(201).json(adminShape(created.toObject(), 0));
  } catch (error) {
    if (error && error.code === 11000) return fail(res, 409, "TEMPLATE_NAME_TAKEN", "A template with this name already exists.");
    return sendError(res, error, "Failed to create banner template");
  }
};

// PUT /superadmin/banner-templates/:id (the slug is stable once created)
exports.update = async (req, res) => {
  try {
    const template = await BannerTemplate.findById(req.params.id);
    if (!template) return fail(res, 404, "COVER_TEMPLATE_NOT_FOUND", "Template not found.");
    const { name, nameFil, overlay, kind } = readBody(req.body || {});
    if (!name || name.length > 60) return fail(res, 400, "TEMPLATE_DEFINITION_INVALID", "A name of 1 to 60 characters is required.");
    if (!kind) return fail(res, 400, "TEMPLATE_DEFINITION_INVALID", "kind must be gradient or pattern.");
    const checked = validateDefinition(req.body.definition);
    if (!checked.ok) return fail(res, 400, "TEMPLATE_DEFINITION_INVALID", checked.reason);

    template.name = name;
    template.nameFil = nameFil;
    template.overlay = overlay;
    template.kind = kind;
    template.definition = checked.definition;
    template.updatedBy = req.user.id;
    await template.save();
    invalidateCache();
    await audit(req, "updated", template);
    const usage = await usageCounts([template._id]);
    return res.json(adminShape(template.toObject(), usage.get(String(template._id))));
  } catch (error) {
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
    invalidateCache();
    await audit(req, "deleted", template);
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error, "Failed to delete banner template");
  }
};
