/**
 * Convert JobApplication.status legacy values to the canonical set:
 *   pending, under_review, shortlisted, approved, rejected, hired, withdrawn
 *
 * No controller has written "Applied", "Reviewed"/"reviewed", "Accepted", or
 * "Rejected" (capitalized) in a long time — they're dead values left over
 * from an earlier schema revision, still present in server/models/
 * JobApplication.js's enum only so an unrelated save() (e.g. editing a
 * resume) on an un-migrated document doesn't fail full-document validation.
 * Run this once per environment to retire them for good.
 *
 * Safe to run more than once — documents already holding a canonical value
 * are skipped.
 *
 *   node scripts/migrateApplicationStatuses.js           # apply
 *   node scripts/migrateApplicationStatuses.js --dry-run  # report only
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

const JobApplication = require("../models/JobApplication");

const STATUS_MAP = {
  Applied: "pending",
  Reviewed: "under_review",
  reviewed: "under_review",
  Accepted: "hired",
  Rejected: "rejected",
};

async function run() {
  const dryRun = process.argv.includes("--dry-run");
  // config/db.js (the actual app) connects via MONGO_URI — matching that here,
  // not the differently-named MONGODB_URI, so this script targets the same
  // database the app itself would use.
  const mongoURI = process.env.MONGO_URI;
  if (!mongoURI) {
    console.error("MONGO_URI is not set — refusing to guess a connection target for a data migration.");
    process.exit(1);
  }

  console.log(`Connecting to MongoDB at: ${mongoURI.replace(/\/\/.*@/, "//<hidden>@")}`);
  await mongoose.connect(mongoURI);
  console.log(`Connected. Mode: ${dryRun ? "DRY RUN" : "APPLY"}`);

  // Query the raw collection, bypassing Mongoose's schema cast, so this only
  // ever touches documents genuinely still holding one of the legacy values.
  const collection = JobApplication.collection;
  const legacyStatuses = Object.keys(STATUS_MAP);
  const legacyDocs = await collection
    .find({ status: { $in: legacyStatuses } })
    .project({ _id: 1, status: 1 })
    .toArray();

  console.log(`Found ${legacyDocs.length} application(s) with a legacy status value.`);

  let updated = 0;
  for (const doc of legacyDocs) {
    const next = STATUS_MAP[doc.status];
    console.log(`${dryRun ? "Would update" : "Updated"}: ${doc._id} => "${doc.status}" -> "${next}"`);
    if (!dryRun) {
      await collection.updateOne({ _id: doc._id }, { $set: { status: next } });
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
