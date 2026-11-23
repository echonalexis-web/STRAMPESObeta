// Processing for the photo an applicant uploads for their resumes. Same approach as the employer
// cover (coverImageService): the multer type filter and signature check are the first gate, this is
// the second, where sharp decides what the bytes really are. Output is ONE square WebP with all
// metadata (EXIF, GPS) stripped, center-cropped and resized.

const sharp = require("sharp");

const LIMITS = Object.freeze({
  maxBytes: 2 * 1024 * 1024, // the same cap as profile pictures
  minSide: 120,
  maxSide: 8000,
  maxPixels: 25_000_000,
});
const OUTPUT_SIZE = 400;
const WEBP_QUALITY = 82;
const ALLOWED_FORMATS = ["jpeg", "png", "webp"];

class ResumePhotoError extends Error {
  constructor(code, status, message) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

// Plain words for the applicant, keyed by code (the client shows these next to the control).
const MESSAGES = {
  RESUME_PHOTO_MISSING: "Choose a photo to upload.",
  RESUME_PHOTO_TYPE: "Use a JPG, PNG or WebP photo.",
  RESUME_PHOTO_TOO_LARGE: "That photo is larger than 2 MB.",
  RESUME_PHOTO_DIMENSIONS: "That photo is too small. Use one at least 120 pixels on each side.",
  RESUME_PHOTO_PROCESSING_FAILED: "That photo could not be read. Try another one.",
};

// At most two photos are processed at once so many uploads cannot starve the CPU.
const MAX_CONCURRENT = 2;
let running = 0;
const waiting = [];
const acquire = () =>
  new Promise((resolve) => {
    if (running < MAX_CONCURRENT) {
      running += 1;
      resolve();
    } else waiting.push(resolve);
  });
const release = () => {
  const next = waiting.shift();
  if (next) next();
  else running -= 1;
};

// Validates the bytes and returns the processed image. Throws ResumePhotoError.
const processResumePhoto = async (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new ResumePhotoError("RESUME_PHOTO_MISSING", 400);
  if (buffer.length > LIMITS.maxBytes) throw new ResumePhotoError("RESUME_PHOTO_TOO_LARGE", 413);

  await acquire();
  try {
    const options = { limitInputPixels: LIMITS.maxPixels, failOn: "error" };
    let meta;
    try {
      meta = await sharp(buffer, options).metadata();
    } catch {
      // Not an image sharp can read at all (a renamed document, a script, a broken file).
      throw new ResumePhotoError("RESUME_PHOTO_TYPE", 400);
    }
    // sharp decides the real format: GIF, SVG, TIFF, AVIF and anything else is refused, and so is an
    // animated image.
    if (!ALLOWED_FORMATS.includes(meta.format) || (meta.pages || 1) > 1) throw new ResumePhotoError("RESUME_PHOTO_TYPE", 400);

    // EXIF orientations 5 to 8 swap the sides once the image is auto-oriented.
    const swapped = Number(meta.orientation) >= 5 && Number(meta.orientation) <= 8;
    const width = swapped ? meta.height : meta.width;
    const height = swapped ? meta.width : meta.height;
    if (!width || !height) throw new ResumePhotoError("RESUME_PHOTO_PROCESSING_FAILED", 422);
    if (width > LIMITS.maxSide || height > LIMITS.maxSide || width * height > LIMITS.maxPixels) {
      throw new ResumePhotoError("RESUME_PHOTO_DIMENSIONS", 400);
    }
    if (width < LIMITS.minSide || height < LIMITS.minSide) throw new ResumePhotoError("RESUME_PHOTO_DIMENSIONS", 400);

    try {
      // .rotate() auto-orients from EXIF; no .withMetadata(), so EXIF and GPS are dropped.
      const data = await sharp(buffer, options)
        .rotate()
        .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: "cover", position: "centre" })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
      return { buffer: data, width: OUTPUT_SIZE, height: OUTPUT_SIZE, bytes: data.length, contentType: "image/webp" };
    } catch {
      throw new ResumePhotoError("RESUME_PHOTO_PROCESSING_FAILED", 422);
    }
  } finally {
    release();
  }
};

module.exports = { LIMITS, OUTPUT_SIZE, MESSAGES, ResumePhotoError, processResumePhoto };
