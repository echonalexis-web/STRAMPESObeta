const User = require("../models/User");
const { reserveOcrSlot } = require("../services/idOcrService");
const { sendError } = require("../utils/sendError");
const { validateFile } = require("./upload");

// Shared by both upload aliases, before storage persistence. An atomic account
// window makes the five/hour allowance apply across processes and IP addresses.
const limit = async (req, res, next) => {
  if (!req.files?.validIdFile?.length && !req.files?.supportingDocument?.length) return next();
  const now = new Date();
  const cutoff = new Date(now.getTime() - 60 * 60 * 1000);
  try {
    const filter = { _id: req.user.id || req.user._id };
    // Reset expired windows only. Increment then reserves the slot atomically.
    await User.updateOne({ ...filter, $or: [{ idUploadWindowStartedAt: null }, { idUploadWindowStartedAt: { $lte: cutoff } }] }, { $set: { idUploadWindowStartedAt: now, idUploadCount: 0 } });
    const result = await User.updateOne({ ...filter, idUploadCount: { $lt: 5 } }, { $inc: { idUploadCount: 1 } });
    if (!result.modifiedCount) return res.status(429).json({ message: "You can upload an ID five times per hour. Please try again later." });
    return next();
  } catch (error) { return sendError(res, error, "Could not accept ID upload"); }
};

module.exports = (req, res, next) => {
  if (!req.files?.validIdFile?.length && !req.files?.supportingDocument?.length) return next();
  return validateFile(req, res, () => reserveOcrSlot(req, res, () => limit(req, res, next)));
};
