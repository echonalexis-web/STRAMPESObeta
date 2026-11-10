/**
 * Install the built-in banner templates and avatar presets from the SVG files bundled
 * with the client (client/src/assets/cover-images and client/src/assets/avatars).
 *
 *   node scripts/installBuiltInTemplates.js            # DRY RUN: report only
 *   node scripts/installBuiltInTemplates.js --apply    # write the missing built-ins
 *
 * Same pipeline and rules as the "Install built-in templates" button in the
 * superadmin screen (services/builtInTemplateService.js): every file is content
 * sniffed, checked for unsafe SVG content and rasterized to WebP; idempotent by the
 * stable key (builtin-banner-01, builtin-avatar-01); an existing key is skipped, so
 * a second run creates nothing and never overwrites edits. Never sets a default when
 * one exists. Prints counts and keys only, never connection secrets.
 *
 * DRY RUN processes the files and reads the database, but stores and writes nothing.
 * With --apply, images go through storageService: a REAL Cloudinary account when
 * STORAGE_DRIVER=cloudinary, which needs the extra flag --allow-cloudinary.
 * Back up the database first. Written for you to run; it has not been run.
 */
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "../.env") });

const { PROFILES, processTemplateImage, TemplateImageError } = require("../services/bannerTemplateImageService");
const { installBuiltIns, summarize } = require("../services/builtInTemplateService");
const names = require("../../client/src/data/builtInTemplateNames.json");

const KINDS = [
  { kind: "banner", dir: path.join(__dirname, "../../client/src/assets/cover-images"), prefix: "Banner_", category: "bannerTemplate", profile: PROFILES.banner },
  { kind: "avatar", dir: path.join(__dirname, "../../client/src/assets/avatars"), prefix: "Avatar_", category: "avatarPreset", profile: PROFILES.avatar },
];

// Banner_01_Forest_Dots.svg -> { number: "01", key: "builtin-banner-01" }
const parse = (kind, prefix, fileName) => {
  const m = fileName.match(new RegExp(`^${prefix}(\\d{2,3})_.+\\.svg$`));
  return m ? { number: m[1], key: `builtin-${kind}-${m[1]}` } : null;
};

async function run() {
  const apply = process.argv.includes("--apply");
  const mongoURI = process.env.MONGO_URI;
  if (!mongoURI) {
    console.error("MONGO_URI is not set. Refusing to guess a connection target for a data change.");
    process.exit(1);
  }
  if (apply && String(process.env.STORAGE_DRIVER || "local").toLowerCase() === "cloudinary" && !process.argv.includes("--allow-cloudinary")) {
    console.error("STORAGE_DRIVER=cloudinary would upload to a real Cloudinary account. Re-run with --allow-cloudinary if that is intended.");
    process.exit(1);
  }

  const plans = KINDS.map((spec) => {
    const files = fs
      .readdirSync(spec.dir)
      .map((fileName) => ({ fileName, parsed: parse(spec.kind, spec.prefix, fileName) }))
      .filter((f) => f.parsed)
      .sort((a, b) => a.parsed.number.localeCompare(b.parsed.number));
    const entries = files.map((f, i) => ({
      key: f.parsed.key,
      name: names[spec.kind][f.parsed.number]?.name || f.fileName,
      nameFil: names[spec.kind][f.parsed.number]?.nameFil || "",
      isDefault: spec.kind === "banner" && i === 0,
    }));
    const buffers = files.map((f) => ({ buffer: fs.readFileSync(path.join(spec.dir, f.fileName)), originalname: f.fileName, mimetype: "image/svg+xml" }));
    return { ...spec, entries, buffers };
  });

  // Everything is processed before anything is written: one bad file stops the run.
  for (const plan of plans) {
    for (let i = 0; i < plan.buffers.length; i += 1) {
      try {
        await processTemplateImage(plan.buffers[i], plan.profile);
      } catch (error) {
        console.error(`Rejected "${plan.buffers[i].originalname}": ${error instanceof TemplateImageError ? error.code : "UNKNOWN"}`);
        process.exit(1);
      }
    }
    console.log(`${plan.kind}: ${plan.entries.length} files checked`);
  }

  const BannerTemplate = require("../models/BannerTemplate");
  const AvatarPreset = require("../models/AvatarPreset");
  await mongoose.connect(mongoURI);
  console.log(`Connected. Mode: ${apply ? "APPLY" : "DRY RUN"}. Storage: ${process.env.STORAGE_DRIVER || "local"}.`);

  for (const plan of plans) {
    const Model = plan.kind === "banner" ? BannerTemplate : AvatarPreset;
    if (!apply) {
      const have = new Set((await Model.find({ builtInKey: { $in: plan.entries.map((e) => e.key) } }).select("builtInKey").lean()).map((r) => r.builtInKey));
      const missing = plan.entries.filter((e) => !have.has(e.key));
      console.log(`${plan.kind}: would install ${missing.length}, already present ${have.size}`);
      missing.forEach((e) => console.log(`  would install ${e.key} (${e.name})`));
      continue;
    }
    const hasDefault = plan.kind === "banner" ? Boolean(await BannerTemplate.exists({ isDefault: true })) : true;
    const results = await installBuiltIns({
      Model,
      profile: plan.profile,
      category: plan.category,
      entries: plan.entries,
      files: plan.buffers,
      hasDefault,
      makeDoc: (entry, ctx) => ({
        slug: entry.key,
        name: entry.name,
        nameFil: entry.nameFil,
        image: ctx.image,
        ...(plan.kind === "banner" ? { kind: "image", overlay: ctx.overlay, isDefault: ctx.isDefault } : {}),
        isBuiltIn: true,
        builtInKey: entry.key,
        isActive: true,
        sortOrder: ctx.sortOrder,
      }),
    });
    const counts = summarize(results);
    console.log(`${plan.kind}: created ${counts.created}, existing ${counts.existing}, failed ${counts.failed}`);
  }
  await mongoose.disconnect();
}

run().catch((error) => {
  console.error("Install failed:", error.message);
  process.exit(1);
});
