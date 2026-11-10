// The Superadmin Console functions, in one place. Adding a function means one entry
// here and one <Route> in App.jsx (superadmin only). The launcher, the function page
// shell and the legacy-link redirect all read this list.
//
// `icon` is a name resolved by the launcher (kept as a string so this file stays
// pure and testable). Text lives in the locale files under superadmin.launcher.*.

export const CONSOLE_HOME = "/superadmin";

export const CONSOLE_GROUPS = Object.freeze(["accounts", "forms", "matching", "appearance"]);

export const CONSOLE_FUNCTIONS = Object.freeze([
  { id: "admin-accounts", path: "/superadmin/admin-accounts", group: "accounts", icon: "shield" },
  { id: "nsrp-forms", path: "/superadmin/nsrp-forms", group: "forms", icon: "pdf" },
  { id: "matching-bounds", path: "/superadmin/matching-bounds", group: "matching", icon: "scale" },
  { id: "catalogs", path: "/superadmin/catalogs", group: "matching", icon: "list" },
  { id: "banner-avatar-templates", path: "/superadmin/banner-avatar-templates", group: "appearance", icon: "images" },
]);

export const titleKey = (entry) => `superadmin.launcher.functions.${entry.id}.title`;
export const descriptionKey = (entry) => `superadmin.launcher.functions.${entry.id}.description`;
export const groupKey = (group) => `superadmin.launcher.groups.${group}`;

export const findFunction = (id) => CONSOLE_FUNCTIONS.find((entry) => entry.id === id) || null;

// Keeps the entries whose title or description contains every word of the query
// (case-insensitive). `text(entry)` returns the translated { title, description }.
export const filterFunctions = (entries, query, text) => {
  const words = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return entries;
  return entries.filter((entry) => {
    const { title = "", description = "" } = text(entry) || {};
    const haystack = `${title} ${description}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
};

// "all" (or nothing) keeps every entry; otherwise only the entries of that group.
export const filterByGroup = (entries, group) => (!group || group === "all" ? entries : entries.filter((entry) => entry.group === group));

// What a card shows under its description, as [{ key, count }] parts that the launcher
// turns into translated text (superadmin.launcher.summary.<key>). Built only from
// data the functions already load. Returns [] when there is nothing to say.
export const buildSummary = (id, data) => {
  if (id === "admin-accounts" && Array.isArray(data)) {
    const pending = data.filter((admin) => admin && admin.isActive && admin.mustChangePassword).length;
    return [{ key: "admins", count: data.length }, ...(pending > 0 ? [{ key: "pending", count: pending }] : [])];
  }
  if (id === "nsrp-forms" && Array.isArray(data)) {
    return [{ key: "nsrp", count: data.filter((meta) => meta && meta.updatedAt).length, total: data.length }];
  }
  // data: { banners: [], avatars: [] } (the lists the screen itself loads). A list that
  // failed to load is null and is left out.
  if (id === "banner-avatar-templates" && data && typeof data === "object") {
    const parts = [];
    if (Array.isArray(data.banners)) parts.push({ key: "banners", count: data.banners.length });
    if (Array.isArray(data.avatars)) parts.push({ key: "avatars", count: data.avatars.length });
    return parts;
  }
  return [];
};

// [{ group, entries }] in CONSOLE_GROUPS order, skipping empty groups.
export const groupFunctions = (entries) =>
  CONSOLE_GROUPS.map((group) => ({ group, entries: entries.filter((entry) => entry.group === group) })).filter((g) => g.entries.length > 0);

// The old console was one page. Its sections had no link anchors, but their headings
// carried ids; a link ending in one of those (or in a function id) lands on that
// function's page. Anything else stays on the launcher.
const LEGACY_HASHES = Object.freeze({
  "nsrp-templates-title": "nsrp-forms",
  "match-weight-bounds-title": "matching-bounds",
  "system-options-title": "catalogs",
  "banner-templates-title": "banner-avatar-templates",
  "sac-admins": "admin-accounts",
});

// The function used to be called "Banner templates" (/superadmin/banner-templates).
const LEGACY_IDS = Object.freeze({ "banner-templates": "banner-avatar-templates" });

// Old console routes that now live elsewhere, with the page they moved to.
export const LEGACY_PATHS = Object.freeze({ "/superadmin/banner-templates": "/superadmin/banner-avatar-templates" });

export const legacyHashTarget = (hash) => {
  const key = String(hash || "").replace(/^#/, "").trim().toLowerCase();
  if (!key) return null;
  const id = LEGACY_HASHES[key] || LEGACY_IDS[key] || (findFunction(key) ? key : null);
  return id ? findFunction(id).path : null;
};
