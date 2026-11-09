/**
 * Swap the `users` unique indexes for the username sign-up feature.
 *
 *   node scripts/swapUserEmailUsernameIndexes.js           # DRY RUN (default): report only
 *   node scripts/swapUserEmailUsernameIndexes.js --apply   # make the changes
 *
 * WHAT IT DOES (with --apply, in this order):
 *   1. Unset an explicit `username: null` (the old schema default wrote one).
 *   2. Unset an empty-string `email` (should not exist; counted in the report).
 *   3. Drop `email_1`, the old full `email_unique_ci` and the sparse
 *      `username_unique_ci`, if present.
 *   4. Create `email_unique_ci` and `username_unique_ci` as PARTIAL unique
 *      indexes (`$type: "string"`) with the case-insensitive collation.
 *
 * Even the dry run connects to MONGO_URI (it has to count documents), so point
 * it at a BACKUP COPY. The report prints COUNTS ONLY: never an email address or
 * a username. If case-insensitive duplicates exist the script refuses to run.
 *
 * Between step 3 and step 4 the database has no unique index on these fields:
 * run it in a quiet window.
 *
 * ROLLBACK is one-way once email-less accounts exist: recreating the full
 * `email_1` index fails on missing emails. Turn USERNAME_SIGNUP_ENABLED off
 * first; give those accounts an email (recovery queue) or remove them by an
 * explicit decision before reverting the indexes.
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

const COLLATION = { locale: "en", strength: 2 };

const OLD_INDEX_NAMES = ["email_1", "email_unique_ci", "username_unique_ci"];

const NEW_INDEXES = [
  {
    key: { email: 1 },
    options: {
      name: "email_unique_ci",
      unique: true,
      collation: COLLATION,
      partialFilterExpression: { email: { $type: "string" } },
    },
  },
  {
    key: { username: 1 },
    options: {
      name: "username_unique_ci",
      unique: true,
      collation: COLLATION,
      partialFilterExpression: { username: { $type: "string" } },
    },
  },
];

// Pure: the shape of the plan, so it can be tested without a database.
const buildPlan = () => ({
  unsetExplicitNullUsername: { filter: { username: null }, update: { $unset: { username: "" } } },
  unsetEmptyEmail: { filter: { email: "" }, update: { $unset: { email: "" } } },
  dropIndexes: [...OLD_INDEX_NAMES],
  createIndexes: NEW_INDEXES,
});

// Groups by the lowercased value and counts groups with more than one member.
const duplicateCount = async (collection, field) => {
  const rows = await collection
    .aggregate([
      { $match: { [field]: { $type: "string", $ne: "" } } },
      { $group: { _id: { $toLower: `$${field}` }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
      { $count: "groups" },
    ])
    .toArray();
  return rows[0]?.groups || 0;
};

async function run() {
  const apply = process.argv.includes("--apply");
  const mongoURI = process.env.MONGO_URI;
  if (!mongoURI) throw new Error("MONGO_URI is not set (check server/.env).");

  await mongoose.connect(mongoURI);
  console.log(`Connected. Mode: ${apply ? "APPLY" : "DRY RUN (no changes)"}`);

  const users = mongoose.connection.collection("users");
  const plan = buildPlan();

  const report = {
    totalUsers: await users.countDocuments({}),
    explicitNullUsername: await users.countDocuments(plan.unsetExplicitNullUsername.filter),
    emptyStringEmail: await users.countDocuments(plan.unsetEmptyEmail.filter),
    usersWithoutEmail: await users.countDocuments({ email: { $exists: false } }),
    duplicateEmailGroups: await duplicateCount(users, "email"),
    duplicateUsernameGroups: await duplicateCount(users, "username"),
  };
  const existing = (await users.indexes()).map((i) => i.name);
  console.log("Report (counts only):", report);
  console.log("Existing indexes:", existing.join(", "));

  if (report.duplicateEmailGroups > 0 || report.duplicateUsernameGroups > 0) {
    throw new Error("Case-insensitive duplicates exist. Resolve them first; nothing was changed.");
  }

  if (!apply) {
    console.log("Would unset", report.explicitNullUsername, "explicit-null username value(s).");
    console.log("Would unset", report.emptyStringEmail, "empty-string email value(s).");
    console.log("Would drop (if present):", plan.dropIndexes.join(", "));
    console.log("Would create:", plan.createIndexes.map((i) => i.options.name).join(", "));
    console.log("Re-run with --apply to make these changes.");
    return;
  }

  const unsetNull = await users.updateMany(plan.unsetExplicitNullUsername.filter, plan.unsetExplicitNullUsername.update);
  console.log("Unset explicit-null username on", unsetNull.modifiedCount, "document(s).");
  const unsetEmpty = await users.updateMany(plan.unsetEmptyEmail.filter, plan.unsetEmptyEmail.update);
  console.log("Unset empty-string email on", unsetEmpty.modifiedCount, "document(s).");

  for (const name of plan.dropIndexes) {
    if (existing.includes(name)) {
      await users.dropIndex(name);
      console.log("Dropped index", name);
    }
  }
  for (const { key, options } of plan.createIndexes) {
    await users.createIndex(key, options);
    console.log("Created index", options.name);
  }
}

module.exports = { buildPlan, NEW_INDEXES, OLD_INDEX_NAMES };

if (require.main === module) {
  run()
    .then(() => mongoose.disconnect())
    .then(() => {
      console.log("Done.");
      process.exit(0);
    })
    .catch(async (error) => {
      console.error("Index swap failed:", error.message);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
