// Pure helpers for the built-in banners and avatars: the stable key and the order of a
// bundled SVG from its file name, the manifest sent to the server, which built-ins
// are missing, and the tab kept in the URL of the "Banner templates & avatars" page.
// The bundled files are read by builtInLoaders.js (Vite's glob import).

const SPEC = Object.freeze({
  banner: { prefix: "Banner", keyPrefix: "builtin-banner" },
  avatar: { prefix: "Avatar", keyPrefix: "builtin-avatar" },
});

const baseName = (pathOrName) => String(pathOrName || "").split(/[\\/]/).pop();

// "…/Banner_01_Forest_Dots.svg" -> { number: "01", order: 1, key: "builtin-banner-01", fallbackName: "Forest Dots" }
export const parseBuiltInFileName = (kind, pathOrName) => {
  const spec = SPEC[kind];
  if (!spec) return null;
  const match = baseName(pathOrName).match(new RegExp(`^${spec.prefix}_(\\d{2,3})_(.+)\\.svg$`, "i"));
  if (!match) return null;
  return { number: match[1], order: Number(match[1]), key: `${spec.keyPrefix}-${match[1]}`, fallbackName: match[2].replace(/_/g, " ") };
};

// Sorted by the number in the file name. `names` is data/builtInTemplateNames.json
// ({ banner: { "01": { name, nameFil } } }); a missing entry falls back to the file
// name. Files that do not match the naming are skipped. Only the first banner is
// asked to be the default (the server applies it only when no default exists).
export const buildBuiltInManifest = (kind, filePaths, names = {}) => {
  const parsed = (filePaths || [])
    .map((path) => ({ path, info: parseBuiltInFileName(kind, path) }))
    .filter((item) => item.info)
    .sort((a, b) => a.info.order - b.info.order);
  return parsed.map((item, index) => {
    const known = names[kind]?.[item.info.number];
    return {
      key: item.info.key,
      name: known?.name || item.info.fallbackName,
      nameFil: known?.nameFil || "",
      isDefault: kind === "banner" && index === 0,
      path: item.path,
    };
  });
};

// The request body of the manifest field: only what the server reads.
export const manifestPayload = (manifest) => manifest.map(({ key, name, nameFil, isDefault }) => ({ key, name, nameFil, isDefault }));

// How the built-ins stand: how many of the bundled ones the list holds.
export const builtInStatus = (manifest, items) => {
  const have = new Set((items || []).filter((item) => item && item.builtInKey).map((item) => item.builtInKey));
  const present = manifest.filter((entry) => have.has(entry.key)).length;
  return { total: manifest.length, present, missing: manifest.length - present, none: present === 0 };
};

// ---------------------------------------------------------------- tabs in the URL
export const PROFILE_TABS = Object.freeze(["banners", "avatars"]);
export const DEFAULT_TAB = "banners";

export const tabFromSearch = (search) => {
  const value = new URLSearchParams(String(search || "").replace(/^\?/, "")).get("tab");
  return PROFILE_TABS.includes(value) ? value : DEFAULT_TAB;
};

// The query string for a tab, keeping any other parameters. The default tab is
// written out too, so a link always says which tab it opens.
export const searchForTab = (search, tab) => {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  params.set("tab", PROFILE_TABS.includes(tab) ? tab : DEFAULT_TAB);
  return `?${params.toString()}`;
};

// The tab a key press moves to (arrow keys wrap, Home and End jump), or null.
export const tabForKey = (current, key) => {
  const index = PROFILE_TABS.indexOf(current);
  if (index < 0) return null;
  if (key === "ArrowRight") return PROFILE_TABS[(index + 1) % PROFILE_TABS.length];
  if (key === "ArrowLeft") return PROFILE_TABS[(index - 1 + PROFILE_TABS.length) % PROFILE_TABS.length];
  if (key === "Home") return PROFILE_TABS[0];
  if (key === "End") return PROFILE_TABS[PROFILE_TABS.length - 1];
  return null;
};
