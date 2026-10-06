const NsrpTemplate = require("../models/NsrpTemplate");
const { fillForm1, fillForm2, validateTemplate } = require("../services/nsrpFormService");
const { fixtureUser, fixtureJobseekerProfile, fixtureEmployerProfile } = require("../services/nsrpSampleData");
const { logAuditEvent } = require("../services/auditService");
const { sendError } = require("../utils/sendError");

const fillSample = (form, bytes) => form === "form1"
  ? fillForm1(fixtureJobseekerProfile, fixtureUser, bytes)
  : fillForm2(fixtureEmployerProfile, fixtureUser, bytes);

exports.validateNsrpTemplate = async (req, res, next) => {
  try {
    if (!["form1", "form2"].includes(req.params.form)) {
      return res.status(400).json({ message: "Invalid NSRP form" });
    }
    if (req.file?.mimetype !== "application/pdf") {
      return res.status(400).json({ message: "Upload a valid PDF file." });
    }
    await validateTemplate(req.params.form, req.file.buffer);
    // Failed rendering must leave the active form intact.
    req.nsrpSample = await fillSample(req.params.form, req.file.buffer);
    return next();
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    return sendError(res, error, "Could not validate NSRP template");
  }
};

exports.persistNsrpTemplate = async (req, res, next) => {
  try {
    await NsrpTemplate.findOneAndUpdate(
      { form: req.params.form },
      { $set: { data: req.file.buffer, filename: req.file.originalname, updatedBy: req.user.id } },
      { new: true, upsert: true, runValidators: true }
    );
    return next();
  } catch (error) {
    return sendError(res, error, "Could not save NSRP template");
  }
};

const sendSample = (res, form, sample) => {
  res.set("Cache-Control", "no-store");
  res.type("application/pdf");
  res.set("Content-Disposition", 'attachment; filename="NSRP-' + form + '-filled-sample.pdf"');
  return res.send(sample);
};

exports.uploadNsrpTemplate = async (req, res) => {
  await logAuditEvent({
    req,
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "superadmin.nsrp_template.updated",
    targetType: "system",
    targetId: req.params.form,
    severity: "warning",
    metadata: { filename: req.file.originalname },
  });
  return sendSample(res, req.params.form, req.nsrpSample);
};

exports.downloadNsrpSample = async (req, res) => {
  try {
    if (!["form1", "form2"].includes(req.params.form)) {
      return res.status(400).json({ message: "Invalid NSRP form" });
    }
    const sample = await fillSample(req.params.form);
    return sendSample(res, req.params.form, sample);
  } catch (error) {
    return sendError(res, error, "Could not generate NSRP sample");
  }
};

// Lets the Settings UI show which template is currently active (the
// superadmin's own upload, or the bundled default) without downloading it.
exports.getNsrpTemplateMeta = async (req, res) => {
  try {
    if (!["form1", "form2"].includes(req.params.form)) {
      return res.status(400).json({ message: "Invalid NSRP form" });
    }
    const doc = await NsrpTemplate.findOne({ form: req.params.form })
      .select("filename updatedAt")
      .lean();
    return res.json({
      form: req.params.form,
      isCustom: Boolean(doc),
      filename: doc?.filename || null,
      updatedAt: doc?.updatedAt || null,
    });
  } catch (error) {
    return sendError(res, error, "Could not load NSRP template info");
  }
};
