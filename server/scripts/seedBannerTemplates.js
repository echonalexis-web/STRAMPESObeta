/**
 * Create starter banner templates from uploaded banner images in a local folder.
 *
 *   node scripts/seedBannerTemplates.js --from-dir "C:\banners"            # dry run
 *   node scripts/seedBannerTemplates.js --from-dir "C:\banners" --apply    # write
 *
 * Files are SVG or PNG named "01 Forest Dots.svg": the number sets the order, the
 * rest is the template name. Every file goes through the same pipeline as the
 * superadmin upload (content sniffing, SVG safety, rasterized to 1600x400 WebP plus
 * a thumbnail). Idempotent by slug: a template that already exists is skipped.
 *
 * With no --from-dir the script does nothing (it does not touch the database).
 * DRY RUN is the default: files are processed and reported, nothing is stored or
 * written. With --apply, the images are stored through storageService, which means a
 * REAL Cloudinary account when STORAGE_DRIVER=cloudinary; that needs the extra flag
 * --allow-cloudinary. Prints counts and file names only, never connection secrets.
 * Never sets a default template: choose one in the superadmin screen.
 */
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "../.env") });

const { processTemplateImage, TemplateImageError } = require("../services/bannerTemplateImageService");

const argValue = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const slugify = (text) =>
  String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

const MIME = { ".svg": "image/svg+xml", ".png": "image/png" };

// "01 Forest Dots.svg" -> { order: 1, name: "Forest Dots" }. Null for any other file.
const parseFileName = (fileName) => {
  const ext = path.extname(fileName).toLowerCase();
  if (!MIME[ext]) return null;
  const base = path.basename(fileName, path.extname(fileName)).trim();
  const match = base.match(/^(\d+)[\s._-]+(.+)$/);
  const name = (match ? match[2] : base).trim();
  if (!name || name.length > 60) return null;
  return { order: match ? Number(match[1]) : null, name, ext };
};

async function run() {
  const dir = argValue("--from-dir");
  if (!dir) {
    console.log('No --from-dir given: nothing to do. Usage: node scripts/seedBannerTemplates.js --from-dir "<folder>" [--apply]');
    return;
  }
  const apply = process.argv.includes("--apply");
  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    console.error("The --from-dir folder does not exist.");
    process.exit(1);
  }
  const mongoURI = process.env.MONGO_URI;
  if (!mongoURI) {
    console.error("MONGO_URI is not set. Refusing to guess a connection target for a data seed.");
    process.exit(1);
  }
  if (apply && String(process.env.STORAGE_DRIVER || "local").toLowerCase() === "cloudinary" && !process.argv.includes("--allow-cloudinary")) {
    console.error("STORAGE_DRIVER=cloudinary would upload to a real Cloudinary account. Re-run with --allow-cloudinary if that is intended.");
    process.exit(1);
  }

  const files = fs
    .readdirSync(resolved)
    .map((fileName) => ({ fileName, parsed: parseFileName(fileName) }))
    .filter((f) => f.parsed)
    .sort((a, b) => (a.parsed.order ?? 1e9) - (b.parsed.order ?? 1e9) || a.fileName.localeCompare(b.fileName));
  if (files.length === 0) {
    console.log("No SVG or PNG files found in the folder.");
    return;
  }

  // Everything is processed before anything is written: one bad file stops the run.
  const processed = [];
  for (const { fileName, parsed } of files) {
    try {
      const out = await processTemplateImage({
        buffer: fs.readFileSync(path.join(resolved, fileName)),
        originalname: fileName,
        mimetype: MIME[parsed.ext],
      });
      processed.push({ fileName, parsed, out });
    } catch (error) {
      const code = error instanceof TemplateImageError ? error.code : "UNKNOWN";
      console.error(`Rejected "${fileName}": ${code}`);
      process.exit(1);
    }
  }

  const BannerTemplate = require("../models/BannerTemplate");
  const storageService = require("../services/storageService");

  await mongoose.connect(mongoURI);
  console.log(`Connected. Mode: ${apply ? "APPLY" : "DRY RUN"}. Storage: ${process.env.STORAGE_DRIVER || "local"}.`);

  let inserted = 0;
  let skipped = 0;
  const last = await BannerTemplate.findOne({}).sort({ sortOrder: -1 }).select("sortOrder").lean();
  let nextOrder = (last?.sortOrder ?? -1) + 1;

  for (const { fileName, parsed, out } of processed) {
    const slug = slugify(parsed.name);
    if (!slug || (await BannerTemplate.exists({ slug }))) {
      skipped += 1;
      console.log(`Skip (exists or empty slug): ${fileName}`);
      continue;
    }
    console.log(`${apply ? "Insert" : "Would insert"}: ${parsed.name} (${out.sourceType}, overlay ${out.overlay})`);
    if (apply) {
      const stored = [];
      try {
        const large = await storageService.upload({ buffer: out.large.buffer, mimetype: "image/webp" }, { category: "bannerTemplate" });
        stored.push(large.storedValue);
        const small = await storageService.upload({ buffer: out.small.buffer, mimetype: "image/webp" }, { category: "bannerTemplate" });
        stored.push(small.storedValue);
        await BannerTemplate.create({
          slug,
          name: parsed.name,
          nameFil: "",
          kind: "image",
          overlay: out.overlay,
          image: {
            url: large.storedValue,
            thumbUrl: small.storedValue,
            storedValue: large.storedValue,
            thumbStoredValue: small.storedValue,
            width: out.large.width,
            height: out.large.height,
            bytes: out.large.bytes + out.small.bytes,
            placeholderColor: out.placeholderColor || undefined,
            luminance: out.luminance,
          },
          sortOrder: nextOrder,
          isActive: true,
          isDefault: false,
        });
        nextOrder += 1;
      } catch (error) {
        await Promise.allSettled(stored.map((value) => storageService.remove(value)));
        throw error;
      }
    }
    inserted += 1;
  }

  console.log(`${apply ? "Inserted" : "Would insert"} ${inserted}, skipped ${skipped}.`);
  await mongoose.disconnect();
}

run().catch((error) => {
  console.error("Seed failed:", error.message);
  process.exit(1);
});
