/**
 * storageService — single abstraction over file persistence.
 *
 * STORAGE_DRIVER=cloudinary → uploads to Cloudinary (public `upload` type for
 *   images that render directly, private `private` type for documents that are
 *   only reachable through a short-lived signed URL).
 * STORAGE_DRIVER=local (default) → keeps the previous on-disk behaviour so the
 *   app runs without Cloudinary credentials.
 *
 * Stored value contract (a single string on the model):
 *   - "https://…"        → public, use directly
 *   - "cloudinary:<b64>" → private ref, resolve via GET /api/v1/files/signed-url
 *   - "/uploads/…"       → legacy local file (still served by server.js)
 */
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { cloudinary, isCloudinary, ROOT_FOLDER, SIGNED_URL_TTL_SECONDS } = require("../config/cloudinary");

const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

const extFromMime = (mimetype) => MIME_EXT[mimetype] || "";

/**
 * category → where it lives and how it is delivered.
 * `visibility: "public"` assets return a permanent URL and may be transformed.
 * `visibility: "private"` assets return an opaque ref; access is always signed.
 */
const CATEGORY_CONFIG = {
  news: {
    dir: "news",
    resourceType: "image",
    visibility: "public",
    transformation: [{ width: 1600, crop: "limit", quality: "auto", fetch_format: "auto" }],
  },
  avatar: {
    dir: "avatars",
    resourceType: "image",
    visibility: "public",
    transformation: [{ width: 512, height: 512, crop: "fill", gravity: "auto", quality: "auto", fetch_format: "auto" }],
  },
  resume: { dir: "resumes", resourceType: "auto", visibility: "private" },
  validId: { dir: "ids", resourceType: "auto", visibility: "private" },
  permit: { dir: "permits", resourceType: "auto", visibility: "private" },
  registration: { dir: "registration", resourceType: "auto", visibility: "private" },
  applicationResume: { dir: "applications", resourceType: "auto", visibility: "private" },
  applicationCover: { dir: "applications", resourceType: "auto", visibility: "private" },
  jobseekerResume: { dir: "jobseeker-documents/resumes", resourceType: "auto", visibility: "private" },
  jobseekerCoverLetter: { dir: "jobseeker-documents/cover-letters", resourceType: "auto", visibility: "private" },
  spes: { dir: "spes", resourceType: "auto", visibility: "private" },
};

const encodeRef = (obj) => `cloudinary:${Buffer.from(JSON.stringify(obj)).toString("base64url")}`;

const decodeRef = (ref) => {
  try {
    return JSON.parse(Buffer.from(String(ref).replace(/^cloudinary:/, ""), "base64url").toString("utf8"));
  } catch (_) {
    return null;
  }
};

const isPrivateRef = (value) => typeof value === "string" && value.startsWith("cloudinary:");

const isRemoteUrl = (value) => typeof value === "string" && /^https?:\/\//i.test(value);

// https://res.cloudinary.com/<cloud>/<rt>/<type>/[transformations/]v123/<public_id>.<ext>
const parseCloudinaryUrl = (url) => {
  const m = String(url).match(
    /\/(image|video|raw)\/(upload|private|authenticated)\/(?:[^/]+\/)*?v\d+\/(.+?)(?:\.[a-z0-9]+)?$/i,
  );
  return m ? { resourceType: m[1], deliveryType: m[2], publicId: m[3] } : null;
};

/* -------------------------------------------------------------------------- */
/* local driver (fallback)                                                    */
/* -------------------------------------------------------------------------- */
const localUpload = (file, cfg) => {
  const dir = path.join(__dirname, "..", "uploads", cfg.dir);
  fs.mkdirSync(dir, { recursive: true });
  const ext = extFromMime(file.mimetype);
  const name = `${uuidv4()}${ext ? `.${ext}` : ""}`;
  fs.writeFileSync(path.join(dir, name), file.buffer);
  const storedValue = `/uploads/${cfg.dir}/${name}`;
  return { storedValue, publicId: `${cfg.dir}/${name}`, visibility: "public", driver: "local" };
};

/* -------------------------------------------------------------------------- */
/* public API                                                                */
/* -------------------------------------------------------------------------- */

/**
 * @param {{buffer:Buffer, mimetype:string, originalname?:string}} file  multer memory file
 * @param {{category:string, ownerId?:string, subPath?:string}} opts
 * @returns {Promise<{storedValue:string, publicId:string, resourceType?:string, deliveryType?:string, visibility:string, driver:string}>}
 */
const upload = async (file, opts = {}) => {
  const cfg = CATEGORY_CONFIG[opts.category];
  if (!cfg) throw new Error(`storageService.upload: unknown category "${opts.category}"`);
  if (!file || !file.buffer) throw new Error("storageService.upload: file buffer is required");

  if (!isCloudinary) return localUpload(file, cfg);

  const uuid = uuidv4();
  const scope = opts.subPath
    ? `${String(opts.subPath).replace(/^\/+|\/+$/g, "")}/`
    : opts.ownerId
      ? `${String(opts.ownerId)}/`
      : "";
  // The category folder, e.g. "stram-peso/news" or "stram-peso/ids/<userId>".
  const folderPath = `${ROOT_FOLDER}/${cfg.dir}/${scope}`.replace(/\/+$/, "");
  const dataUri = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;

  const result = await cloudinary.uploader.upload(dataUri, {
    // `public_id` is just the uuid — the folder is applied separately so it is
    // not doubled on fixed-folder accounts (which prepend `folder` to public_id).
    public_id: uuid,
    // `folder` places the asset for classic (fixed-folder) accounts; `asset_folder`
    // does the same for dynamic-folder-mode accounts, where a slashed public_id
    // alone leaves everything at the library root. Passing both is safe.
    folder: folderPath,
    asset_folder: folderPath,
    resource_type: cfg.resourceType,
    type: cfg.visibility === "private" ? "private" : "upload",
    overwrite: false,
    unique_filename: false,
    use_filename: false,
    ...(cfg.transformation ? { transformation: cfg.transformation } : {}),
  });

  if (cfg.visibility === "public") {
    return {
      storedValue: result.secure_url,
      publicId: result.public_id,
      resourceType: result.resource_type,
      deliveryType: result.type,
      visibility: "public",
      driver: "cloudinary",
    };
  }

  const storedValue = encodeRef({
    p: result.public_id,
    r: result.resource_type,
    t: result.type,
    f: result.format || extFromMime(file.mimetype),
    n: file.originalname || "",
  });
  return {
    storedValue,
    publicId: result.public_id,
    resourceType: result.resource_type,
    deliveryType: result.type,
    visibility: "private",
    driver: "cloudinary",
  };
};

/**
 * Resolve a stored value to something a browser can open.
 * Public URLs pass through; private refs become a time-limited signed URL.
 */
const getSignedUrl = async (value, ttlSeconds = SIGNED_URL_TTL_SECONDS) => {
  if (!value) return null;
  if (isRemoteUrl(value)) return value;

  if (isPrivateRef(value)) {
    const ref = decodeRef(value);
    if (!ref) return null;
    const expiresAt = Math.floor(Date.now() / 1000) + Math.max(30, Number(ttlSeconds) || SIGNED_URL_TTL_SECONDS);
    return cloudinary.utils.private_download_url(ref.p, ref.f || "", {
      resource_type: ref.r || "image",
      type: ref.t || "private",
      expires_at: expiresAt,
    });
  }

  // legacy "/uploads/…": leave as-is, the client resolves it against the API origin
  return value;
};

/** Best-effort delete. Never throws. */
const remove = async (value) => {
  if (!value || typeof value !== "string") return;
  try {
    if (isPrivateRef(value)) {
      const ref = decodeRef(value);
      if (ref) {
        await cloudinary.uploader.destroy(ref.p, { resource_type: ref.r || "image", type: ref.t || "private", invalidate: true });
      }
      return;
    }
    if (/res\.cloudinary\.com/i.test(value)) {
      const parsed = parseCloudinaryUrl(value);
      if (parsed) {
        await cloudinary.uploader.destroy(parsed.publicId, {
          resource_type: parsed.resourceType,
          type: parsed.deliveryType,
          invalidate: true,
        });
      }
      return;
    }
    if (value.startsWith("/uploads/") || value.startsWith("uploads/")) {
      const rel = value.replace(/^\/?uploads\//, "");
      const full = path.join(__dirname, "..", "uploads", rel);
      if (fs.existsSync(full)) fs.unlinkSync(full);
    }
  } catch (_) {
    /* best-effort cleanup */
  }
};

module.exports = {
  upload,
  getSignedUrl,
  remove,
  isPrivateRef,
  isRemoteUrl,
  CATEGORY_CONFIG,
};
