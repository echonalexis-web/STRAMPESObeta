/**
 * Renames the "resident" user role to "jobseeker" on existing accounts.
 *
 * The app used to call the jobseeker account type "resident" (and briefly
 * "employee" before that). The role has since been renamed to "jobseeker"
 * everywhere in the codebase — this script brings existing User documents
 * in line with that rename. Legacy "employee" accounts are swept up too,
 * since the app already treated "employee" as an alias for the same role.
 *
 *   node scripts/migrateResidentRoleToJobseeker.js           # apply
 *   node scripts/migrateResidentRoleToJobseeker.js --dry-run # report only
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

const User = require("../models/User");

const fallbackMongoUri =
  "mongodb+srv://alexis:ecjan05@stram-peso.nevsgla.mongodb.net/?appName=STRAM-PESO";

const LEGACY_ROLES = ["resident", "employee"];

async function run() {
  const dryRun = process.argv.includes("--dry-run");
  const mongoURI = process.env.MONGODB_URI || fallbackMongoUri;

  console.log(`Connecting to MongoDB at: ${mongoURI.replace(/\/\/.*@/, "//<hidden>@")}`);
  await mongoose.connect(mongoURI);
  console.log(`Connected. Mode: ${dryRun ? "DRY RUN" : "APPLY"}`);

  const affectedCount = await User.countDocuments({ role: { $in: LEGACY_ROLES } });
  console.log(`Found ${affectedCount} user(s) with a legacy role (${LEGACY_ROLES.join(", ")}).`);

  if (affectedCount === 0) {
    console.log("Nothing to do.");
    return;
  }

  if (dryRun) {
    const sample = await User.find({ role: { $in: LEGACY_ROLES } })
      .select("_id name email role")
      .limit(10);
    sample.forEach((user) => {
      console.log(`Would update: ${user._id} (${user.email}) "${user.role}" -> "jobseeker"`);
    });
    if (affectedCount > sample.length) {
      console.log(`...and ${affectedCount - sample.length} more.`);
    }
    return;
  }

  const result = await User.updateMany(
    { role: { $in: LEGACY_ROLES } },
    { $set: { role: "jobseeker" } }
  );

  console.log("\nSummary:");
  console.log(`Matched: ${result.matchedCount ?? result.n}`);
  console.log(`Updated: ${result.modifiedCount ?? result.nModified}`);
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
