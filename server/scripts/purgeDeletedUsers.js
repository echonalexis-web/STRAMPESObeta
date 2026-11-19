/**
 * Purge job for soft-deleted accounts (superadmin "Delete user").
 *
 * An account deleted from Superadmin > User Management is only marked
 * (deletedAt, purgeAfter) and can be restored until purgeAfter. This job
 * finds accounts whose purgeAfter has passed and permanently removes their
 * personal data: profile, documents and their stored files, avatar and banner
 * files, contact details, messages, likes, follows, notifications. The User
 * document stays as an anonymized "Deleted user" stub so applications, hires,
 * reports and counts keep their meaning, and an employer's postings stay unlisted.
 *
 *   node scripts/purgeDeletedUsers.js                # DRY RUN (default): lists what is due
 *   node scripts/purgeDeletedUsers.js --apply        # purge for real
 *   node scripts/purgeDeletedUsers.js --apply --limit=25
 *
 * Idempotent: an account already purged is skipped, a re-run after a partial
 * failure repeats only steps that still have something to do. Every purged
 * account writes an audit entry (actor "system", counts only, no personal data).
 *
 * NOT run automatically. Point MONGO_URI at a local or staging database first;
 * never run --apply against production without a backup and PESO sign-off on
 * the retention period.
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

const User = require("../models/User");
const storage = require("../services/storageService");
const { purgeUser } = require("../services/userDeletionService");
const { logAuditEvent } = require("../services/auditService");

async function run() {
  const apply = process.argv.includes("--apply");
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Math.max(1, parseInt(limitArg.split("=")[1], 10) || 0) : 100;

  const mongoURI = process.env.MONGO_URI;
  if (!mongoURI) throw new Error("MONGO_URI is not set (check server/.env).");
  await mongoose.connect(mongoURI);
  console.log(`Connected. Mode: ${apply ? "APPLY" : "DRY RUN"}, limit ${limit}`);

  const due = await User.find({
    deletedAt: { $ne: null },
    purgedAt: null,
    purgeAfter: { $lte: new Date() },
    role: { $in: ["employer", "jobseeker"] },
  })
    .select("_id role purgeAfter")
    .sort({ purgeAfter: 1 })
    .limit(limit)
    .lean();

  console.log(`${due.length} account(s) due for purge.`);
  const totals = { purged: 0, skipped: 0, failed: 0 };

  for (const row of due) {
    const id = String(row._id);
    try {
      const result = await purgeUser(id, { storage, dryRun: !apply, log: (m) => console.warn(`  warn: ${m}`) });
      if (result.status === "purged") {
        totals.purged += 1;
        await logAuditEvent({
          actorRole: "system",
          action: "admin.user.purged",
          targetUserId: row._id,
          targetType: "user",
          targetId: id,
          severity: "critical",
          metadata: { role: row.role, counts: result.counts },
        });
        console.log(`  purged ${id} (${row.role}) ${JSON.stringify(result.counts)}`);
      } else {
        totals.skipped += 1;
        console.log(`  ${result.status} ${id} (${row.role})`);
      }
    } catch (error) {
      totals.failed += 1;
      console.error(`  FAILED ${id}: ${error.message}`);
    }
  }

  console.log(`Done. purged=${totals.purged} skipped/dry=${totals.skipped} failed=${totals.failed}`);
  await mongoose.disconnect();
  if (totals.failed) process.exitCode = 1;
}

run().catch(async (error) => {
  console.error(error.message);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
