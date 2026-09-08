const cloudinary = require("cloudinary").v2;

const STORAGE_DRIVER = String(process.env.STORAGE_DRIVER || "local").toLowerCase();
const isCloudinary = STORAGE_DRIVER === "cloudinary";

if (isCloudinary) {
  // The SDK auto-reads CLOUDINARY_URL, but configure explicitly so a missing
  // value fails loudly at boot instead of on the first upload.
  if (process.env.CLOUDINARY_URL) {
    cloudinary.config({ secure: true });
  } else if (
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  ) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  } else {
    throw new Error(
      "STORAGE_DRIVER=cloudinary but no Cloudinary credentials found. " +
        "Set CLOUDINARY_URL (or CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET).",
    );
  }
}

module.exports = {
  cloudinary,
  STORAGE_DRIVER,
  isCloudinary,
  ROOT_FOLDER: process.env.CLOUDINARY_FOLDER || "stram-peso",
  SIGNED_URL_TTL_SECONDS: Math.max(30, Number(process.env.SIGNED_URL_TTL_SECONDS) || 180),
};
