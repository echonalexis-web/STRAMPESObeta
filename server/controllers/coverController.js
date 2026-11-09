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
