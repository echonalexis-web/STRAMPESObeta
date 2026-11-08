// Upload limits for SPES screens: the single source of truth on the client.
// Mirrors server/utils/spesDocuments.js (SPES_DOC_MAX_BYTES, SPES_COVER_MAX_BYTES,
// SPES_MAX_FILES_PER_APPLICATION, the allowed MIME lists); change both together.
// The server stays the authority: these checks only give instant feedback.

const MB = 1024 * 1024;

export const SPES_DOC_LIMITS = Object.freeze({
  maxBytes: 5 * MB,
  mimes: ["application/pdf", "image/jpeg", "image/png"],
  accept: ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png",
  typeError: "SPES_FILE_TYPE",
  sizeError: "SPES_FILE_TOO_LARGE",
});

export const SPES_COVER_LIMITS = Object.freeze({
  maxBytes: 3 * MB,
  mimes: ["image/jpeg", "image/png", "image/webp"],
  accept: ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp",
  typeError: "SPES_COVER_TYPE",
  sizeError: "SPES_COVER_TOO_LARGE",
});

// One application carries at most this many files (the academic and OSY slots swap).
export const SPES_MAX_FILES_PER_APPLICATION = 4;

export const bytesToMb = (bytes) => Math.round((bytes / MB) * 10) / 10;

// Human size for a chosen file: "840 KB", "2.4 MB".
export const formatFileSize = (bytes) => {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
};

// Returns the error code for a file that breaks `limits`, or null when it is fine.
// An empty file is treated as the wrong type: it cannot be a readable PDF or image.
export const validateUploadFile = (file, limits = SPES_DOC_LIMITS) => {
  if (!file) return "SPES_DOCS_MISSING";
  if (!limits.mimes.includes(file.type) || file.size === 0) return limits.typeError;
  if (file.size > limits.maxBytes) return limits.sizeError;
  return null;
};

// Placeholders every upload message may use, so a server code translates the same
// way wherever it is shown: "Each file must be {{max}} MB or smaller."
export const uploadMessageParams = () => ({
  max: bytesToMb(SPES_DOC_LIMITS.maxBytes),
  coverMax: bytesToMb(SPES_COVER_LIMITS.maxBytes),
  count: SPES_MAX_FILES_PER_APPLICATION,
});

// Maps a failed upload request to a stable code the UI translates. Never exposes raw
// transport text. Cancelled requests return "UPLOAD_CANCELED" (callers stay quiet).
export const uploadErrorCode = (err) => {
  if (err?.code === "ERR_CANCELED" || err?.name === "CanceledError") return "UPLOAD_CANCELED";
  const status = err?.response?.status;
  const code = err?.response?.data?.code;
  if (code) return code;
  if (status === 413) return "SPES_FILE_TOO_LARGE";
  if (status === 415) return "SPES_FILE_TYPE";
  if (err?.code === "ECONNABORTED" || err?.code === "ETIMEDOUT") return "UPLOAD_TIMEOUT";
  if (!err?.response) return "UPLOAD_NETWORK";
  return "SPES_UPLOAD_FAILED";
};
