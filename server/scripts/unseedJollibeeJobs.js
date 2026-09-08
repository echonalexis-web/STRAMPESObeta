/**
 * Undo seedJollibeeJobs.js — delete the 10 seeded restaurant jobs WITHOUT
 * touching the employer's original postings.
 *
 * How it stays surgical: it only removes vacancies that (a) belong to the
 * target employer, (b) have one of the 10 seeded titles, and (c) whose _id
 * was generated within the recent window (default 6h). The ObjectId embeds
 * its creation time, so this catches rows inserted by the seed run and skips
 * an older, real "Service Crew" that happens to share a title.
 *
 * Usage (from server/):
 *   node scripts/unseedJollibeeJobs.js               # DRY RUN — lists matches, deletes nothing
 *   node scripts/unseedJollibeeJobs.js --yes         # actually delete
 *   node scripts/unseedJollibeeJobs.js --hours 24    # widen the recency window
 *   node scripts/unseedJollibeeJobs.js --employer "Exact Name"
 */

const path = require("path");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "../.env") });

const User = require("../models/User");
const JobVacancy = require("../models/JobVacancy");

const FALLBACK_MONGO_URI =
  "mongodb+srv://alexis:ecjan05@stram-peso.nevsgla.mongodb.net/?appName=STRAM-PESO";

const SEED_TITLES = [
  "Service Crew",
  "Cashier",
  "Cook / Kitchen Crew",
  "Store Supervisor",
  "Delivery Rider",
  "Kitchen Steward / Dishwasher",
  "Barista",
  "Shift Manager",
  "Baker / Pastry Assistant",
  "Dining Area Attendant / Busser",
];

const args = process.argv.slice(2);
const CONFIRM = args.includes("--yes");
const hoursFlagIdx = args.indexOf("--hours");
const HOURS = hoursFlagIdx !== -1 && args[hoursFlagIdx + 1] ? Number(args[hoursFlagIdx + 1]) : 6;
const employerFlagIdx = args.indexOf("--employer");
const EMPLOYER_NAME =
  employerFlagIdx !== -1 && args[employerFlagIdx + 1] ? args[employerFlagIdx + 1] : "Jollibee Fastfood";

(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || FALLBACK_MONGO_URI;
  await mongoose.connect(uri);
  console.log("✅ Connected to MongoDB");

  try {
    const rx = new RegExp(`^${EMPLOYER_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    const employer = await User.findOne({
      role: "employer",
      $or: [{ name: rx }, { companyName: rx }],
    });
    if (!employer) {
      console.error(`❌ No employer found with name/companyName "${EMPLOYER_NAME}".`);
      process.exitCode = 1;
      return;
    }
    console.log(`👔 Employer: ${employer.name} <${employer.email}>  (${employer._id})`);

    const cutoffMs = Date.now() - HOURS * 3600000;
    const cutoffId = mongoose.Types.ObjectId.createFromTime(Math.floor(cutoffMs / 1000));

    const filter = {
      employer: employer._id,
      title: { $in: SEED_TITLES },
      _id: { $gte: cutoffId },
    };

    const matches = await JobVacancy.find(filter).select("title slots status createdAt _id").lean();

    if (!matches.length) {
      console.log(
        `\nNothing to undo: no seeded jobs for this employer created in the last ${HOURS}h. ` +
          `Try a wider window with --hours 48.`
      );
      return;
    }

    console.log(`\n${matches.length} job(s) match (created within ${HOURS}h, seeded titles):`);
    matches.forEach((j) => {
      const insertedAt = j._id.getTimestamp().toISOString().slice(0, 19).replace("T", " ");
      console.log(`   • ${j.title.padEnd(30)} status=${j.status}  inserted ${insertedAt}  ${j._id}`);
    });

    if (!CONFIRM) {
      console.log(
        "\nDRY RUN — nothing deleted. Re-run with --yes to delete these, " +
          "or delete all applications for them too is NOT handled here (there should be none for fresh seeds)."
      );
      return;
    }

    const res = await JobVacancy.deleteMany({ _id: { $in: matches.map((m) => m._id) } });
    console.log(`\n🧹 Deleted ${res.deletedCount} seeded job(s).`);
  } catch (err) {
    console.error("❌ Unseed failed:", err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected");
  }
})();
