// Which picture an avatar shows: a chosen preset avatar, else the uploaded photo, else
// initials. A source that failed to load is skipped, so a broken or archived image
// never leaves a broken picture behind.

// "Juan dela Cruz" -> "J" (a single letter, like the places that already do this).
export const initialOf = (name, fallback = "U") => {
  const letter = String(name || "").trim().charAt(0);
  return letter ? letter.toUpperCase() : fallback;
};

// presetUrl and photoUrl are already-resolved URLs ("" when there is none). `failed`
// is a Set of URLs that errored. Returns { kind: "preset" | "photo" | "initials", url }.
export const pickAvatarSource = ({ presetUrl = "", photoUrl = "" } = {}, failed = new Set()) => {
  if (presetUrl && !failed.has(presetUrl)) return { kind: "preset", url: presetUrl };
  if (photoUrl && !failed.has(photoUrl)) return { kind: "photo", url: photoUrl };
  return { kind: "initials", url: "" };
};

// The preset's picture at a given display size: the thumbnail for small avatars, the
// full image for large ones.
export const presetImageUrl = (preset, size, resolve = (value) => value) => {
  const image = preset && preset.image;
  if (!image || !image.url) return "";
  const useFull = typeof size === "number" && size > 96;
  return resolve(useFull ? image.url : image.thumbUrl || image.url);
};
