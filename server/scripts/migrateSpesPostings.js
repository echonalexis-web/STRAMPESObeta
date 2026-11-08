/**
 * Migrate SPES announcements (category "spes") to SpesPosting.
 *
 *   node scripts/migrateSpesPostings.js            # DRY RUN (default): report only
 *   node scripts/migrateSpesPostings.js --apply    # write the changes
 *
 * NOT run by the developers. Run it yourself, on a BACKUP first:
 *   1. Take a backup (mongodump) of the database.
 *   2. Point MONGO_URI at a restored copy and run it without --apply. Read the report.
 *   3. Run with --apply on the copy, check the app, then repeat on the real database.
 *
 * The app keeps working before this is run: unmigrated announcements are read through
 * a legacy adapter. After it is run, the adapter finds the new postings first.
 *
 * What it does (idempotent: safe to run twice):
 *   a. For each legacy announcement with no posting yet, creates a SpesPosting copying
 *      title, content (as description), image, active flag (as published / draft), every
 *      spes.* setting and the results state; sets legacyAnnouncementId.
 *   b. Sets `posting` on every SpesApplication of that announcement (applications keep
 *      their old `announcement` reference too).
 *   c. Sets spesPostingId on the announcement so the news feed shows a link card to the
 *      posting instead of a second copy. Its `spes` subdocument is left untouched.
 *   d. Swaps the unique indexes: drops the old plain {applicant, announcement} and
 *      creates partial unique {applicant, announcement} and {applicant, posting}. This
 *      is required before a second native posting can take an application from the same
 *      person. The dry run lists these steps exactly.
 *
 * The report prints counts only. It never prints names, emails or dates of birth.
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

const Announcement = require("../models/Announcement");
const SpesPosting = require("../models/SpesPosting");
const SpesApplication = require("../models/SpesApplication");
const { planMigration, INDEX_STEPS } = require("../utils/spesMigration");

async function run() {
  const apply = process.argv.includes("--apply");
  const mongoURI = process.env.MONGO_URI;
  if (!mongoURI) throw new Error("MONGO_URI is not set (check server/.env).");
  await mongoose.connect(mongoURI);
  console.log(`Connected. Mode: ${apply ? "APPLY" : "DRY RUN"}`);

  const announcements = await Announcement.find({ category: "spes", spesPostingId: null }).lean();
  const existing = await SpesPosting.find({ legacyAnnouncementId: { $ne: null } }).select("legacyAnnouncementId").lean();
  const plan = planMigration(announcements, new Set(existing.map((p) => String(p.legacyAnnouncementId))));

  console.log(`Legacy SPES announcements found: ${announcements.length}`);
  console.log(`  to migrate: ${plan.toCreate.length}`);
  console.log(`  already migrated (skipped): ${plan.skipped.length}`);

  let relinkedTotal = 0;
  for (const item of plan.toCreate) {
    const toRelink = await SpesApplication.countDocuments({ announcement: item.announcementId, posting: { $exists: false } });
    relinkedTotal += toRelink;
    console.log(`  announcement ${item.announcementId}: ${toRelink} application(s) to relink`);
    if (!apply) continue;

    const posting = await SpesPosting.create(item.fields);
    await SpesApplication.updateMany(
      { announcement: item.announcementId, posting: { $exists: false } },
      { $set: { posting: posting._id } }
    );
    await Announcement.updateOne({ _id: item.announcementId }, { $set: { spesPostingId: posting._id } });
    console.log(`    created posting ${posting._id}`);
  }
  console.log(`Applications to relink in total: ${relinkedTotal}`);

  console.log("Index steps:");
  const collection = SpesApplication.collection;
  const current = await collection.indexes();
  for (const step of INDEX_STEPS) {
    if (step.action === "dropIndex") {
      const present = current.some((ix) => ix.name === step.name && !ix.partialFilterExpression);
      console.log(`  dropIndex ${step.name}: ${present ? "present, will drop" : "not present as a plain index, nothing to drop"} (${step.reason})`);
      if (apply && present) await collection.dropIndex(step.name);
    } else {
      console.log(`  createIndex ${JSON.stringify(step.keys)} ${JSON.stringify(step.options)}`);
      if (apply) await collection.createIndex(step.keys, step.options);
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
