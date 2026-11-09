/**
 * Seed the starter banner templates (data/bannerTemplateStarters.js).
 * Idempotent by slug. DRY RUN by default; nothing is written without --apply.
 * Prints counts only, never connection secrets.
 *
 *   node scripts/seedBannerTemplates.js           # report only
 *   node scripts/seedBannerTemplates.js --apply   # write missing templates
 *
 * The seed is optional: with no template documents every account still renders
 * the built-in "Classic green".
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

const BannerTemplate = require("../models/BannerTemplate");
const STARTERS = require("../data/bannerTemplateStarters");
const { validateDefinition } = require("../services/bannerTemplateService");

async function run() {
  const apply = process.argv.includes("--apply");
  const mongoURI = process.env.MONGO_URI;
  if (!mongoURI) {
    console.error("MONGO_URI is not set. Refusing to guess a connection target for a data seed.");
    process.exit(1);
  }

  for (const starter of STARTERS) {
    const checked = validateDefinition(starter.definition);
    if (!checked.ok) {
      console.error(`Starter "${starter.slug}" is invalid: ${checked.reason}`);
      process.exit(1);
    }
  }

  await mongoose.connect(mongoURI);
  console.log(`Connected. Mode: ${apply ? "APPLY" : "DRY RUN"}`);

  const hasDefault = Boolean(await BannerTemplate.exists({ isDefault: true }));
  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < STARTERS.length; i += 1) {
    const starter = STARTERS[i];
    if (await BannerTemplate.exists({ slug: starter.slug })) {
      skipped += 1;
      continue;
    }
    console.log(`${apply ? "Insert" : "Would insert"}: ${starter.slug}`);
    if (apply) {
      await BannerTemplate.create({
        slug: starter.slug,
        name: starter.name,
        nameFil: starter.nameFil,
        kind: starter.kind,
        overlay: starter.overlay,
        definition: validateDefinition(starter.definition).definition,
        sortOrder: i,
        isActive: true,
        // Only one default may exist; never take it from an existing choice.
        isDefault: Boolean(starter.isDefault) && !hasDefault,
      });
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
