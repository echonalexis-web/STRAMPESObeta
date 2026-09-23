/**
 * Backfill `isEmailVerified` for accounts created before that field existed.
 *
 * NOT required for correctness: User.isEmailVerified has no schema default on
 * purpose (see the comment on it in models/User.js), so a legacy document
 * that has never had this field written reads back as `undefined`, and
 * login() only blocks on a literal `false` — legacy accounts already sign in
 * exactly as before, migrated or not. This script only makes the stored data
 * consistent (e.g. for admin dashboards that may later report on
 * verification status) by explicitly setting `isEmailVerified: true` on
 * every account that predates the verification flow — they were already
 * trusted under the old rules, so this grandfathers them in rather than
 * silently leaving the field blank.
 *
 *   node scripts/migrateEmailVerifiedBackfill.js           # apply
 *   node scripts/migrateEmailVerifiedBackfill.js --dry-run # report only
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

const User = require("../models/User");

async function run() {
  const dryRun = process.argv.includes("--dry-run");
  const mongoURI = process.env.MONGO_URI;
  if (!mongoURI) {
    throw new Error("MONGO_URI is not set (check server/.env).");
  }

  console.log(`Connecting to MongoDB...`);
  await mongoose.connect(mongoURI);
  console.log(`Connected. Mode: ${dryRun ? "DRY RUN" : "APPLY"}`);

  const filter = { isEmailVerified: { $exists: false } };
  const count = await User.countDocuments(filter);
  console.log(`Found ${count} account(s) with no isEmailVerified value yet.`);

  if (!dryRun && count > 0) {
    const result = await User.updateMany(filter, {
      $set: { isEmailVerified: true, emailVerifiedAt: new Date() },
    });
    console.log(`Updated ${result.modifiedCount} account(s).`);
  } else if (dryRun) {
    console.log(`Would set isEmailVerified: true on ${count} account(s).`);
  }
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
