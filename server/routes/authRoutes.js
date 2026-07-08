const router = require("express").Router();
const multer = require("multer");
const path = require("path");
const { 
    register, 
    login, 
    getMe, 
    getProfile,
    updateProfile,
    deleteAccount,
    registerEmployer, 
    generateInviteCode, 
    promoteToEmployer 
} = require("../controllers/authController");
const { verifyToken: protect, isAdmin } = require("../middleware/auth");
const {
  sanitizeRequestBody,
  sanitizeQueryParams,
  validateUserRegistration,
  validateUserLogin,
  validateRequest
} = require("../middleware/validation");
const { detectMaliciousPayload, sensitiveOperationLimiter } = require("../middleware/security");

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../uploads/profiles"));
  },
  filename: (req, file, cb) => {
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '');
    cb(null, Date.now() + "-" + sanitizedName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /pdf|doc|docx|jpeg|jpg|png/;
    cb(null, allowedTypes.test(file.mimetype));
  }
});

const profileUpload = multer({ dest: path.join(__dirname, "../uploads") });

// Public routes
router.post(
  "/register",
  sanitizeRequestBody,
  detectMaliciousPayload,
  validateUserRegistration,
  validateRequest,
  register
);

router.post(
  "/login",
  sanitizeRequestBody,
  detectMaliciousPayload,
  validateUserLogin,
  validateRequest,
  login
);

router.post(
  "/register/employer",
  sanitizeRequestBody,
  detectMaliciousPayload,
  validateUserRegistration,
  validateRequest,
  registerEmployer
);

// Protected routes
router.get("/me", protect, getMe);
router.get("/profile", protect, getProfile);

router.put(
  "/profile",
  protect,
  sanitizeRequestBody,
  detectMaliciousPayload,
  profileUpload.fields([
    { name: "resumeFile", maxCount: 1 },
    { name: "validIdFile", maxCount: 1 },
    { name: "businessPermit", maxCount: 1 },
    { name: "registrationDoc", maxCount: 1 },
  ]),
  updateProfile
);

router.patch(
  "/me",
  protect,
  sanitizeRequestBody,
  detectMaliciousPayload,
  upload.fields([
    { name: "resume", maxCount: 1 },
    { name: "supportingDocument", maxCount: 1 },
  ]),
  updateProfile
);

router.delete("/profile", protect, deleteAccount);

// Admin-only routes
router.post("/invite", protect, isAdmin, generateInviteCode);
router.patch("/promote/:userId", protect, isAdmin, promoteToEmployer);

module.exports = router;