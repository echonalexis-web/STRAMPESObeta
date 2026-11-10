const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const storageService = require("../services/storageService");
const { LIMITS: templateImageLimits, PROFILES: imageProfiles } = require("../services/bannerTemplateImageService");
const avatarImageLimits = imageProfiles.avatar;

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

// Employer profile cover: one image, 3 MB. The real checks (signature, sharp
// format, dimensions) run in the controller and services/coverImageService.js.
const COVER_FILE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const COVER_MAX_FILE_SIZE = 3 * 1024 * 1024; // 3MB
const coverUpload = multer({
  storage: memory,
  limits: { fileSize: COVER_MAX_FILE_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    if (COVER_FILE_TYPES.includes(file.mimetype)) return cb(null, true);
    const error = new Error("Cover must be a JPG, PNG, or WEBP image");
    error.code = "COVER_IMAGE_TYPE";
    return cb(error, false);
  },
});

// Runs coverUpload for the "cover" field and turns multer errors into the cover
// error codes the client translates.
const singleCoverUpload = (req, res, next) =>
  coverUpload.single("cover")(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ code: "COVER_IMAGE_TOO_LARGE", message: "The cover must be 3 MB or smaller." });
    }
    if (error.code === "COVER_IMAGE_TYPE") {
      return res.status(400).json({ code: "COVER_IMAGE_TYPE", message: "The cover must be a JPG, PNG or WebP image." });
    }
    return res.status(400).json({ code: "COVER_IMAGE_REQUIRED", message: "Choose an image to upload." });
  });

// Superadmin banner template and avatar preset uploads: SVG or PNG. The real checks
// (content sniffing, SVG safety, dimensions, ratio) run in
// services/bannerTemplateImageService.js; this only bounds the request. `prefix` is
// the error-code prefix of the kind (TEMPLATE_IMAGE_ or AVATAR_IMAGE_).
const TEMPLATE_IMAGE_MIMES = ["image/png", "image/svg+xml"];

const templateUploadErrors = (prefix, next, res) => (error) => {
  if (!error) return next();
  if (error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ code: `${prefix}TOO_LARGE`, message: "The image is too large." });
  }
  if (error.code === `${prefix}TYPE`) {
    return res.status(400).json({ code: `${prefix}TYPE`, message: "The image must be an SVG or PNG." });
  }
  return res.status(400).json({ code: `${prefix}REQUIRED`, message: "Choose an SVG or PNG image to upload." });
};

const buildTemplateUpload = ({ prefix, maxBytes, files, fieldSize }) =>
  multer({
    storage: memory,
    limits: { fileSize: maxBytes, files, fields: 8, fieldSize, parts: files + 12 },
    fileFilter: (req, file, cb) => {
      if (TEMPLATE_IMAGE_MIMES.includes(String(file.mimetype).toLowerCase())) return cb(null, true);
      const error = new Error("The image must be an SVG or PNG");
      error.code = `${prefix}TYPE`;
      return cb(error, false);
    },
  });

const bannerUpload = buildTemplateUpload({ prefix: "TEMPLATE_IMAGE_", maxBytes: templateImageLimits.maxBytes, files: 1, fieldSize: 2048 });
const avatarPresetUpload = buildTemplateUpload({ prefix: "AVATAR_IMAGE_", maxBytes: avatarImageLimits.maxBytes, files: 1, fieldSize: 2048 });
// The built-in install sends a small manifest (JSON in a field) and up to 40 files.
const BUILTIN_MAX_FILES = 40;
const bannerBuiltInUpload = buildTemplateUpload({ prefix: "TEMPLATE_IMAGE_", maxBytes: templateImageLimits.maxBytes, files: BUILTIN_MAX_FILES, fieldSize: 128 * 1024 });
const avatarBuiltInUpload = buildTemplateUpload({ prefix: "AVATAR_IMAGE_", maxBytes: avatarImageLimits.maxBytes, files: BUILTIN_MAX_FILES, fieldSize: 128 * 1024 });

const singleTemplateImageUpload = (req, res, next) => bannerUpload.single("image")(req, res, templateUploadErrors("TEMPLATE_IMAGE_", next, res));
const singleAvatarPresetImageUpload = (req, res, next) => avatarPresetUpload.single("image")(req, res, templateUploadErrors("AVATAR_IMAGE_", next, res));
const bannerBuiltInImagesUpload = (req, res, next) => bannerBuiltInUpload.array("images", BUILTIN_MAX_FILES)(req, res, templateUploadErrors("TEMPLATE_IMAGE_", next, res));
const avatarBuiltInImagesUpload = (req, res, next) => avatarBuiltInUpload.array("images", BUILTIN_MAX_FILES)(req, res, templateUploadErrors("AVATAR_IMAGE_", next, res));

// (fieldName[, legacyPath]) — legacyPath is ignored, kept for call-site compatibility
const singleFileUpload = (fieldName) => mk(1).single(fieldName);

/* -------------------------------------------------------------------------- */
/* content sniffing — `file.mimetype` is just a client-supplied header and    */
/* trivially spoofed (e.g. a script renamed to "resume.pdf"); this checks the */
/* file's actual leading bytes against what its declared type promises.      */
/* -------------------------------------------------------------------------- */
const MAGIC_BYTE_SIGNATURES = {
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/jpg": [[0xff, 0xd8, 0xff]],
  "image/png": [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  "image/gif": [
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
  ],
  "application/pdf": [[0x25, 0x50, 0x44, 0x46]],
  "application/msword": [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]], // legacy OLE/CFB container
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    [0x50, 0x4b, 0x03, 0x04], // .docx is a ZIP container
    [0x50, 0x4b, 0x05, 0x06],
    [0x50, 0x4b, 0x07, 0x08],
  ],
};

const bufferStartsWith = (buffer, signature) =>
  signature.every((byte, index) => buffer[index] === byte);

const matchesDeclaredType = (buffer, mimetype) => {
  if (!buffer || buffer.length === 0) return false;
  // WEBP's signature isn't at offset 0 (it's a RIFF container: "RIFF" +
  // 4-byte size + "WEBP"), so it needs its own check rather than fitting the
  // simple leading-bytes table above.
  if (mimetype === "image/webp") {
    return (
      buffer.length >= 12 &&
      bufferStartsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
      bufferStartsWith(buffer.subarray(8, 12), [0x57, 0x45, 0x42, 0x50])
    );
  }
  const signatures = MAGIC_BYTE_SIGNATURES[mimetype];
  // No signature registered for this (already allow-listed) type — nothing
  // to compare against, so don't block it here.
  if (!signatures) return true;
  return signatures.some((signature) => bufferStartsWith(buffer, signature));
};

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
    if (!matchesDeclaredType(file.buffer, file.mimetype)) {
      return res.status(400).json({ message: `File ${file.originalname} does not match its declared file type` });
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

// On an error response, remove anything already persisted for this request —
// but only if the database write that references those files did NOT commit.
// A controller sets `req.uploadsCommitted = true` right after its write
// succeeds; from then on the files belong to a saved record, and a later
// failure (e.g. a notification) must never delete them.
const cleanupUploadedFiles = (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (data) => {
    const isError = res.statusCode >= 400 || (data && data.error);
    if (isError && !req.uploadsCommitted && Array.isArray(req.uploadedObjects) && req.uploadedObjects.length > 0) {
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
  coverUpload,
  singleCoverUpload,
  COVER_MAX_FILE_SIZE,
  singleTemplateImageUpload,
  singleAvatarPresetImageUpload,
  bannerBuiltInImagesUpload,
  avatarBuiltInImagesUpload,
  singleFileUpload,
  validateFile,
  matchesDeclaredType,
  persistUploads,
  persistFields,
  cleanupUploadedFiles,
};
