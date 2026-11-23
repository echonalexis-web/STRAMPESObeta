const path = require("path");
const ResumePhoto = require("../models/ResumePhoto");
const { processResumePhoto, ResumePhotoError, MESSAGES } = require("../services/resumePhotoService");
const { logAuditEvent } = require("../services/auditService");
const { sendError } = require("../utils/sendError");

// The applicant's own resume photo (separate from the profile photo). Every handler works on
// req.user.id only: there is no id in any route, so no one can name another user's photo.
// File contents and storage details are never logged; the audit event carries no file data.

const summary = (doc) => ({
  hasPhoto: true,
  name: doc.originalName || "photo",
  width: doc.width,
  height: doc.height,
  updatedAt: doc.updatedAt,
});

const cleanName = (value) =>
  path.basename(String(value || ""))
    .replace(/[^A-Za-z0-9._ -]/g, "")
    .slice(0, 60);

const audit = (req, action) =>
  logAuditEvent({ req, actorId: req.user.id, actorRole: req.user.role, action, targetType: "user", targetId: String(req.user.id), severity: "info" });

exports.getResumePhotoInfo = async (req, res) => {
  try {
    const doc = await ResumePhoto.findOne({ owner: req.user.id }).select("originalName width height updatedAt").lean();
    return res.json(doc ? summary(doc) : { hasPhoto: false });
  } catch (error) {
    return sendError(res, error, "Failed to load your resume photo");
  }
};

// The image itself, with the content type it really has (we made it: always WebP).
exports.getResumePhoto = async (req, res) => {
  try {
    const doc = await ResumePhoto.findOne({ owner: req.user.id }).select("data contentType").lean();
    if (!doc || !doc.data) return res.status(404).json({ message: "No resume photo" });
    res.set("Content-Type", doc.contentType || "image/webp");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Cache-Control", "private, no-store");
    return res.send(Buffer.isBuffer(doc.data) ? doc.data : Buffer.from(doc.data.buffer || doc.data));
  } catch (error) {
    return sendError(res, error, "Failed to load your resume photo");
  }
};

// Upload and replace are the same call: one photo per applicant, written in place.
exports.putResumePhoto = async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ code: "RESUME_PHOTO_MISSING", message: MESSAGES.RESUME_PHOTO_MISSING });
    }
    let processed;
    try {
      processed = await processResumePhoto(req.file.buffer);
    } catch (error) {
      if (error instanceof ResumePhotoError) {
        return res.status(error.status).json({ code: error.code, message: MESSAGES[error.code] || MESSAGES.RESUME_PHOTO_PROCESSING_FAILED });
      }
      throw error;
    }

    const doc = await ResumePhoto.findOneAndUpdate(
      { owner: req.user.id },
      {
        $set: {
          data: processed.buffer,
          contentType: processed.contentType,
          width: processed.width,
          height: processed.height,
          bytes: processed.bytes,
          originalName: cleanName(req.file.originalname),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await audit(req, "user.resume_photo.saved");
    return res.json(summary(doc));
  } catch (error) {
    return sendError(res, error, "Failed to save your resume photo");
  }
};

// Removing the photo never touches resumes already saved: they carry their own copy of the picture.
exports.removeResumePhoto = async (req, res) => {
  try {
    const removed = await ResumePhoto.findOneAndDelete({ owner: req.user.id });
    if (removed) await audit(req, "user.resume_photo.removed");
    return res.json({ hasPhoto: false });
  } catch (error) {
    return sendError(res, error, "Failed to remove your resume photo");
  }
};
