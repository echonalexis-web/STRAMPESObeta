// Avatar presets: the public shape, a short in-process cache of the active list (same
// pattern as bannerTemplateService), and the descriptor clients receive.

const AvatarPreset = require("../models/AvatarPreset");
const { publicImage } = require("./bannerTemplateService");

const CACHE_TTL_MS = 60 * 1000;
let cache = null; // { presets, byId, expiresAt }

const toPublic = (preset) => {
  const image = publicImage(preset.image);
  return {
    id: String(preset._id),
    name: preset.name,
    nameFil: preset.nameFil || "",
    ...(image ? { image } : {}),
  };
};

const loadActive = async () => {
  if (cache && cache.expiresAt > Date.now()) return cache;
  const rows = await AvatarPreset.find({ isActive: true, archivedAt: null }).sort({ sortOrder: 1, name: 1 }).lean();
  const presets = rows.map(toPublic).filter((p) => p.image);
  cache = { presets, byId: new Map(presets.map((p) => [p.id, p])), expiresAt: Date.now() + CACHE_TTL_MS };
  return cache;
};

const invalidateCache = () => {
  cache = null;
};

const listActivePresets = async () => (await loadActive()).presets;

// The chosen preset as clients see it, or null. A missing, archived or inactive
// preset resolves to null (the client then shows the uploaded photo or initials);
// the stored choice is never rewritten, so re-activating the preset brings it back.
const resolveAvatarPreset = async (avatar) => {
  const presetId = avatar && avatar.presetId ? String(avatar.presetId) : null;
  if (!presetId) return null;
  const { byId } = await loadActive();
  return byId.get(presetId) || null;
};

module.exports = { CACHE_TTL_MS, toPublic, listActivePresets, resolveAvatarPreset, invalidateCache };
