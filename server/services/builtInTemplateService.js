// Installing the built-in banner templates and avatar presets.
//
// The built-in artwork is SVG files bundled with the client. The superadmin screen
// reads them and sends them here in ONE multipart request (a JSON manifest plus the
// files), and every file goes through the same validated pipeline as a custom upload
// (bannerTemplateImageService: content sniffing, SVG safety, rasterized to WebP).
// Installing is idempotent by a stable key (builtin-banner-01, builtin-avatar-03):
// an existing key is skipped, so a second run creates nothing and never overwrites a
// superadmin's edits (names, active, order, default).

const { processTemplateImage, TemplateImageError } = require("./bannerTemplateImageService");
const storageService = require("./storageService");

const MAX_ENTRIES = 40;
const KEY_PATTERNS = Object.freeze({
  banner: /^builtin-banner-\d{2,3}$/,
  avatar: /^builtin-avatar-\d{2,3}$/,
});

// Returns { ok: true, entries } or { ok: false }. Entries carry only whitelisted fields.
const parseManifest = (raw, kind) => {
  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false };
    }
  }
  if (!Array.isArray(data) || data.length === 0 || data.length > MAX_ENTRIES) return { ok: false };
  const pattern = KEY_PATTERNS[kind];
  if (!pattern) return { ok: false };
  const seen = new Set();
  const entries = [];
  for (const item of data) {
    if (!item || typeof item !== "object") return { ok: false };
    const key = typeof item.key === "string" ? item.key : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const nameFil = typeof item.nameFil === "string" ? item.nameFil.trim() : "";
    if (!pattern.test(key) || seen.has(key)) return { ok: false };
    if (name.length < 1 || name.length > 60 || nameFil.length > 60) return { ok: false };
    seen.add(key);
    entries.push({ key, name, nameFil, isDefault: item.isDefault === true });
  }
  return { ok: true, entries };
};

const removeStored = async (...values) => {
  await Promise.allSettled(values.filter(Boolean).map((value) => storageService.remove(value)));
};

// kind: "banner" | "avatar". Model: the mongoose model. profile: the image profile.
// category: the storageService category. makeDoc(entry, ctx) builds the document.
// `hasDefault` tells whether a default already exists (banners only).
const installBuiltIns = async ({ Model, profile, category, entries, files, makeDoc, hasDefault = true }) => {
  const results = [];
  const existing = new Set(
    (await Model.find({ builtInKey: { $in: entries.map((e) => e.key) } }).select("builtInKey").lean()).map((row) => row.builtInKey)
  );
  const last = await Model.findOne({}).sort({ sortOrder: -1 }).select("sortOrder").lean();
  let nextOrder = (last?.sortOrder ?? -1) + 1;
  let defaultTaken = hasDefault;

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (existing.has(entry.key)) {
      results.push({ key: entry.key, status: "exists" });
      continue;
    }
    const file = files[i];
    if (!file || !file.buffer) {
      results.push({ key: entry.key, status: "failed", code: `${profile.prefix}REQUIRED` });
      continue;
    }
    let processed;
    try {
      processed = await processTemplateImage(file, profile);
    } catch (error) {
      results.push({ key: entry.key, status: "failed", code: error instanceof TemplateImageError ? error.code : `${profile.prefix}PROCESSING_FAILED` });
      continue;
    }

    const stored = [];
    try {
      const large = await storageService.upload({ buffer: processed.large.buffer, mimetype: "image/webp" }, { category });
      stored.push(large.storedValue);
      const small = await storageService.upload({ buffer: processed.small.buffer, mimetype: "image/webp" }, { category });
      stored.push(small.storedValue);
      const image = {
        url: large.storedValue,
        thumbUrl: small.storedValue,
        storedValue: large.storedValue,
        thumbStoredValue: small.storedValue,
        width: processed.large.width,
        height: processed.large.height,
        bytes: processed.large.bytes + processed.small.bytes,
        placeholderColor: processed.placeholderColor || undefined,
        luminance: processed.luminance,
      };
      // Only the first requested default takes the flag, and only when none exists.
      const isDefault = entry.isDefault && !defaultTaken;
      if (isDefault) defaultTaken = true;
      await Model.create(makeDoc(entry, { image, overlay: processed.overlay, sortOrder: nextOrder, isDefault }));
      nextOrder += 1;
      results.push({ key: entry.key, status: "created" });
    } catch (error) {
      await removeStored(...stored);
      const duplicate = error && error.code === 11000;
      results.push({ key: entry.key, status: duplicate ? "exists" : "failed", ...(duplicate ? {} : { code: `${profile.prefix.startsWith("AVATAR") ? "AVATAR" : "TEMPLATE"}_UPLOAD_FAILED` }) });
    }
  }
  return results;
};

const summarize = (results) => ({
  created: results.filter((r) => r.status === "created").length,
  existing: results.filter((r) => r.status === "exists").length,
  failed: results.filter((r) => r.status === "failed").length,
  createdKeys: results.filter((r) => r.status === "created").map((r) => r.key),
});

module.exports = { MAX_ENTRIES, KEY_PATTERNS, parseManifest, installBuiltIns, summarize };
