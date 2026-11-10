// Pure helpers for the banner template upload form. They MIRROR the server's rules
// (server/services/bannerTemplateImageService.js) so the form can tell the
// superadmin early; the server is the only real gate and answers the same codes.

export const TEMPLATE_LIMITS = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  maxSvgBytes: 512 * 1024,
  minWidth: 1200,
  minHeight: 300,
  maxWidth: 6000,
  maxHeight: 1500,
  ratio: 4,
  ratioTolerance: 0.03,
  recommended: Object.freeze({ width: 1600, height: 400 }),
});

// How much of the file the type sniff needs.
export const SNIFF_BYTES = 4096;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const bytesToText = (bytes) => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
};

// "png", "svg" or null, from the content alone (never the name or MIME type).
export const sniffImageType = (bytes) => {
  if (!bytes || bytes.length < 8) return null;
  if (PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) return "png";
  const head = bytesToText(bytes.subarray(0, Math.min(bytes.length, SNIFF_BYTES))).replace(/^ï»¿/, "");
  const withoutProlog = head
    .replace(/^\s*<\?xml[^>]*\?>/i, "")
    .replace(/^(\s|<!--[\s\S]*?-->|<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>)+/i, "");
  return /^<svg[\s>]/i.test(withoutProlog) ? "svg" : null;
};

const EXT_TYPE = { png: "png", svg: "svg" };
const MIME_TYPE = { "image/png": "png", "image/svg+xml": "svg" };

// What the file claims to be, from its name and MIME type. Both must agree with the
// sniffed content. Null parts mean "not an SVG or PNG".
export const declaredType = ({ name = "", type = "" } = {}) => {
  const ext = String(name).toLowerCase().split(".").pop();
  return { byExt: EXT_TYPE[ext] || null, byMime: MIME_TYPE[String(type).toLowerCase()] || null };
};

// Returns a server error code, or null when the file looks acceptable. `sniffed` is
// the result of sniffImageType for the file's first bytes.
export const checkTemplateFile = ({ name, type, size }, sniffed) => {
  if (!sniffed) return "TEMPLATE_IMAGE_TYPE";
  const { byExt, byMime } = declaredType({ name, type });
  if (byExt !== sniffed || byMime !== sniffed) return "TEMPLATE_IMAGE_TYPE";
  const max = sniffed === "svg" ? TEMPLATE_LIMITS.maxSvgBytes : TEMPLATE_LIMITS.maxBytes;
  if (!size || size > max) return "TEMPLATE_IMAGE_TOO_LARGE";
  return null;
};

// width / height within the tolerance of 4:1.
export const isNearTargetRatio = (width, height) => {
  if (!(width > 0) || !(height > 0)) return false;
  return Math.abs(width / height - TEMPLATE_LIMITS.ratio) / TEMPLATE_LIMITS.ratio <= TEMPLATE_LIMITS.ratioTolerance;
};

const lengthOf = (value) => {
  const n = parseFloat(String(value));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Width and height an SVG declares (width and height attributes, else the viewBox).
// Null when it declares neither: the browser then reports a made-up size, so the
// form leaves the ratio to the server.
export const svgDimensions = (text) => {
  const tag = String(text || "").match(/<svg\b[^>]*>/i);
  if (!tag) return null;
  const attr = (name) => {
    const m = tag[0].match(new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
    return m ? m[2] : null;
  };
  const width = attr("width");
  const height = attr("height");
  if (width && height && !/%/.test(width) && !/%/.test(height) && lengthOf(width) && lengthOf(height)) {
    return { width: lengthOf(width), height: lengthOf(height) };
  }
  const viewBox = attr("viewBox");
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) return { width: parts[2], height: parts[3] };
  }
  return null;
};

// Dimension check for a decoded image. Returns a server error code or null.
// `dims` is null when the size is unknown (an SVG with no declared size).
export const checkTemplateDimensions = (sniffed, dims) => {
  if (!dims) return null;
  const { width, height } = dims;
  if (sniffed === "png") {
    if (width < TEMPLATE_LIMITS.minWidth || height < TEMPLATE_LIMITS.minHeight || width > TEMPLATE_LIMITS.maxWidth || height > TEMPLATE_LIMITS.maxHeight) {
      return "TEMPLATE_IMAGE_DIMENSIONS";
    }
  }
  return isNearTargetRatio(width, height) ? null : "TEMPLATE_IMAGE_RATIO";
};

// Which form field a server error code belongs to.
export const errorField = (code) => {
  if (!code) return "form";
  if (code.startsWith("TEMPLATE_IMAGE_") || code === "TEMPLATE_UPLOAD_FAILED") return "image";
  if (code === "TEMPLATE_DEFINITION_INVALID" || code === "TEMPLATE_NAME_TAKEN") return "name";
  if (code === "TEMPLATE_IS_DEFAULT") return "active";
  return "form";
};

export const formatBytes = (bytes) => {
  if (!(bytes >= 0)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Name filter for the grid: matches the English or Filipino name, ignoring case.
export const matchesQuery = (template, query) => {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return [template?.name, template?.nameFil].some((value) => String(value || "").toLowerCase().includes(q));
};

export const matchesFilter = (template, filter) => {
  if (filter === "active") return Boolean(template?.isActive);
  if (filter === "archived") return !template?.isActive;
  return true;
};
