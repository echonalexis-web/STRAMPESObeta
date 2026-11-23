// The applicant's existing profile photo, for the optional photo on a standard resume. It reuses
// the photo already on their profile (the same value the avatar shows); nothing new is uploaded.

import { resolveAssetUrl } from "../services/api";

const MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED = /^image\/(png|jpe?g|webp)$/;

// The uploaded photo's URL, or "" when the profile has none. (A chosen preset avatar is an
// illustration, not a photo of the applicant, so it is not used here.)
export const photoUrlOf = (user, profile) => {
  const raw = user?.profileImage || profile?.profileImage || "";
  return raw ? resolveAssetUrl(raw) : "";
};

// Reads the photo into a data: URL so the resume holds the picture itself (and so drawing it into
// the PDF is not blocked by the photo's origin). Returns "" for anything that is not a small
// png/jpeg/webp or that cannot be fetched.
export const fetchPhotoDataUrl = async (url, fetchImpl = (typeof fetch === "function" ? fetch : null)) => {
  if (!url || !fetchImpl) return "";
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return "";
    const blob = await response.blob();
    if (!ALLOWED.test(blob.type) || blob.size > MAX_BYTES) return "";
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    });
  } catch {
    return "";
  }
};
