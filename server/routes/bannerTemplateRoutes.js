const router = require("express").Router();
const { verifyToken: protect, isSuperadmin } = require("../middleware/auth");
const { sanitizeRequestBody, validateMongoId } = require("../middleware/validation");
const { detectMaliciousPayload } = require("../middleware/security");
const { singleTemplateImageUpload } = require("../middleware/upload");
const { buildTemplateUploadLimiter } = require("../middleware/bannerTemplateLimiter");
const c = require("../controllers/bannerTemplateController");

// Mounted at /banner-templates: any signed-in user reads the active list.
const publicRouter = require("express").Router();
publicRouter.get("/", protect, c.listForUsers);

// Mounted at /superadmin/banner-templates: superadmin only.
// Create and update are multipart (field "image" plus name, nameFil, isActive). The
// limiter runs before multer so a refused request never buffers a file.
const uploadLimiter = buildTemplateUploadLimiter();
router.use(protect, isSuperadmin);
router.get("/", c.listForSuperadmin);
router.post("/", uploadLimiter, singleTemplateImageUpload, sanitizeRequestBody, detectMaliciousPayload, c.create);
// "order" must be registered before "/:id" so it is not read as an id.
router.put("/order", sanitizeRequestBody, c.reorder);
router.put("/:id", validateMongoId("id"), uploadLimiter, singleTemplateImageUpload, sanitizeRequestBody, detectMaliciousPayload, c.update);
router.patch("/:id/active", validateMongoId("id"), sanitizeRequestBody, c.setActive);
router.patch("/:id/default", validateMongoId("id"), c.setDefault);
router.delete("/:id", validateMongoId("id"), c.remove);

module.exports = { publicRouter, superadminRouter: router };
