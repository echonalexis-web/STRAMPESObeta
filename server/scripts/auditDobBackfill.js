/**
 * Age audit for existing jobseeker accounts (date of birth rules).
 *
 * Counts jobseeker-type accounts by age tier and flags the ones found to be
 * under the minimum age for admin review. It NEVER deletes or edits anything
 * else, never prints dates of birth, names, or emails, and reports counts only.
 *
 *   node scripts/auditDobBackfill.js            # DRY RUN (default): report only
 *   node scripts/auditDobBackfill.js --apply    # also set ageReviewRequired on under-15 accounts
 *
 * Accounts with no date of birth are NOT touched: they are asked for it by a
 * blocking prompt on their next sign-in (POST /api/users/me/dob), then locked.
 *
 * Point MONGO_URI at a local or staging database first. Never run --apply
 * against production without a backup and the sign-off of PESO staff.
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

const User = require("../models/User");
const { getAgeTier, TIERS } = require("../utils/age");

const JOBSEEKER_ROLES = ["jobseeker", "employee", "resident"];

async function run() {
  const apply = process.argv.includes("--apply");
  const mongoURI = process.env.MONGO_URI;
  if (!mongoURI) throw new Error("MONGO_URI is not set (check server/.env).");

  await mongoose.connect(mongoURI);
  console.log(`Connected. Mode: ${apply ? "APPLY" : "DRY RUN"}`);

  const counts = { [TIERS.UNDER_15]: 0, [TIERS.MINOR]: 0, [TIERS.ADULT]: 0, [TIERS.SENIOR]: 0, [TIERS.UNKNOWN]: 0 };
  const flagIds = [];

  const cursor = User.find({ role: { $in: JOBSEEKER_ROLES } }).select("dateOfBirth ageReviewRequired").lean().cursor();
  for await (const user of cursor) {
    const tier = getAgeTier(user.dateOfBirth);
    counts[tier] += 1;
    if (tier === TIERS.UNDER_15 && user.ageReviewRequired !== true) flagIds.push(user._id);
  }

  console.log("Accounts by age tier (counts only):");
  console.table(counts);
  console.log(`Under-15 accounts not yet flagged for review: ${flagIds.length}`);

  if (apply && flagIds.length > 0) {
    const result = await User.updateMany({ _id: { $in: flagIds } }, { $set: { ageReviewRequired: true } });
    console.log(`Flagged ${result.modifiedCount} account(s) for admin review.`);
  } else if (!apply) {
    console.log("Dry run: nothing was changed. Re-run with --apply to flag them.");
  }
}

run()
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Audit failed:", error.message);
    process.exit(1);
  });
