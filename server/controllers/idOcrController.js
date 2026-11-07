const User = require("../models/User");
const { getActiveValues } = require("../services/systemOptionService");
const { getFormat } = require("../data/governmentIdFormats");
const { logAuditEvent } = require("../services/auditService");
const { sendError } = require("../utils/sendError");

exports.getIdFormats = async (_req, res) => {
  try {
    const active = await getActiveValues("governmentIdType");
    return res.json({ formats: Object.fromEntries([...active].map((type) => {
      const format = getFormat(type);
      return [type, format ? { pattern: format.pattern, hint: format.hint } : null];
    })) });
  } catch (error) { return sendError(res, error); }
};

exports.confirmIdOcr = async (req, res) => {
  try {
    const { runId, governmentIdType, governmentIdNumber } = req.body;
    if (req.user.role !== "jobseeker") return res.status(403).json({ message: "Only jobseekers can confirm ID details" });
    const active = await getActiveValues("governmentIdType");
    if (typeof governmentIdType !== "string" || !active.has(governmentIdType) || typeof governmentIdNumber !== "string" || governmentIdNumber.length > 80 || !governmentIdNumber.trim() || typeof runId !== "string") {
      return res.status(400).json({ message: "Select an active ID type and enter its number" });
    }
    // Advisory formats never reject a legitimate card with a newer layout.
    const saved = await User.findOneAndUpdate({ _id: req.user.id || req.user._id, role: "jobseeker", "governmentIdOcr.runId": runId, "governmentIdOcr.status": "done" }, {
      $set: { governmentIdType, governmentIdNumber: governmentIdNumber.trim(), governmentIdTypeOther: null, "governmentIdOcr.confirmedAt": new Date() },
    }, { new: true }).select("governmentIdType governmentIdNumber governmentIdOcr");
    if (!saved) return res.status(409).json({ message: "This ID has changed. Refresh and review the latest upload." });
    await logAuditEvent({ req, actorId: req.user.id, actorRole: req.user.role, action: "user.id.ocr_confirmed", targetType: "user", targetId: String(saved._id) });
    return res.json({ user: saved });
  } catch (error) { return sendError(res, error); }
};
