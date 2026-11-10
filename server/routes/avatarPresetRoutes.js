const router = require("express").Router();
const { verifyToken: protect, isSuperadmin } = require("../middleware/auth");
const { sanitizeRequestBody, validateMongoId } = require("../middleware/validation");
const { detectMaliciousPayload } = require("../middleware/security");
const { singleAvatarPresetImageUpload, avatarBuiltInImagesUpload } = require("../middleware/upload");
const { buildTemplateUploadLimiter } = require("../middleware/bannerTemplateLimiter");
const c = require("../controllers/avatarPresetController");

// Mounted at /avatar-presets: any signed-in user reads the active list.
const publicRouter = require("express").Router();
publicRouter.get("/", protect, c.listForUsers);

// Mounted at /superadmin/avatar-presets: superadmin only. Create and update are
// multipart (field "image" plus name, nameFil, isActive); same limiter as banners.
const uploadLimiter = buildTemplateUploadLimiter();
router.use(protect, isSuperadmin);
router.get("/", c.listForSuperadmin);
router.post("/", uploadLimiter, singleAvatarPresetImageUpload, sanitizeRequestBody, detectMaliciousPayload, c.create);
router.post("/builtins", uploadLimiter, avatarBuiltInImagesUpload, sanitizeRequestBody, c.installBuiltIns);
// "order" must be registered before "/:id" so it is not read as an id.
router.put("/order", sanitizeRequestBody, c.reorder);
router.put("/:id", validateMongoId("id"), uploadLimiter, singleAvatarPresetImageUpload, sanitizeRequestBody, detectMaliciousPayload, c.update);
router.patch("/:id/active", validateMongoId("id"), sanitizeRequestBody, c.setActive);
router.delete("/:id", validateMongoId("id"), c.remove);

module.exports = { publicRouter, superadminRouter: router };
