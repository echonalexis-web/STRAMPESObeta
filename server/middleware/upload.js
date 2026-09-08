const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const storageService = require("../services/storageService");

// Allowed upload MIME types -> canonical extension
const ALLOWED_FILE_TYPES = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// Profile pictures are stricter than generic uploads: images only, smaller cap.
const AVATAR_FILE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const AVATAR_MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

const fileFilter = (req, file, cb) => {
  if (Object.keys(ALLOWED_FILE_TYPES).includes(file.mimetype)) {
    file.originalname = path.basename(file.originalname).replace(/[^a-zA-Z0-9.-]/g, "");
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Allowed: ${Object.keys(ALLOWED_FILE_TYPES).join(", ")}`), false);
  }
};

// Kept for callers that still import it (server.js legacy static config)
const generateSecureFilename = (file) => {
  const extension = ALLOWED_FILE_TYPES[file.mimetype] || path.extname(file.originalname || "");
  const sanitizedBase = path
    .basename(file.originalname || "file", extension)
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 30);
  return `${uuidv4()}_${sanitizedBase}${extension}`;
};

/* -------------------------------------------------------------------------- */
/* multer — memory storage only; persistence happens in persistUploads        */
/* -------------------------------------------------------------------------- */
const memory = multer.memoryStorage();
const mk = (files) => multer({ storage: memory, limits: { fileSize: MAX_FILE_SIZE, files }, fileFilter });

const profileUpload = mk(1);
const jobAttachmentUpload = mk(5);
const documentsUpload = mk(4);

// Image-only uploader for profile pictures.
const avatarFileFilter = (req, file, cb) => {
  if (AVATAR_FILE_TYPES.includes(file.mimetype)) {
    file.originalname = path.basename(file.originalname).replace(/[^a-zA-Z0-9.-]/g, "");
    cb(null, true);
  } else {
    cb(new Error("Profile picture must be a JPG, PNG, or WEBP image"), false);
  }
};

const avatarUpload = multer({
  storage: memory,
  limits: { fileSize: AVATAR_MAX_FILE_SIZE, files: 1 },
  fileFilter: avatarFileFilter,
});

// (fieldName[, legacyPath]) — legacyPath is ignored, kept for call-site compatibility
const singleFileUpload = (fieldName) => mk(1).single(fieldName);

/* -------------------------------------------------------------------------- */
/* validation                                                                 */
/* -------------------------------------------------------------------------- */
const collectFiles = (req) => {
  if (req.file) return [req.file];
  if (Array.isArray(req.files)) return req.files;
  if (req.files && typeof req.files === "object") return Object.values(req.files).flat();
  return [];
};

const validateFile = (req, res, next) => {
  const files = collectFiles(req);
  if (files.length === 0) {
    return res.status(400).json({ message: "No file uploaded" });
  }
  const dangerous = [".exe", ".bat", ".sh", ".php", ".asp", ".js", ".html", ".htm"];
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      return res.status(400).json({ message: `File ${file.originalname} exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` });
    }
    if (!ALLOWED_FILE_TYPES[file.mimetype]) {
      return res.status(400).json({ message: `File ${file.originalname} has an invalid type` });
    }
    if (dangerous.includes(path.extname(file.originalname || "").toLowerCase())) {
      return res.status(400).json({ message: `File type is not allowed` });
    }
  }
  return next();
};

/* -------------------------------------------------------------------------- */
/* persistence — upload buffers to the configured storage backend             */
/* -------------------------------------------------------------------------- */

const rollback = (req) => {
  if (Array.isArray(req.uploadedObjects) && req.uploadedObjects.length > 0) {
    Promise.allSettled(req.uploadedObjects.map((value) => storageService.remove(value)));
    req.uploadedObjects = [];
  }
};

// Every file on the request goes to one category. Sets file.storedValue.
const persistUploads = (category) => async (req, res, next) => {
  try {
    req.uploadedObjects = req.uploadedObjects || [];
    for (const file of collectFiles(req)) {
      const result = await storageService.upload(file, { category, ownerId: req.user?.id });
      file.storedValue = result.storedValue;
      req.uploadedObjects.push(result.storedValue);
    }
    return next();
  } catch (err) {
    rollback(req);
    return res.status(502).json({ message: "File storage upload failed. Please try again." });
  }
};

// Per-field category map, e.g. { resume: "applicationResume", coverLetterFile: "applicationCover" }
const persistFields = (fieldCategoryMap) => async (req, res, next) => {
  try {
    req.uploadedObjects = req.uploadedObjects || [];
    const files = req.files && !Array.isArray(req.files) ? req.files : {};
    for (const [field, category] of Object.entries(fieldCategoryMap)) {
      const list = files[field];
      if (!Array.isArray(list)) continue;
      for (const file of list) {
        const result = await storageService.upload(file, { category, ownerId: req.user?.id });
        file.storedValue = result.storedValue;
        req.uploadedObjects.push(result.storedValue);
      }
    }
    return next();
  } catch (err) {
    rollback(req);
    return res.status(502).json({ message: "File storage upload failed. Please try again." });
  }
};

// On an error response, remove anything already persisted for this request.
const cleanupUploadedFiles = (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (data) => {
    const isError = res.statusCode >= 400 || (data && data.error);
    if (isError && Array.isArray(req.uploadedObjects) && req.uploadedObjects.length > 0) {
      Promise.allSettled(req.uploadedObjects.map((value) => storageService.remove(value)));
    }
    return originalJson(data);
  };
  next();
};

module.exports = {
  ALLOWED_FILE_TYPES,
  MAX_FILE_SIZE,
  AVATAR_FILE_TYPES,
  AVATAR_MAX_FILE_SIZE,
  fileFilter,
  generateSecureFilename,
  profileUpload,
  jobAttachmentUpload,
  documentsUpload,
  avatarUpload,
  singleFileUpload,
  validateFile,
  persistUploads,
  persistFields,
  cleanupUploadedFiles,
};
