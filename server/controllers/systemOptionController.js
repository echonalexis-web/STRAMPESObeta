const SystemOption = require("../models/SystemOption");
const { invalidateCache } = require("../services/systemOptionService");
const { logAuditEvent } = require("../services/auditService");
const { sendError } = require("../utils/sendError");

const CATEGORIES = ["industry", "jobType", "governmentIdType"];

// GET /system-options/:category — any authenticated user (the dropdowns
// that consume this need it); includes inactive rows only for superadmins
// managing the catalog, so the public-facing list never shows a retired
// option as selectable.
exports.listByCategory = async (req, res) => {
  try {
    const { category } = req.params;
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ message: `Unknown category "${category}".` });
    }

    const includeInactive = req.user?.role === "superadmin" && req.query.includeInactive === "true";
    const filter = includeInactive ? { category } : { category, isActive: true };

    const options = await SystemOption.find(filter).sort({ order: 1, value: 1 }).lean();
    // A category with no rows has not been seeded. Distinguish it from a
    // category whose existing rows were all deliberately deactivated, so
    // clients can use their built-in list only for the former case.
    const configured = options.length > 0 || Boolean(await SystemOption.exists({ category }));
    return res.json({ options, configured });
  } catch (error) {
    return sendError(res, error, "Failed to load options");
  }
};

// POST /system-options — superadmin only.
exports.createOption = async (req, res) => {
  try {
    const { category, value, order } = req.body;
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ message: `Unknown category "${category}".` });
    }
    const trimmedValue = String(value || "").trim();
    if (!trimmedValue) {
      return res.status(400).json({ message: "value is required." });
    }

    const option = await SystemOption.create({
      category,
      value: trimmedValue,
      order: Number.isFinite(Number(order)) ? Number(order) : 0,
    });

    invalidateCache(category);

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: req.user.role,
      action: "superadmin.system_option.created",
      targetType: "system_option",
      targetId: String(option._id),
      severity: "info",
      metadata: { category, value: trimmedValue },
    });

    return res.status(201).json({ option });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "That value already exists in this category." });
    }
    return sendError(res, error, "Failed to create option");
  }
};

// PUT /system-options/:id — superadmin only. value/order/isActive.
exports.updateOption = async (req, res) => {
  try {
    const { id } = req.params;
    const update = {};
    if (req.body.value !== undefined) {
      const trimmedValue = String(req.body.value || "").trim();
      if (!trimmedValue) return res.status(400).json({ message: "value can't be empty." });
      update.value = trimmedValue;
    }
    if (req.body.order !== undefined) update.order = Number(req.body.order) || 0;
    if (req.body.isActive !== undefined) update.isActive = Boolean(req.body.isActive);

    const option = await SystemOption.findByIdAndUpdate(id, { $set: update }, { new: true, runValidators: true });
    if (!option) return res.status(404).json({ message: "Option not found" });

    invalidateCache(option.category);

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: req.user.role,
      action: "superadmin.system_option.updated",
      targetType: "system_option",
      targetId: String(option._id),
      severity: "info",
      metadata: { category: option.category, update },
    });

    return res.json({ option });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "That value already exists in this category." });
    }
    return sendError(res, error, "Failed to update option");
  }
};

// DELETE /system-options/:id — superadmin only. Hard delete — the catalog
// only maintains the *list*; existing jobs/profiles that already reference a
// removed value are untouched (deactivating via isActive is the "retire
// without breaking history" path — prefer that over delete where possible).
exports.deleteOption = async (req, res) => {
  try {
    const { id } = req.params;
    const option = await SystemOption.findByIdAndDelete(id);
    if (!option) return res.status(404).json({ message: "Option not found" });

    invalidateCache(option.category);

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: req.user.role,
      action: "superadmin.system_option.deleted",
      targetType: "system_option",
      targetId: String(option._id),
      severity: "warning",
      metadata: { category: option.category, value: option.value },
    });

    return res.json({ success: true });
  } catch (error) {
    return sendError(res, error, "Failed to delete option");
  }
};
