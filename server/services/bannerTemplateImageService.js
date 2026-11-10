// Processing for a superadmin banner or avatar preset upload (SVG or PNG).
//
// Every upload is rasterized with sharp to one normalized WebP plus a thumbnail
// (banner: 1600x400 and 800x200; avatar: 512x512 and 128x128, center-cropped, never
// stretched), with all metadata dropped. Only that output is stored and
// served, so script content in an SVG can never reach a browser. The file type is
// decided from the bytes, never from the MIME type or the extension.

const path = require("path");
const sharp = require("sharp");
const { LARGE, SMALL } = require("./coverImageService");

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const LIMITS = Object.freeze({
  // Configurable (megabytes). Applies to PNG; SVG text has its own, smaller cap.
  maxBytes: Math.round(num(process.env.BANNER_TEMPLATE_MAX_MB, 2) * 1024 * 1024),
  maxSvgBytes: Math.round(num(process.env.BANNER_TEMPLATE_MAX_SVG_KB, 512) * 1024),
  minWidth: 1200,
  minHeight: 300,
  maxWidth: 6000,
  maxHeight: 1500,
  maxPixels: 12_000_000,
  // Accepted width / height, as a fraction either side of 4:1 (1600x400).
  ratioTolerance: 0.03,
  processTimeoutMs: 15_000,
});
const TARGET_RATIO = LARGE.width / LARGE.height;

// What each kind of upload is checked against and rendered to. `prefix` makes the
// error codes: TEMPLATE_IMAGE_* for banners, AVATAR_IMAGE_* for avatars.
const PROFILES = Object.freeze({
  banner: Object.freeze({
    prefix: "TEMPLATE_IMAGE_",
    large: LARGE,
    small: SMALL,
    ratio: TARGET_RATIO,
    minWidth: LIMITS.minWidth,
    minHeight: LIMITS.minHeight,
    maxWidth: LIMITS.maxWidth,
    maxHeight: LIMITS.maxHeight,
    maxBytes: LIMITS.maxBytes,
    maxSvgBytes: LIMITS.maxSvgBytes,
  }),
  avatar: Object.freeze({
    prefix: "AVATAR_IMAGE_",
    large: Object.freeze({ width: 512, height: 512 }),
    small: Object.freeze({ width: 128, height: 128 }),
    ratio: 1,
    minWidth: 128,
    minHeight: 128,
    maxWidth: 4000,
    maxHeight: 4000,
    maxBytes: Math.round(num(process.env.AVATAR_PRESET_MAX_MB, 1) * 1024 * 1024),
    maxSvgBytes: Math.round(num(process.env.AVATAR_PRESET_MAX_SVG_KB, 256) * 1024),
  }),
});
const WEBP_QUALITY = 82;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

class TemplateImageError extends Error {
  constructor(code, status, message) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

// ---------------------------------------------------------------- concurrency
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

const failWith = (profile, suffix, status) => new TemplateImageError(`${profile.prefix}${suffix}`, status);

const withTimeout = (promise, ms, profile = PROFILES.banner) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(failWith(profile, "PROCESSING_FAILED", 422)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

// ---------------------------------------------------------------- sniffing
const stripBom = (text) => text.replace(/^﻿/, "");

// "png", "svg" or null, from the content alone.
const detectType = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null;
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return "png";
  // SVG is text: after an optional BOM, XML declaration, comments and whitespace the
  // first element must be <svg. HTML, scripts and anything else is not an SVG.
  const head = stripBom(buffer.subarray(0, Math.min(buffer.length, 4096)).toString("utf8"));
  const withoutProlog = head
    .replace(/^\s*<\?xml[^>]*\?>/i, "")
    // A DOCTYPE is allowed to be sniffed past so the safety scan can name it (UNSAFE).
    .replace(/^(\s|<!--[\s\S]*?-->|<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>)+/i, "");
  return /^<svg[\s>]/i.test(withoutProlog) ? "svg" : null;
};

const EXT_TYPE = { ".png": "png", ".svg": "svg" };
const MIME_TYPE = { "image/png": "png", "image/svg+xml": "svg" };

// The declared name and MIME type must agree with the real content.
const declaredTypes = (file) => ({
  byExt: EXT_TYPE[path.extname(String(file?.originalname || "")).toLowerCase()] || null,
  byMime: MIME_TYPE[String(file?.mimetype || "").toLowerCase()] || null,
});

// ---------------------------------------------------------------- SVG safety
// A rasterized SVG can not run script, but it can still ask the renderer to read a
// file or a URL, or expand an entity bomb. Anything like that is refused outright
// (not silently stripped), so what is rendered is what the superadmin uploaded.
const UNSAFE_SVG = [
  /<!DOCTYPE/i,
  /<!ENTITY/i,
  /<\s*script[\s>/]/i,
  /<\s*foreignObject[\s>/]/i,
  /<\s*(iframe|object|embed|audio|video|canvas)[\s>/]/i,
  /\son[a-z]+\s*=/i,
  /javascript\s*:/i,
  /@import/i,
];
const REF_ATTR = /(?:xlink:)?href\s*=\s*(["'])(.*?)\1/gi;
const URL_REF = /url\s*\(\s*(["']?)(.*?)\1\s*\)/gi;
const SAFE_REF = /^(#|data:image\/(png|jpe?g|webp);base64,)/i;

const assertSafeSvg = (buffer, profile = PROFILES.banner) => {
  const text = buffer.toString("utf8");
  if (UNSAFE_SVG.some((rule) => rule.test(text))) throw failWith(profile, "UNSAFE", 400);
  for (const match of text.matchAll(REF_ATTR)) {
    if (!SAFE_REF.test(match[2].trim())) throw failWith(profile, "UNSAFE", 400);
  }
  for (const match of text.matchAll(URL_REF)) {
    if (!SAFE_REF.test(match[2].trim())) throw failWith(profile, "UNSAFE", 400);
  }
};

const toHex = ({ r, g, b }) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

// Relative luminance of an sRGB color, 0 (black) to 1 (white).
const luminanceOf = ({ r, g, b }) => {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

// "dark" overlay = light text on a dark banner (today's meaning of the field).
const overlayFromLuminance = (luminance) => (luminance > 0.5 ? "light" : "dark");

// Validates the upload and returns { large, small, placeholderColor, luminance, overlay,
// sourceType }. `file` is the multer memory file. Throws TemplateImageError.
const processTemplateImage = async (file, profile = PROFILES.banner) => {
  const buffer = file?.buffer;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw failWith(profile, "REQUIRED", 400);

  const type = detectType(buffer);
  if (!type) throw failWith(profile, "TYPE", 400);
  const { byExt, byMime } = declaredTypes(file);
  if (byExt !== type || byMime !== type) throw failWith(profile, "TYPE", 400);

  if (buffer.length > (type === "svg" ? profile.maxSvgBytes : profile.maxBytes)) {
    throw failWith(profile, "TOO_LARGE", 413);
  }
  if (type === "svg") assertSafeSvg(buffer, profile);

  await acquire();
  try {
    return await withTimeout(rasterize(buffer, type, profile), LIMITS.processTimeoutMs, profile);
  } finally {
    release();
  }
};

const rasterize = async (buffer, type, profile) => {
  const base = { limitInputPixels: LIMITS.maxPixels, failOn: "error" };

  let meta;
  try {
    meta = await sharp(buffer, type === "svg" ? { ...base, density: 72 } : base).metadata();
  } catch (error) {
    // sharp refuses an image over limitInputPixels while reading its header.
    if (/pixel limit/i.test(String(error?.message))) throw failWith(profile, "DIMENSIONS", 400);
    throw failWith(profile, "PROCESSING_FAILED", 422);
  }
  // sharp has the final say on what the bytes are.
  if (meta.format !== type) throw failWith(profile, "TYPE", 400);
  if ((meta.pages || 1) > 1) throw failWith(profile, "TYPE", 400);

  const { width, height } = meta;
  if (!width || !height) throw failWith(profile, "PROCESSING_FAILED", 422);

  if (type === "png") {
    if (width < profile.minWidth || height < profile.minHeight || width > profile.maxWidth || height > profile.maxHeight || width * height > LIMITS.maxPixels) {
      throw failWith(profile, "DIMENSIONS", 400);
    }
  } else if (width < 4 || height < 1 || width > profile.maxWidth * 4 || height > profile.maxHeight * 4) {
    // An SVG scales to any size: only absurd declared sizes are refused here.
    throw failWith(profile, "DIMENSIONS", 400);
  }

  const ratio = width / height;
  if (Math.abs(ratio - profile.ratio) / profile.ratio > LIMITS.ratioTolerance) throw failWith(profile, "RATIO", 400);

  // An SVG is drawn at the density that gives about the output width, so vector
  // artwork stays sharp. Capped so a huge viewBox can not request a huge canvas.
  const density = type === "svg" ? Math.min(1200, Math.max(36, Math.round((72 * profile.large.width) / width))) : undefined;
  const source = type === "svg" ? { ...base, density } : base;

  const render = async (size) => {
    // No .withMetadata(): EXIF, ICC and text chunks are dropped. Alpha is kept.
    const data = await sharp(buffer, source)
      // Center-crop to cover: within the ratio tolerance this trims a sliver, it never stretches.
      .resize(size.width, size.height, { fit: "cover", position: "centre" })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    return { buffer: data, width: size.width, height: size.height, bytes: data.length };
  };

  let large;
  let small;
  try {
    [large, small] = await Promise.all([render(profile.large), render(profile.small)]);
  } catch {
    throw failWith(profile, "PROCESSING_FAILED", 422);
  }

  let placeholderColor = null;
  let luminance = 0;
  try {
    // Brightness is measured over the default banner green so a transparent PNG is
    // judged on what the profile shows, not on its hidden color channel.
    const flat = await sharp(small.buffer).flatten({ background: "#0b704b" }).raw().toBuffer({ resolveWithObject: true });
    let r = 0;
    let g = 0;
    let b = 0;
    const channels = flat.info.channels;
    const pixels = flat.info.width * flat.info.height;
    for (let i = 0; i < flat.data.length; i += channels) {
      r += flat.data[i];
      g += flat.data[i + 1];
      b += flat.data[i + 2];
    }
    const mean = { r: r / pixels, g: g / pixels, b: b / pixels };
    placeholderColor = toHex(mean);
    luminance = Number(luminanceOf(mean).toFixed(4));
  } catch {
    placeholderColor = null;
  }

  return { large, small, placeholderColor, luminance, overlay: overlayFromLuminance(luminance), sourceType: type };
};

module.exports = {
  LIMITS,
  PROFILES,
  TARGET_RATIO,
  TemplateImageError,
  detectType,
  assertSafeSvg,
  overlayFromLuminance,
  processTemplateImage,
};
