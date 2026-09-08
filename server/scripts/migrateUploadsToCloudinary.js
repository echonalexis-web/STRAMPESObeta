/**
 * One-off migration: move legacy on-disk upload paths to the configured
 * storage backend (Cloudinary when STORAGE_DRIVER=cloudinary).
 *
 *   node scripts/migrateUploadsToCloudinary.js            # apply
 *   node scripts/migrateUploadsToCloudinary.js --dry-run  # report only
 *   node scripts/migrateUploadsToCloudinary.js --null-missing
 *
 * Values already stored as a full URL or a "cloudinary:" ref are skipped.
 * Files that no longer exist on disk (e.g. wiped by an ephemeral host) are
 * reported and left as-is unless --null-missing is passed.
 */
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, "../.env") });

const mongoose = require("mongoose");
const storageService = require("../services/storageService");

const User = require("../models/User");
const Announcement = require("../models/Announcement");
const JobApplication = require("../models/JobApplication");

const DRY_RUN = process.argv.includes("--dry-run");
const NULL_MISSING = process.argv.includes("--null-missing");

const EXT_MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const UPLOADS_ROOT = path.join(__dirname, "..", "uploads");

// Resolve a legacy stored value to an absolute path under /uploads, if possible.
const resolveLocalPath = (value) => {
  if (!value || typeof value !== "string") return null;
  let v = value.replace(/\\/g, "/");
  const idx = v.toLowerCase().indexOf("uploads/");
  if (idx === -1) return null;
  const rel = v.slice(idx + "uploads/".length);
  return path.join(UPLOADS_ROOT, rel);
};

const isAlreadyMigrated = (value) =>
  typeof value === "string" && (/^https?:\/\//i.test(value) || value.startsWith("cloudinary:"));

const report = {
  migrated: [],
  missing: [],
  skipped: 0,
  failed: [],
};

async function migrateField(Model, doc, field, category, extra = {}) {
  const value = doc[field];
  if (!value) return;
  if (isAlreadyMigrated(value)) {
    report.skipped += 1;
    return;
  }

  const localPath = resolveLocalPath(value);
  const label = `${Model.modelName}#${doc._id}.${field}`;

  if (!localPath || !fs.existsSync(localPath)) {
    report.missing.push({ ref: label, value });
    if (NULL_MISSING && !DRY_RUN) {
      doc[field] = "";
      await doc.save();
    }
    return;
  }

  if (DRY_RUN) {
    report.migrated.push({ ref: label, from: value, to: "(dry-run)" });
    return;
  }

  try {
    const buffer = fs.readFileSync(localPath);
    const ext = path.extname(localPath).toLowerCase();
    const file = {
      buffer,
      mimetype: EXT_MIME[ext] || "application/octet-stream",
      originalname: path.basename(localPath),
    };
    const result = await storageService.upload(file, { category, ...extra });
    doc[field] = result.storedValue;
    await doc.save();
    report.migrated.push({ ref: label, from: value, to: result.storedValue });
  } catch (error) {
    report.failed.push({ ref: label, value, error: error.message });
  }
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected. Mode: ${DRY_RUN ? "DRY-RUN" : "APPLY"}${NULL_MISSING ? " (+null-missing)" : ""}`);

  const users = await User.find({});
  for (const doc of users) {
    await migrateField(User, doc, "profileImage", "avatar", { ownerId: doc._id });
    await migrateField(User, doc, "resumeFile", "resume", { ownerId: doc._id });
    await migrateField(User, doc, "validIdFile", "validId", { ownerId: doc._id });
    await migrateField(User, doc, "businessPermitUrl", "permit", { ownerId: doc._id });
    await migrateField(User, doc, "registrationDocUrl", "registration", { ownerId: doc._id });
  }

  const announcements = await Announcement.find({});
  for (const doc of announcements) {
    await migrateField(Announcement, doc, "imageUrl", "news");
  }

  const applications = await JobApplication.find({});
  for (const doc of applications) {
    await migrateField(JobApplication, doc, "resume", "applicationResume", { subPath: String(doc._id) });
    await migrateField(JobApplication, doc, "coverLetterFile", "applicationCover", { subPath: String(doc._id) });
  }

  const outPath = path.join(__dirname, "..", "migration-report-uploads.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(
    `Done. migrated=${report.migrated.length} missing=${report.missing.length} ` +
      `skipped=${report.skipped} failed=${report.failed.length}\nReport: ${outPath}`,
  );

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
