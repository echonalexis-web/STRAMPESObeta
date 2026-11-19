/**
 * Backfill JobApplication.hiredAt for applications that were hired before the field existed.
 *
 *   node scripts/backfillApplicationDates.js            # DRY RUN (default): counts only
 *   node scripts/backfillApplicationDates.js --apply    # write hiredAt
 *
 * For every application whose status is hired (or the legacy "Accepted") and that has no
 * hiredAt, hiredAt is set to statusUpdatedAt (else appliedAt, else createdAt) and
 * hiredAtApproximate is set to true, because statusUpdatedAt is the date of the LAST status
 * change, not necessarily of the hire. Reports mark such dates "approximate".
 *
 * firstResponseAt is deliberately NOT backfilled: the last status change is not the first
 * response, so any value would be wrong. Response metrics only use data from the time the
 * field started being written.
 *
 * Prints counts only, never names, titles or ids. Point MONGO_URI at a local or staging
 * database first. Never run --apply against production without a backup. Not run by the app.
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

const JobApplication = require("../models/JobApplication");

const HIRED = ["hired", "Hired", "accepted", "Accepted"];
const BATCH = 500;

async function run() {
  const apply = process.argv.includes("--apply");
  const mongoURI = process.env.MONGO_URI;
  if (!mongoURI) {
    console.error("MONGO_URI is not set (check server/.env).");
    process.exit(1);
  }
  await mongoose.connect(mongoURI);
  console.log(`Connected. Mode: ${apply ? "APPLY" : "DRY RUN"}`);

  const filter = { status: { $in: HIRED }, hiredAt: null };
  const total = await JobApplication.countDocuments(filter);
  console.log(`${total} hired application(s) without a hire date.`);

  let updated = 0;
  let noDate = 0;
  if (apply) {
    const cursor = JobApplication.find(filter).select("statusUpdatedAt appliedAt createdAt").lean().cursor();
    let operations = [];
    for await (const doc of cursor) {
      const when = doc.statusUpdatedAt || doc.appliedAt || doc.createdAt;
      if (!when) {
        noDate += 1;
        continue;
      }
      operations.push({ updateOne: { filter: { _id: doc._id, hiredAt: null }, update: { $set: { hiredAt: when, hiredAtApproximate: true } } } });
      if (operations.length >= BATCH) {
        const result = await JobApplication.bulkWrite(operations, { ordered: false });
        updated += result.modifiedCount || 0;
        operations = [];
      }
    }
    if (operations.length) {
      const result = await JobApplication.bulkWrite(operations, { ordered: false });
      updated += result.modifiedCount || 0;
    }
  }

  console.log(`Done. ${apply ? `updated=${updated} withNoDate=${noDate}` : "nothing written (dry run)"}`);
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error.message);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
