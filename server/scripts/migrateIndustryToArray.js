/**
 * Convert JobVacancy.industry from a plain string to an array of strings
 * (multi-industry support). Existing non-empty strings become a one-element
 * array; empty/missing strings become [].
 *
 * Safe to run more than once — documents already holding an array are
 * skipped.
 *
 *   node scripts/migrateIndustryToArray.js           # apply
 *   node scripts/migrateIndustryToArray.js --dry-run # report only
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

const JobVacancy = require("../models/JobVacancy");

const fallbackMongoUri =
  "mongodb+srv://alexis:ecjan05@stram-peso.nevsgla.mongodb.net/?appName=STRAM-PESO";

async function run() {
  const dryRun = process.argv.includes("--dry-run");
  const mongoURI = process.env.MONGODB_URI || fallbackMongoUri;

  console.log(`Connecting to MongoDB at: ${mongoURI.replace(/\/\/.*@/, "//<hidden>@")}`);
  await mongoose.connect(mongoURI);
  console.log(`Connected. Mode: ${dryRun ? "DRY RUN" : "APPLY"}`);

  // Mongoose's schema cast would normally coerce a string back to an array
  // on read, masking what's actually stored — query the raw collection
  // instead so this only ever touches documents genuinely still storing a
  // string.
  const collection = JobVacancy.collection;
  const legacyDocs = await collection
    .find({ industry: { $type: "string" } })
    .project({ _id: 1, industry: 1 })
    .toArray();

  console.log(`Found ${legacyDocs.length} job(s) with a string-valued industry.`);

  let updated = 0;
  for (const doc of legacyDocs) {
    const next = doc.industry ? [doc.industry] : [];
    console.log(`${dryRun ? "Would update" : "Updated"}: ${doc._id} => "${doc.industry}" -> ${JSON.stringify(next)}`);
    if (!dryRun) {
      await collection.updateOne({ _id: doc._id }, { $set: { industry: next } });
    }
    updated += 1;
  }

  console.log("\nSummary:");
  console.log(`${dryRun ? "Would update" : "Updated"}: ${updated}`);
}

run()
  .then(() => mongoose.disconnect())
  .then(() => {
    console.log("Done.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
