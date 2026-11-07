const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const controller = require("../controllers/accountRecoveryController");
const { documentsUpload, validateFile, cleanupUploadedFiles, persistFields } = require("../middleware/upload");
const { sensitiveOperationLimiter, detectMaliciousPayload } = require("../middleware/security");
const { verifyToken, isAdmin, isSuperadmin } = require("../middleware/auth");
const { sanitizeRequestBody, validateMongoId, validateRequest } = require("../middleware/validation");
const { hasOcrCapacity, reserveOcrSlot } = require("../services/idOcrService");

const uploadLimit = rateLimit({ windowMs: 86400000, limit: () => Math.max(1, Math.min(10, Number(process.env.RECOVERY_REQUEST_DAILY_LIMIT) || 3)), standardHeaders: "draft-7", legacyHeaders: false });
router.post("/", uploadLimit, (req, res, next) => hasOcrCapacity() ? next() : res.status(503).json({ message: "Please try again shortly" }),
  documentsUpload.fields([{ name: "governmentIdFile", maxCount: 1 }, { name: "selfieFile", maxCount: 1 }]), validateFile,
  (req, res, next) => {
    const selfie = req.files?.selfieFile?.[0];
    if (selfie && !["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(selfie.mimetype)) return res.status(400).json({ message: "Selfie must be a JPG, PNG or WEBP image" });
    next();
  }, reserveOcrSlot, cleanupUploadedFiles, persistFields({ governmentIdFile: "validId", selfieFile: "recoverySelfie" }), sanitizeRequestBody, detectMaliciousPayload, controller.submit);
router.post("/verify-contact", sensitiveOperationLimiter(20, 3600000), sanitizeRequestBody, controller.verifyContact);
router.post("/finish", sensitiveOperationLimiter(5, 3600000), sanitizeRequestBody, controller.finish);
router.use(verifyToken, isAdmin);
router.get("/", controller.list);
router.get("/report", isSuperadmin, controller.report);
router.get("/:id", validateMongoId("id"), validateRequest, controller.detail);
router.post("/:id/review", sensitiveOperationLimiter(10, 3600000), validateMongoId("id"), validateRequest, sanitizeRequestBody, detectMaliciousPayload, controller.review);
router.post("/:id/resend", sensitiveOperationLimiter(10, 3600000), validateMongoId("id"), validateRequest, sanitizeRequestBody, detectMaliciousPayload, controller.resend);
module.exports = router;
