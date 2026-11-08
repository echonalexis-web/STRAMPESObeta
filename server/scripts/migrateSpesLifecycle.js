/**
 * Map legacy SPES application data onto the new lifecycle.
 *
 * NOT required for correctness: the app reads old statuses through
 * normalizeStatus() (under_review -> documents_review, for_exam and
 * for_interview -> qualified), and every new field has a safe default. This
 * script only makes the stored data consistent.
 *
 *   node scripts/migrateSpesLifecycle.js            # DRY RUN (default): report only
 *   node scripts/migrateSpesLifecycle.js --apply    # write the changes
 *
 * What it does (idempotent):
 *   - under_review            -> documents_review
 *   - for_exam / for_interview -> qualified
 *   - evaluated with a decided outcome (not "pending") and results not released
 *                             -> result_recorded
 *   - applicantType           <- "osy" when isOutOfSchoolYouth, else "student"
 *   - disqualified rows with no disqualification.reason: reason <- result.remarks
 *
 * Run it against a local or staging copy first. Take a backup before --apply
 * on any real database.
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

const SpesApplication = require("../models/SpesApplication");

async function run() {
  const apply = process.argv.includes("--apply");
  const mongoURI = process.env.MONGO_URI;
  if (!mongoURI) throw new Error("MONGO_URI is not set (check server/.env).");
  await mongoose.connect(mongoURI);
  console.log(`Connected. Mode: ${apply ? "APPLY" : "DRY RUN"}`);

  const steps = [
    { label: "under_review -> documents_review", filter: { status: "under_review" }, set: { status: "documents_review" } },
    { label: "for_exam/for_interview -> qualified", filter: { status: { $in: ["for_exam", "for_interview"] } }, set: { status: "qualified" } },
    {
      label: "evaluated with decided outcome -> result_recorded",
      filter: { status: "evaluated", "result.outcome": { $ne: "pending" }, resultReleasedAt: null },
      set: { status: "result_recorded" },
    },
    { label: "applicantType osy", filter: { isOutOfSchoolYouth: true, applicantType: { $ne: "osy" } }, set: { applicantType: "osy" } },
  ];

  for (const step of steps) {
    const count = await SpesApplication.countDocuments(step.filter);
    console.log(`${step.label}: ${count} row(s)`);
    if (apply && count > 0) {
      const result = await SpesApplication.updateMany(step.filter, { $set: step.set });
      console.log(`  updated ${result.modifiedCount}`);
    }
  }

  const disq = await SpesApplication.find({
    status: "disqualified",
    $or: [{ "disqualification.reason": "" }, { "disqualification.reason": { $exists: false } }],
    "result.remarks": { $nin: ["", null] },
  }).select("result.remarks");
  console.log(`disqualified rows to seed a reason from remarks: ${disq.length}`);
  if (apply) {
    for (const row of disq) {
      await SpesApplication.updateOne({ _id: row._id }, { $set: { "disqualification.reason": row.result.remarks, "disqualification.at": new Date() } });
    }
  }
  if (!apply) console.log("Dry run: nothing was changed. Re-run with --apply to write.");
}

run()
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Migration failed:", error.message);
    process.exit(1);
  });
