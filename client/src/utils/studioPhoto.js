// The resume photo the applicant uploads for the resumes they make in the Studio. It is its own
// image (server: /jobseeker/documents/photo), never the profile photo.
//
// The picture is read once into a data: URL so the resume holds the picture itself: drawing it into
// the PDF is not blocked by the image's origin, and a resume saved today keeps its photo even if the
// applicant later replaces or removes theirs.

export const PHOTO_MAX_BYTES = 2 * 1024 * 1024; // the same cap the server enforces
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Quick check before anything is sent. The server still decides from the real bytes.
// Returns "" when fine, else "type" or "size".
export const photoFileProblem = (file) => {
  if (!file) return "type";
  if (!PHOTO_TYPES.includes(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name || "")) return "type";
  if (file.size > PHOTO_MAX_BYTES) return "size";
  return "";
};

// A Blob as a data: URL, or "" if it cannot be read or is not a jpeg/png/webp.
export const blobToDataUrl = (blob) =>
  new Promise((resolve) => {
    if (!blob || !PHOTO_TYPES.includes(blob.type)) {
      resolve("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => resolve("");
    reader.readAsDataURL(blob);
  });
