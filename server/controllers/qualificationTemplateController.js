const QualificationTemplate = require("../models/QualificationTemplate");
const { serializeSystemTemplates } = require("../data/qualificationTemplates");

const ALLOWED_TYPES = ["education", "experience", "skill", "certification", "license", "other"];
const MAX_TEMPLATES_PER_EMPLOYER = 60;
const MAX_ITEMS_PER_TEMPLATE = 60;

const getUserId = (req) => req.user._id || req.user.id;

// Coerce whatever the client sent into a clean, ordered item array or throw a
// message string describing why it is invalid.
const sanitizeItems = (rawItems) => {
  let items = rawItems;
  if (typeof items === "string") {
    try {
      items = JSON.parse(items);
    } catch (e) {
      throw "Invalid items format";
    }
  }
  if (!Array.isArray(items)) throw "Items must be an array";
  if (items.length === 0) throw "A template needs at least one item";
  if (items.length > MAX_ITEMS_PER_TEMPLATE) {
    throw `A template can have at most ${MAX_ITEMS_PER_TEMPLATE} items`;
  }

  return items.map((item, index) => {
    const type = String(item?.type || "").trim().toLowerCase();
    const value = String(item?.value ?? item?.text ?? "").trim();
    if (!ALLOWED_TYPES.includes(type)) {
      throw `Item ${index + 1}: invalid type "${item?.type}"`;
    }
    if (!value) throw `Item ${index + 1}: value is required`;
    if (value.length > 200) throw `Item ${index + 1}: value is too long`;
    return {
      type,
      value,
      optional: Boolean(item?.optional ?? item?.isPreferred),
      order: index,
    };
  });
};

const serializeCustom = (doc) => ({
  id: String(doc._id),
  name: doc.name,
  jobTitle: doc.jobTitle || "",
  source: "custom",
  items: (doc.items || []).map((item, index) => ({
    type: item.type,
    value: item.value,
    optional: Boolean(item.optional),
    order: item.order != null ? item.order : index,
  })),
  updatedAt: doc.updatedAt,
});

// ---------------------------------------------------------------------
// GET /employer/qualification-templates
// Returns built-in system templates followed by this employer's own.
// ---------------------------------------------------------------------
exports.listTemplates = async (req, res) => {
  try {
    const employerId = getUserId(req);
    const custom = await QualificationTemplate.find({ employer: employerId })
      .sort({ updatedAt: -1 })
      .lean();

    return res.json({
      templates: [...serializeSystemTemplates(), ...custom.map(serializeCustom)],
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load qualification templates" });
  }
};

// ---------------------------------------------------------------------
// POST /employer/qualification-templates
// Body: { name, jobTitle?, items:[{type,value,optional}] }
// Saving under an existing name overwrites that template (upsert by name).
// ---------------------------------------------------------------------
exports.createTemplate = async (req, res) => {
  try {
    const employerId = getUserId(req);
    const name = String(req.body.name || "").trim();
    const jobTitle = String(req.body.jobTitle || "").trim().slice(0, 120);

    if (!name) return res.status(400).json({ message: "Template name is required" });
    if (name.length > 120) return res.status(400).json({ message: "Template name is too long" });

    let items;
    try {
      items = sanitizeItems(req.body.items);
    } catch (validationMessage) {
      return res.status(400).json({ message: String(validationMessage) });
    }

    const existing = await QualificationTemplate.findOne({ employer: employerId, name });
    if (!existing) {
      const count = await QualificationTemplate.countDocuments({ employer: employerId });
      if (count >= MAX_TEMPLATES_PER_EMPLOYER) {
        return res.status(400).json({
          message: `You can save at most ${MAX_TEMPLATES_PER_EMPLOYER} templates. Delete one first.`,
        });
      }
    }

    const doc = await QualificationTemplate.findOneAndUpdate(
      { employer: employerId, name },
      { employer: employerId, name, jobTitle, items, source: "custom" },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return res.status(existing ? 200 : 201).json({ template: serializeCustom(doc) });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ message: "A template with that name already exists" });
    }
    return res.status(500).json({ message: "Failed to save template" });
  }
};

// ---------------------------------------------------------------------
// PUT /employer/qualification-templates/:id
// ---------------------------------------------------------------------
exports.updateTemplate = async (req, res) => {
  try {
    const employerId = String(getUserId(req));
    const doc = await QualificationTemplate.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Template not found" });
    if (String(doc.employer) !== employerId) {
      return res.status(403).json({ message: "You can only edit your own templates" });
    }

    if (req.body.name !== undefined) {
      const name = String(req.body.name || "").trim();
      if (!name) return res.status(400).json({ message: "Template name is required" });
      doc.name = name.slice(0, 120);
    }
    if (req.body.jobTitle !== undefined) {
      doc.jobTitle = String(req.body.jobTitle || "").trim().slice(0, 120);
    }
    if (req.body.items !== undefined) {
      try {
        doc.items = sanitizeItems(req.body.items);
      } catch (validationMessage) {
        return res.status(400).json({ message: String(validationMessage) });
      }
    }

    await doc.save();
    return res.json({ template: serializeCustom(doc) });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ message: "A template with that name already exists" });
    }
    return res.status(500).json({ message: "Failed to update template" });
  }
};

// ---------------------------------------------------------------------
// DELETE /employer/qualification-templates/:id
// ---------------------------------------------------------------------
exports.deleteTemplate = async (req, res) => {
  try {
    const employerId = String(getUserId(req));
    const doc = await QualificationTemplate.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Template not found" });
    if (String(doc.employer) !== employerId) {
      return res.status(403).json({ message: "You can only delete your own templates" });
    }
    await doc.deleteOne();
    return res.json({ message: "Template deleted", id: String(doc._id) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete template" });
  }
};
