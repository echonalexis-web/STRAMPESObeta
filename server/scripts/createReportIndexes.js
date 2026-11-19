/**
 * Create the indexes the reports and dashboard analytics expect (config/reportIndexes.js).
 *
 *   node scripts/createReportIndexes.js            # DRY RUN (default): lists what exists and what is missing
 *   node scripts/createReportIndexes.js --apply    # create the missing indexes
 *
 * Index builds are not instant on a large collection. Run --apply on a quiet moment, against
 * a local or staging database first. Never run --apply against production without a backup
 * and PESO's go-ahead. This script is NOT run by the app and NOT run automatically.
 * Existing indexes with the same name are left alone; nothing is dropped or changed.
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

const { REPORT_INDEXES } = require("../config/reportIndexes");

async function run() {
  const apply = process.argv.includes("--apply");
  const mongoURI = process.env.MONGO_URI;
  if (!mongoURI) {
    console.error("MONGO_URI is not set (check server/.env).");
    process.exit(1);
  }
  await mongoose.connect(mongoURI);
  console.log(`Connected. Mode: ${apply ? "APPLY" : "DRY RUN"}`);

  const db = mongoose.connection.db;
  const existingCollections = new Set((await db.listCollections().toArray()).map((c) => c.name));
  let missing = 0;
  let created = 0;

  for (const spec of REPORT_INDEXES) {
    const exists = existingCollections.has(spec.collection);
    const current = exists ? await db.collection(spec.collection).indexes() : [];
    const present = current.some((index) => index.name === spec.options.name);
    const label = `${spec.collection}.${spec.options.name} ${JSON.stringify(spec.key)}`;
    if (present) {
      console.log(`  ok       ${label}`);
      continue;
    }
    missing += 1;
    if (!apply) {
      console.log(`  MISSING  ${label}${exists ? "" : " (collection does not exist yet)"}`);
      continue;
    }
    await db.collection(spec.collection).createIndex(spec.key, spec.options);
    created += 1;
    console.log(`  created  ${label}`);
  }

  console.log(`Done. missing=${missing} created=${created}`);
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error.message);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
