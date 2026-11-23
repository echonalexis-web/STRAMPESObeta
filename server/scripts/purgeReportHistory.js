#!/usr/bin/env node
/* eslint-disable no-console */
// Deletes report-export HISTORY rows (metadata only) older than the retention period
// (HISTORY_RETENTION_MONTHS in services/analytics/config.js, 24 months). The audit entries
// follow the audit policy and are not touched.
//
//   node scripts/purgeReportHistory.js            dry run: counts what would be deleted
//   node scripts/purgeReportHistory.js --apply    deletes
//
// Never run by the app. Written for PESO to run on a schedule they choose.

require("dotenv").config();
const mongoose = require("mongoose");
const ReportExport = require("../models/ReportExport");
const { HISTORY_RETENTION_MONTHS } = require("../services/analytics/config");

const cutoffFor = (now = new Date()) => {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - HISTORY_RETENTION_MONTHS);
  return cutoff;
};

const main = async () => {
  const apply = process.argv.includes("--apply");
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const cutoff = cutoffFor();
  const filter = { createdAt: { $lt: cutoff } };
  const count = await ReportExport.countDocuments(filter);
  console.log(`Report history older than ${cutoff.toISOString()}: ${count} row(s).`);
  if (apply && count > 0) {
    const result = await ReportExport.deleteMany(filter);
    console.log(`Deleted ${result.deletedCount} row(s).`);
  } else if (!apply) {
    console.log("Dry run. Pass --apply to delete.");
  }
  await mongoose.disconnect();
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { cutoffFor };
