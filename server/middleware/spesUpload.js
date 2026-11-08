const multer = require("multer");
const path = require("path");
const { matchesDeclaredType } = require("./upload");
const {
  ALL_SLOTS,
  SPES_ALLOWED_MIME,
  SPES_DOC_MAX_BYTES,
  SPES_COVER_MIME,
  SPES_COVER_MAX_BYTES,
  SPES_MAX_FILES_PER_APPLICATION,
} = require("../utils/spesDocuments");

const mb = (bytes) => bytes / 1024 / 1024;

// SPES document uploads: one file per typed slot, PDF/JPG/PNG only, 5 MB each, and at most
// SPES_MAX_FILES_PER_APPLICATION files per request. Errors come back as stable codes the
// client translates, never raw multer messages: 413 for too large, 415 for the wrong type,
// 400 for everything else.
const filter = (req, file, cb) => {
  if (!ALL_SLOTS.includes(file.fieldname) && file.fieldname !== "file") {
    return cb(Object.assign(new Error("unexpected field"), { code: "SPES_FILE_UNEXPECTED" }));
  }
  if (!SPES_ALLOWED_MIME.includes(file.mimetype)) {
    return cb(Object.assign(new Error("bad type"), { code: "SPES_FILE_TYPE" }));
  }
  file.originalname = path.basename(file.originalname).replace(/[^a-zA-Z0-9.-]/g, "");
  return cb(null, true);
};

const base = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SPES_DOC_MAX_BYTES, files: SPES_MAX_FILES_PER_APPLICATION },
  fileFilter: filter,
});

const wrap = (handler) => (req, res, next) =>
  handler(req, res, (err) => {
    if (!err) return next();
    const map = {
      LIMIT_FILE_SIZE: [413, "SPES_FILE_TOO_LARGE", `Each file must be ${mb(SPES_DOC_MAX_BYTES)} MB or smaller.`],
      LIMIT_UNEXPECTED_FILE: [400, "SPES_FILE_UNEXPECTED", "An unexpected file was uploaded."],
      LIMIT_FILE_COUNT: [400, "SPES_TOO_MANY_FILES", `You can upload at most ${SPES_MAX_FILES_PER_APPLICATION} files.`],
      SPES_FILE_TYPE: [415, "SPES_FILE_TYPE", "Only PDF, JPG, or PNG files are accepted."],
      SPES_FILE_UNEXPECTED: [400, "SPES_FILE_UNEXPECTED", "An unexpected file was uploaded."],
    };
    const [status, code, message] = map[err.code] || [400, "SPES_UPLOAD_FAILED", "The upload could not be processed."];
    return res.status(status).json({ code, message });
  });

// Apply: one file per slot, each in its own multipart field named after the slot.
const spesSlotsUpload = wrap(base.fields(ALL_SLOTS.map((name) => ({ name, maxCount: 1 }))));
// Replace one document: a single `file` field.
const spesSingleUpload = wrap(base.single("file"));

// Magic-byte check: the declared mimetype is only a client header. Runs before
// anything is persisted, so a spoofed file is never stored.
const validateSpesFiles = (req, res, next) => {
  const files = req.file ? [req.file] : Object.values(req.files || {}).flat();
  for (const file of files) {
    if (!matchesDeclaredType(file.buffer, file.mimetype)) {
      return res.status(415).json({
        code: "SPES_FILE_TYPE",
        message: "Only PDF, JPG, or PNG files are accepted.",
      });
    }
  }
  return next();
};

// Cover image for a posting: shown on cards and the detail page, so it is public and
// images only (JPG, PNG, WEBP), smaller than a document.
const COVER_MAX_BYTES = SPES_COVER_MAX_BYTES;
const COVER_MIME = SPES_COVER_MIME;

const coverBase = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: COVER_MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!COVER_MIME.includes(file.mimetype)) {
      return cb(Object.assign(new Error("bad type"), { code: "SPES_COVER_TYPE" }));
    }
    file.originalname = path.basename(file.originalname).replace(/[^a-zA-Z0-9.-]/g, "");
    return cb(null, true);
  },
});

const spesCoverUpload = (req, res, next) =>
  coverBase.single("cover")(req, res, (err) => {
    if (!err) {
      if (!req.file) {
        return res.status(400).json({ code: "SPES_COVER_MISSING", message: "Choose an image to upload." });
      }
      return next();
    }
    if (err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(413)
        .json({ code: "SPES_COVER_TOO_LARGE", message: `The image must be ${mb(COVER_MAX_BYTES)} MB or smaller.` });
    }
    if (err.code === "SPES_COVER_TYPE" || err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(415).json({ code: "SPES_COVER_TYPE", message: "Only JPG, PNG, or WEBP images are accepted." });
    }
    return res.status(400).json({ code: "SPES_UPLOAD_FAILED", message: "The upload could not be processed." });
  });

// The declared mimetype is only a client header; check the real leading bytes.
const validateSpesCover = (req, res, next) => {
  if (!req.file || !matchesDeclaredType(req.file.buffer, req.file.mimetype)) {
    return res.status(415).json({ code: "SPES_COVER_TYPE", message: "Only JPG, PNG, or WEBP images are accepted." });
  }
  return next();
};

module.exports = { spesSlotsUpload, spesSingleUpload, validateSpesFiles, spesCoverUpload, validateSpesCover, COVER_MAX_BYTES };
