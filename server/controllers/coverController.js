const mongoose = require("mongoose");
const User = require("../models/User");
const BannerTemplate = require("../models/BannerTemplate");
const { resolveCover } = require("../services/bannerTemplateService");
const { normalizeRole } = require("../services/profileProjection");
const { sendError } = require("../utils/sendError");

const fail = (res, status, code, message) => res.status(status).json({ code, message });

// PUT /auth/profile/cover  body { templateId } or { templateId: null }
// A jobseeker or employer picks one of the preset banners for their OWN account.
// The body may contain nothing but `templateId`: any image, url or other key is
// refused, so no one can store a file reference or arbitrary data through here.
exports.setTemplateCover = async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : null;
    if (!body || !Object.prototype.hasOwnProperty.call(body, "templateId") || Object.keys(body).some((k) => k !== "templateId")) {
      return fail(res, 400, "COVER_ONLY_TEMPLATE_ALLOWED", "Send only a templateId.");
    }
    const { templateId } = body;
    if (templateId !== null && typeof templateId !== "string") {
      return fail(res, 400, "COVER_ONLY_TEMPLATE_ALLOWED", "templateId must be a string or null.");
    }

    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId).select("role cover");
    if (!user) return fail(res, 404, "NOT_FOUND", "User not found.");
    const role = normalizeRole(user.role);
    if (role !== "jobseeker" && role !== "employer") {
      return fail(res, 403, "COVER_NOT_ALLOWED", "This account type has no profile banner.");
    }

    let update;
    if (templateId === null) {
      // Reset to the default. An employer's uploaded image (if any) is kept for
      // the upload tools but no longer shown.
      const hasImage = Boolean(user.cover?.image?.url);
      update = hasImage
        ? { $unset: { "cover.kind": 1, "cover.templateId": 1 }, $set: { "cover.updatedAt": new Date() } }
        : { $unset: { cover: 1 } };
    } else {
      if (!mongoose.isValidObjectId(templateId)) return fail(res, 404, "COVER_TEMPLATE_NOT_FOUND", "That banner could not be found.");
      const template = await BannerTemplate.findById(templateId).select("isActive archivedAt").lean();
      if (!template) return fail(res, 404, "COVER_TEMPLATE_NOT_FOUND", "That banner could not be found.");
      if (!template.isActive || template.archivedAt) return fail(res, 409, "COVER_TEMPLATE_INACTIVE", "That banner is no longer available.");
      update = { $set: { "cover.kind": "template", "cover.templateId": template._id, "cover.updatedAt": new Date() } };
    }

    const updated = await User.findByIdAndUpdate(userId, update, { new: true }).select("cover");
    return res.json({ cover: await resolveCover(updated?.cover) });
  } catch (error) {
    return sendError(res, error, "Failed to save the banner");
  }
};

// ---------------------------------------------------------------------------
// Employer image upload (COVER_PHOTO_PLAN.md sections 5 and 6)
// ---------------------------------------------------------------------------

const storageService = require("../services/storageService");
const { matchesDeclaredType } = require("../middleware/upload");
const { processCoverImage, sanitizeCropData, CoverImageError } = require("../services/coverImageService");
const { logAuditEvent } = require("../services/auditService");
const { createNotificationForUser } = require("../services/notificationService");
const logger = require("../utils/logger");

const MESSAGES = {
  COVER_EMPLOYER_NOT_VERIFIED: "Only verified employers can upload their own cover.",
  COVER_UPLOAD_REVOKED: "Your cover upload right was ended after repeated removals. Contact PESO to restore it.",
  COVER_IMAGE_REQUIRED: "Choose an image to upload.",
  COVER_IMAGE_TYPE: "The cover must be a JPG, PNG or WebP image.",
  COVER_IMAGE_TOO_LARGE: "The cover must be 3 MB or smaller.",
  COVER_IMAGE_DIMENSIONS: "The cover must be at least 1200 by 300 pixels and at most 8000 by 8000.",
  COVER_IMAGE_PROCESSING_FAILED: "We could not read that image. Try another file.",
  COVER_UPLOAD_FAILED: "We could not store the cover. Please try again.",
};

const removeStored = async (...values) => {
  await Promise.allSettled(values.filter(Boolean).map((value) => storageService.remove(value)));
};

// POST /employer/cover/image  (multipart field "cover", optional JSON field "cropData")
exports.uploadCoverImage = async (req, res) => {
  const uploaded = [];
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId).select("role verificationStatus cover coverUploadRevoked isActive");
    if (!user || user.isActive === false) return fail(res, 403, "COVER_NOT_ALLOWED", "This account cannot change its cover.");
    if (normalizeRole(user.role) !== "employer") return fail(res, 403, "COVER_NOT_ALLOWED", "Only employers can upload a cover image.");
    if (user.verificationStatus !== "verified") return fail(res, 403, "COVER_EMPLOYER_NOT_VERIFIED", MESSAGES.COVER_EMPLOYER_NOT_VERIFIED);
    if (user.coverUploadRevoked) return fail(res, 403, "COVER_UPLOAD_REVOKED", MESSAGES.COVER_UPLOAD_REVOKED);

    const file = req.file;
    if (!file || !file.buffer) return fail(res, 400, "COVER_IMAGE_REQUIRED", MESSAGES.COVER_IMAGE_REQUIRED);
    if (!matchesDeclaredType(file.buffer, file.mimetype)) return fail(res, 400, "COVER_IMAGE_TYPE", MESSAGES.COVER_IMAGE_TYPE);

    let processed;
    try {
      processed = await processCoverImage(file.buffer);
    } catch (error) {
      if (error instanceof CoverImageError) return fail(res, error.status, error.code, MESSAGES[error.code] || error.message);
      throw error;
    }

    let cropData;
    try {
      cropData = sanitizeCropData(typeof req.body?.cropData === "string" ? JSON.parse(req.body.cropData) : req.body?.cropData);
    } catch {
      cropData = undefined;
    }

    // Upload both variants. If either upload fails, whatever was stored is removed again.
    let large;
    let small;
    try {
      large = await storageService.upload({ buffer: processed.large.buffer, mimetype: "image/webp" }, { category: "cover", ownerId: String(userId) });
      uploaded.push(large.storedValue);
      small = await storageService.upload({ buffer: processed.small.buffer, mimetype: "image/webp" }, { category: "cover", ownerId: String(userId) });
      uploaded.push(small.storedValue);
    } catch (error) {
      await removeStored(...uploaded);
      uploaded.length = 0;
      logger.error("Cover upload failed", { error: error.message });
      return fail(res, 502, "COVER_UPLOAD_FAILED", MESSAGES.COVER_UPLOAD_FAILED);
    }

    // A failed save throws to the outer catch, which removes both new files.
    {
      const image = {
        url: large.storedValue,
        thumbUrl: small.storedValue,
        storedValue: large.storedValue,
        thumbStoredValue: small.storedValue,
        width: processed.large.width,
        height: processed.large.height,
        bytes: processed.large.bytes + processed.small.bytes,
        ...(cropData ? { cropData } : {}),
        placeholderColor: processed.placeholderColor || undefined,
        uploadedAt: new Date(),
        status: "published",
      };

      const saved = await User.findByIdAndUpdate(
        userId,
        { $set: { "cover.kind": "image", "cover.image": image, "cover.updatedAt": new Date() } },
        { new: true }
      ).select("cover");

      // The new files belong to a saved record now. Clean the replaced ones up (best effort).
      const previous = user.cover?.image;
      uploaded.length = 0;
      await removeStored(previous?.storedValue, previous?.thumbStoredValue);
      return res.json({ cover: await resolveCover(saved?.cover) });
    }
  } catch (error) {
    await removeStored(...uploaded);
    return sendError(res, error, "Failed to upload the cover");
  }
};

// DELETE /employer/cover/image: removes the image, keeps the template choice.
exports.removeCoverImage = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId).select("role cover");
    if (!user) return fail(res, 404, "NOT_FOUND", "User not found.");
    if (normalizeRole(user.role) !== "employer") return fail(res, 403, "COVER_NOT_ALLOWED", "Only employers have a cover image.");

    const image = user.cover?.image;
    if (image && (image.storedValue || image.thumbStoredValue || image.url)) {
      const update = { $unset: { "cover.image": 1 }, $set: { "cover.updatedAt": new Date() } };
      if (user.cover?.templateId) update.$set["cover.kind"] = "template";
      else update.$unset["cover.kind"] = 1;
      const saved = await User.findByIdAndUpdate(userId, update, { new: true }).select("cover");
      await removeStored(image.storedValue, image.thumbStoredValue);
      return res.json({ cover: await resolveCover(saved?.cover) });
    }
    return res.json({ cover: await resolveCover(user.cover) });
  } catch (error) {
    return sendError(res, error, "Failed to remove the cover");
  }
};

// ---------------------------------------------------------------------------
// Moderation: staff remove an employer's uploaded cover; two removals end the
// upload right until staff restore it.
// ---------------------------------------------------------------------------

const REMOVALS_BEFORE_REVOKE = 2;
const reasonFrom = (body) => String(body?.reason || "").trim();

// Removes the stored cover image of one account, marks it removed_by_staff, counts
// the removal and revokes the upload right at the limit. Shared by the admin
// route and the report resolution. Returns { removed, count, revoked }.
const removeCoverByStaff = async ({ req, targetId, reason }) => {
  const user = await User.findById(targetId).select("role cover coverRemovalCount coverUploadRevoked");
  const image = user?.cover?.image;
  if (!user || !image || image.status === "removed_by_staff" || !(image.storedValue || image.url)) return { removed: false };

  const count = (user.coverRemovalCount || 0) + 1;
  const revoked = count >= REMOVALS_BEFORE_REVOKE || Boolean(user.coverUploadRevoked);
  const $set = {
    "cover.image.status": "removed_by_staff",
    "cover.image.removedAt": new Date(),
    "cover.image.removedBy": req.user._id || req.user.id,
    "cover.image.removedReason": reason,
    "cover.updatedAt": new Date(),
    coverUploadRevoked: revoked,
  };
  const $unset = { "cover.image.url": 1, "cover.image.thumbUrl": 1, "cover.image.storedValue": 1, "cover.image.thumbStoredValue": 1 };
  if (user.cover?.templateId) $set["cover.kind"] = "template";
  else $unset["cover.kind"] = 1;

  await User.updateOne({ _id: targetId }, { $set, $unset, $inc: { coverRemovalCount: 1 } });
  await removeStored(image.storedValue, image.thumbStoredValue);

  await logAuditEvent({
    req,
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "admin.cover.removed",
    targetUserId: user._id,
    targetType: "user",
    targetId: String(user._id),
    severity: "warning",
    metadata: { reason, removalCount: count, uploadRevoked: revoked },
  });

  try {
    await createNotificationForUser({
      recipientId: user._id,
      actorId: req.user.id,
      type: "admin_action",
      title: "Your cover image was removed",
      message: revoked
        ? `Your cover image was removed: ${reason}. You can no longer upload your own cover, but you can still choose a template. Contact PESO to ask for it to be restored.`
        : `Your cover image was removed: ${reason}. A second removal ends your right to upload your own cover.`,
      relatedEntityType: "user",
      relatedEntityId: user._id,
      io: req.app && req.app.get ? req.app.get("io") : null,
    });
  } catch (error) {
    logger.warn("Cover removal notification failed", { error: error.message });
  }
  return { removed: true, count, revoked };
};
exports.removeCoverByStaff = removeCoverByStaff;

// POST /admin/users/:id/cover/remove  body { reason }
exports.adminRemoveCover = async (req, res) => {
  try {
    const reason = reasonFrom(req.body);
    if (reason.length < 5) return fail(res, 400, "REASON_REQUIRED", "A reason of at least 5 characters is required.");
    const target = await User.findById(req.params.id).select("role");
    if (!target || normalizeRole(target.role) !== "employer") return fail(res, 404, "NOT_FOUND", "Employer not found.");
    const result = await removeCoverByStaff({ req, targetId: req.params.id, reason });
    if (!result.removed) return fail(res, 409, "COVER_NO_IMAGE", "This account has no uploaded cover image.");
    return res.json({ ok: true, removalCount: result.count, uploadRevoked: result.revoked });
  } catch (error) {
    return sendError(res, error, "Failed to remove the cover");
  }
};

// POST /admin/users/:id/cover/restore-upload  body { reason }
exports.adminRestoreCoverUpload = async (req, res) => {
  try {
    const reason = reasonFrom(req.body);
    if (reason.length < 5) return fail(res, 400, "REASON_REQUIRED", "A reason of at least 5 characters is required.");
    const target = await User.findById(req.params.id).select("role coverRemovalCount coverUploadRevoked");
    if (!target || normalizeRole(target.role) !== "employer") return fail(res, 404, "NOT_FOUND", "Employer not found.");
    if (!target.coverUploadRevoked) return fail(res, 409, "COVER_UPLOAD_NOT_REVOKED", "This account can already upload a cover.");

    // The removal count stays for the record: a further removal revokes the right again.
    await User.updateOne({ _id: target._id }, { $set: { coverUploadRevoked: false } });
    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: req.user.role,
      action: "admin.cover.upload_restored",
      targetUserId: target._id,
      targetType: "user",
      targetId: String(target._id),
      severity: "info",
      metadata: { reason, removalCount: target.coverRemovalCount || 0 },
    });
    try {
      await createNotificationForUser({
        recipientId: target._id,
        actorId: req.user.id,
        type: "admin_action",
        title: "You can upload a cover image again",
        message: `PESO restored your right to upload your own cover image. ${reason}`,
        relatedEntityType: "user",
        relatedEntityId: target._id,
        io: req.app && req.app.get ? req.app.get("io") : null,
      });
    } catch (error) {
      logger.warn("Cover restore notification failed", { error: error.message });
    }
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error, "Failed to restore the cover upload right");
  }
};
