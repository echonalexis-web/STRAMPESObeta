// Processing for an employer's uploaded cover (COVER_PHOTO_PLAN.md section 5).
// The signature check in middleware/upload.js is the first gate; this is the
// second: sharp decides what the bytes really are. Output is two WebP files at a
// fixed 4:1 ratio with all metadata (EXIF, GPS) stripped.

const sharp = require("sharp");

const LIMITS = Object.freeze({
  maxBytes: 3 * 1024 * 1024,
  minWidth: 1200,
  minHeight: 300,
  maxWidth: 8000,
  maxHeight: 8000,
  maxPixels: 25_000_000,
});
const LARGE = Object.freeze({ width: 1600, height: 400 });
const SMALL = Object.freeze({ width: 800, height: 200 });
const WEBP_QUALITY = 80;
const ALLOWED_FORMATS = ["jpeg", "png", "webp"];

class CoverImageError extends Error {
  constructor(code, status, message) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

// At most N cover images are processed at once so many uploads cannot starve the CPU.
const MAX_CONCURRENT = 2;
let active = 0;
const waiting = [];
const acquire = () =>
  new Promise((resolve) => {
    if (active < MAX_CONCURRENT) {
      active += 1;
      resolve();
    } else {
      waiting.push(resolve);
    }
  });
const release = () => {
  const next = waiting.shift();
  if (next) next();
  else active -= 1;
};

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// What the crop editor reported. The editor already produced the cropped file, so
// this is stored for reference only (clamped); it never drives a second crop.
const sanitizeCropData = (input) => {
  if (!input || typeof input !== "object") return undefined;
  return {
    x: clamp(input.x, -10000, 10000, 0),
    y: clamp(input.y, -10000, 10000, 0),
    zoom: clamp(input.zoom, 0.1, 10, 1),
    rotation: clamp(input.rotation, -360, 360, 0),
    aspect: LARGE.width / LARGE.height,
  };
};

const toHex = ({ r, g, b }) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

// Validates the bytes and returns both variants. Throws CoverImageError.
const processCoverImage = async (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new CoverImageError("COVER_IMAGE_PROCESSING_FAILED", 422);
  if (buffer.length > LIMITS.maxBytes) throw new CoverImageError("COVER_IMAGE_TOO_LARGE", 413);

  await acquire();
  try {
    const options = { limitInputPixels: LIMITS.maxPixels, failOn: "error" };
    let meta;
    try {
      meta = await sharp(buffer, options).metadata();
    } catch {
      throw new CoverImageError("COVER_IMAGE_PROCESSING_FAILED", 422);
    }

    // sharp decides the real format: GIF, SVG, TIFF, AVIF and anything else is refused.
    if (!ALLOWED_FORMATS.includes(meta.format)) throw new CoverImageError("COVER_IMAGE_TYPE", 400);
    if ((meta.pages || 1) > 1) throw new CoverImageError("COVER_IMAGE_TYPE", 400); // animated

    // EXIF orientations 5 to 8 swap the sides once the image is auto-oriented.
    const swapped = Number(meta.orientation) >= 5 && Number(meta.orientation) <= 8;
    const width = swapped ? meta.height : meta.width;
    const height = swapped ? meta.width : meta.height;
    if (!width || !height) throw new CoverImageError("COVER_IMAGE_PROCESSING_FAILED", 422);
    if (width * height > LIMITS.maxPixels || width > LIMITS.maxWidth || height > LIMITS.maxHeight) {
      throw new CoverImageError("COVER_IMAGE_DIMENSIONS", 400);
    }
    if (width < LIMITS.minWidth || height < LIMITS.minHeight) throw new CoverImageError("COVER_IMAGE_DIMENSIONS", 400);

    const render = async (size) => {
      // .rotate() auto-orients from EXIF; no .withMetadata(), so EXIF and GPS are dropped.
      const data = await sharp(buffer, options)
        .rotate()
        .resize(size.width, size.height, { fit: "cover", position: "centre" })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
      return { buffer: data, width: size.width, height: size.height, bytes: data.length };
    };

    let large;
    let small;
    try {
      [large, small] = await Promise.all([render(LARGE), render(SMALL)]);
    } catch {
      throw new CoverImageError("COVER_IMAGE_PROCESSING_FAILED", 422);
    }

    let placeholderColor = null;
    try {
      const { dominant } = await sharp(small.buffer).stats();
      placeholderColor = toHex(dominant);
    } catch {
      placeholderColor = null;
    }

    return { large, small, placeholderColor };
  } finally {
    release();
  }
};

module.exports = { LIMITS, LARGE, SMALL, CoverImageError, processCoverImage, sanitizeCropData };
