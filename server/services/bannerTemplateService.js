// Banner templates: definition validation (no free CSS), the resolved cover
// descriptor clients receive, and a short in-process cache of the active list
// (same pattern as systemOptionService). See COVER_PHOTO_PLAN.md sections 3 and 4.

const BannerTemplate = require("../models/BannerTemplate");

const CACHE_TTL_MS = 60 * 1000;

const DS_COLORS = [
  "ds-green-deep",
  "ds-green",
  "ds-green-secondary",
  "ds-mint",
  "ds-gold",
  "ds-gold-deep",
  "ds-ink-900",
  "ds-ink-700",
  "ds-ink-500",
  "ds-ink-300",
  "ds-ink-100",
  "ds-ink-50",
  "ds-bg",
  "ds-surface",
];
const PATTERN_TYPES = ["none", "dots", "rings", "grid", "stripes"];
const FADES = ["none", "left", "right", "center"];
const HEX = /^#[0-9a-fA-F]{6}$/;

// Today's look, exactly: used when an account has no cover or its template is gone.
const CLASSIC_DEFINITION = Object.freeze({
  gradient: { angle: 160, stops: [{ color: "ds-green", at: 0 }, { color: "ds-green-deep", at: 100 }] },
  pattern: { type: "dots", color: "ds-gold", mixPercent: 55, size: 22, opacity: 0.55, fade: "left" },
});

const isColor = (value) => typeof value === "string" && (DS_COLORS.includes(value) || HEX.test(value));
const isNum = (value, min, max) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

// Returns { ok: true, definition } with clamped, whitelisted keys, or { ok: false, reason }.
// Anything not on the allowlist is dropped, and any string containing url( or
// other CSS syntax fails because only tokens and #rrggbb colors are accepted.
const validateDefinition = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, reason: "definition must be an object" };
  const out = {};

  const g = input.gradient;
  if (g === undefined || g === null) return { ok: false, reason: "gradient is required" };
  if (typeof g !== "object" || Array.isArray(g)) return { ok: false, reason: "gradient must be an object" };
  if (!isNum(g.angle, 0, 360)) return { ok: false, reason: "gradient.angle must be 0 to 360" };
  if (!Array.isArray(g.stops) || g.stops.length < 2 || g.stops.length > 4) return { ok: false, reason: "gradient needs 2 to 4 stops" };
  const stops = [];
  for (const stop of g.stops) {
    if (!stop || !isColor(stop.color)) return { ok: false, reason: "gradient stop color must be a design token or #rrggbb" };
    if (!isNum(stop.at, 0, 100)) return { ok: false, reason: "gradient stop position must be 0 to 100" };
    stops.push({ color: stop.color, at: stop.at });
  }
  out.gradient = { angle: g.angle, stops };

  const p = input.pattern;
  if (p !== undefined && p !== null) {
    if (typeof p !== "object" || Array.isArray(p)) return { ok: false, reason: "pattern must be an object" };
    if (!PATTERN_TYPES.includes(p.type)) return { ok: false, reason: "pattern.type is not allowed" };
    if (p.type !== "none") {
      if (!isColor(p.color)) return { ok: false, reason: "pattern.color must be a design token or #rrggbb" };
      if (!isNum(p.mixPercent, 0, 100)) return { ok: false, reason: "pattern.mixPercent must be 0 to 100" };
      if (!isNum(p.size, 8, 80)) return { ok: false, reason: "pattern.size must be 8 to 80" };
      if (!isNum(p.opacity, 0, 1)) return { ok: false, reason: "pattern.opacity must be 0 to 1" };
      if (p.fade !== undefined && !FADES.includes(p.fade)) return { ok: false, reason: "pattern.fade is not allowed" };
      out.pattern = { type: p.type, color: p.color, mixPercent: p.mixPercent, size: p.size, opacity: p.opacity, fade: p.fade || "none" };
    } else {
      out.pattern = { type: "none" };
    }
  }

  const known = new Set(["gradient", "pattern"]);
  for (const key of Object.keys(input)) {
    if (!known.has(key)) return { ok: false, reason: `unknown key "${key}"` };
  }
  return { ok: true, definition: out };
};

// ---------------------------------------------------------------- cache

let cache = null; // { templates: [...], defaultId, byId: Map, expiresAt }

const toPublic = (t) => ({
  id: String(t._id),
  slug: t.slug,
  name: t.name,
  nameFil: t.nameFil || "",
  kind: t.kind,
  definition: t.definition,
  overlay: t.overlay || "dark",
});

const loadActive = async () => {
  if (cache && cache.expiresAt > Date.now()) return cache;
  const rows = await BannerTemplate.find({ isActive: true, archivedAt: null }).sort({ sortOrder: 1, name: 1 }).lean();
  const templates = rows.map(toPublic);
  const byId = new Map(templates.map((t) => [t.id, t]));
  const def = rows.find((r) => r.isDefault);
  cache = { templates, byId, defaultId: def ? String(def._id) : null, expiresAt: Date.now() + CACHE_TTL_MS };
  return cache;
};

const invalidateCache = () => {
  cache = null;
};

const listActiveTemplates = async () => {
  const { templates, defaultId } = await loadActive();
  return { templates, defaultId };
};

// The descriptor clients receive (never a raw template id with a missing template):
//   { kind: "default" } | { kind: "template", template } | { kind: "image", image }
// A missing or inactive template falls back to the default template, then to the
// built-in classic. The stored cover is never rewritten.
const resolveCover = async (cover) => {
  if (!cover || typeof cover !== "object") return { kind: "default" };
  if (cover.kind === "image" && cover.image && cover.image.status === "published" && cover.image.url) {
    const { url, thumbUrl, width, height, placeholderColor } = cover.image;
    return { kind: "image", image: { url, thumbUrl: thumbUrl || url, width, height, placeholderColor: placeholderColor || null } };
  }
  const templateId = cover.templateId ? String(cover.templateId) : null;
  if (!templateId) return { kind: "default" };
  const { byId, defaultId } = await loadActive();
  const found = byId.get(templateId);
  if (found) return { kind: "template", template: found };
  if (defaultId && byId.get(defaultId)) return { kind: "template", template: byId.get(defaultId) };
  return { kind: "default" };
};

module.exports = {
  CACHE_TTL_MS,
  DS_COLORS,
  PATTERN_TYPES,
  CLASSIC_DEFINITION,
  validateDefinition,
  listActiveTemplates,
  resolveCover,
  invalidateCache,
  toPublic,
};
