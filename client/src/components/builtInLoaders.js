import names from "../data/builtInTemplateNames.json";
import { buildBuiltInManifest, manifestPayload } from "../utils/builtInTemplates";

// The built-in banners and avatars are SVG files bundled with the client. Vite's glob
// import turns each into a lazy loader, so nothing is downloaded until the superadmin
// installs the built-ins (and each file is read as text, never rendered here). The
// install sends them to the server, which validates and rasterizes every one exactly
// like a custom upload. The PNG copies that sit next to the avatar SVGs are not used.
const SOURCES = {
  banner: import.meta.glob("../assets/cover-images/*.svg", { query: "?raw", import: "default" }),
  avatar: import.meta.glob("../assets/avatars/*.svg", { query: "?raw", import: "default" }),
};

const baseName = (path) => String(path).split("/").pop();

// Builds the FormData for POST .../builtins: a "manifest" JSON field and the "images"
// files in the same order. Returns { manifest, formData }.
export async function buildBuiltInUpload(kind) {
  const sources = SOURCES[kind] || {};
  const manifest = buildBuiltInManifest(kind, Object.keys(sources), names);
  const formData = new FormData();
  formData.append("manifest", JSON.stringify(manifestPayload(manifest)));
  for (const entry of manifest) {
    const text = await sources[entry.path]();
    formData.append("images", new File([text], baseName(entry.path), { type: "image/svg+xml" }));
  }
  return { manifest, formData };
}

// The manifest alone (no file is read): used to tell which built-ins are missing.
export const builtInManifest = (kind) => buildBuiltInManifest(kind, Object.keys(SOURCES[kind] || {}), names);
