/**
 * One-time seed: populate SystemOption from today's hardcoded
 * industries/jobTypes/governmentIdTypes lists, preserving their current
 * (already-alphabetized) order. Idempotent — a {category, value} pair
 * already in the collection is skipped, not duplicated.
 *
 *   node scripts/seedSystemOptions.js           # apply
 *   node scripts/seedSystemOptions.js --dry-run  # report only
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

const SystemOption = require("../models/SystemOption");
const VALID_INDUSTRIES = require("../data/industries");
const VALID_JOB_TYPES = require("../data/jobTypes");
const VALID_GOVERNMENT_ID_TYPES = require("../data/governmentIdTypes");

const SEED_SOURCES = [
  { category: "industry", values: VALID_INDUSTRIES },
  { category: "jobType", values: VALID_JOB_TYPES },
  { category: "governmentIdType", values: VALID_GOVERNMENT_ID_TYPES },
];

async function run() {
  const dryRun = process.argv.includes("--dry-run");
  // config/db.js (the actual app) connects via MONGO_URI — matching that here,
  // not the differently-named MONGODB_URI, so this script targets the same
  // database the app itself would use.
  const mongoURI = process.env.MONGO_URI;
  if (!mongoURI) {
    console.error("MONGO_URI is not set — refusing to guess a connection target for a data seed.");
    process.exit(1);
  }

  console.log(`Connecting to MongoDB at: ${mongoURI.replace(/\/\/.*@/, "//<hidden>@")}`);
  await mongoose.connect(mongoURI);
  console.log(`Connected. Mode: ${dryRun ? "DRY RUN" : "APPLY"}`);

  let inserted = 0;
  let skipped = 0;

  for (const { category, values } of SEED_SOURCES) {
    for (let i = 0; i < values.length; i += 1) {
      const value = values[i];
      const exists = await SystemOption.exists({ category, value });
      if (exists) {
        console.log(`Skip (exists): ${category} / "${value}"`);
        skipped += 1;
        continue;
      }
      console.log(`${dryRun ? "Would insert" : "Insert"}: ${category} / "${value}" (order ${i})`);
      if (!dryRun) {
        await SystemOption.create({ category, value, order: i, isActive: true });
      }
      inserted += 1;
    }
  }

  console.log("\nSummary:");
  console.log(`${dryRun ? "Would insert" : "Inserted"}: ${inserted}`);
  console.log(`Skipped (already present): ${skipped}`);
}

run()
  .then(() => mongoose.disconnect())
  .then(() => {
    console.log("Done.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });
