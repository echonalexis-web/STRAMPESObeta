const path = require("path");

// Upload folders served without a token: an <img> tag cannot send a Bearer
// header, so profile pictures, news images, employer covers, banner templates
// and avatar presets are public. Everything else under /uploads is private.
const PUBLIC_UPLOAD_DIRS = ["profiles", "news", "covers", "banner-templates", "avatar-presets"];

/**
 * Classifies a request path under the /uploads mount (the mount prefix is
 * already stripped, so it looks like "/profiles/a.webp").
 *
 * The path is decoded once, which is the same single decode `send` (used by
 * express.static) applies before it opens the file. All checks run on that
 * decoded value, so what is checked is what gets served:
 *   - any ".." segment is refused, split on both "/" and "\" because `send`
 *     treats "\" as a separator on Windows;
 *   - the public-folder test is a prefix match on the normalised path, so a
 *     public folder name elsewhere in the path cannot exempt a private file.
 *
 * @param {string} rawPath req.path inside the /uploads mount
 * @returns {{ ok: false } | { ok: true, normalized: string, isPublic: boolean }}
 */
const classifyUploadPath = (rawPath) => {
  let decoded;
  try {
    decoded = decodeURIComponent(String(rawPath || ""));
  } catch {
    return { ok: false };
  }

  if (decoded.includes("\0")) return { ok: false };
  if (decoded.split(/[\\/]/).includes("..")) return { ok: false };

  const normalized = path.posix.normalize(decoded.replace(/\\/g, "/"));
  if (!normalized.startsWith("/")) return { ok: false };

  const isPublic = PUBLIC_UPLOAD_DIRS.some((dir) => normalized.startsWith(`/${dir}/`));
  return { ok: true, normalized, isPublic };
};

module.exports = { classifyUploadPath, PUBLIC_UPLOAD_DIRS };
