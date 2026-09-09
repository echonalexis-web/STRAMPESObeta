/**
 * Re-band the legacy `User.companySize` strings ("1-10", "11-50", ...) onto the
 * NSRP / DOLE MSME classification ("micro" | "small" | "medium" | "large"), so
 * companySize carries the same values as EmployerProfile.totalWorkforceSize.
 *
 * The old bands do not nest cleanly inside the new ones, so mapping is by the
 * band's LOWER bound. Affected employers can re-pick the exact band from
 * Edit Profile afterwards.
 *
 *   node scripts/migrateCompanySizeBands.js           # apply
 *   node scripts/migrateCompanySizeBands.js --dry-run # report only
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

const User = require("../models/User");

const fallbackMongoUri =
  "mongodb+srv://alexis:ecjan05@stram-peso.nevsgla.mongodb.net/?appName=STRAM-PESO";

const NEW_BANDS = ["micro", "small", "medium", "large"];

// Map a legacy value to a new band by its lower bound.
const toBand = (raw) => {
  const value = String(raw || "").trim();
  if (!value || NEW_BANDS.includes(value)) return null; // nothing to do
  const lower = Number((value.match(/\d+/) || [])[0]);
  if (!Number.isFinite(lower)) return null;
  if (lower < 10) return "micro";
  if (lower < 100) return "small";
  if (lower < 200) return "medium";
  return "large";
};

async function run() {
  const dryRun = process.argv.includes("--dry-run");
  const mongoURI = process.env.MONGODB_URI || fallbackMongoUri;

  console.log(`Connecting to MongoDB at: ${mongoURI.replace(/\/\/.*@/, "//<hidden>@")}`);
  await mongoose.connect(mongoURI);
  console.log(`Connected. Mode: ${dryRun ? "DRY RUN" : "APPLY"}`);

  const users = await User.find({
    role: "employer",
    companySize: { $nin: ["", null, ...NEW_BANDS] },
  }).select("_id companyName companySize");

  console.log(`Found ${users.length} employer(s) with legacy companySize values.`);

  let updated = 0;
  let unmapped = 0;

  for (const user of users) {
    const band = toBand(user.companySize);
    if (!band) {
      unmapped += 1;
      console.log(`Unmapped: ${user._id} (${user.companyName}) => "${user.companySize}" left as-is`);
      continue;
    }
    console.log(`${dryRun ? "Would update" : "Updated"}: ${user._id} (${user.companyName}) => "${user.companySize}" -> "${band}"`);
    if (!dryRun) {
      await User.updateOne({ _id: user._id }, { $set: { companySize: band } });
    }
    updated += 1;
  }

  console.log("\nSummary:");
  console.log(`${dryRun ? "Would update" : "Updated"}: ${updated}`);
  console.log(`Unmapped (left untouched): ${unmapped}`);
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
