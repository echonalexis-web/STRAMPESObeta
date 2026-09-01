const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

const JobVacancy = require("../models/JobVacancy");

const fallbackMongoUri = "mongodb+srv://alexis:ecjan05@stram-peso.nevsgla.mongodb.net/?appName=STRAM-PESO";

const parseSalaryNumbers = (rawSalary) => {
  const value = String(rawSalary || "").trim();
  if (!value) {
    return { salaryMin: null, salaryMax: null, parseable: false, negotiable: false };
  }

  const lower = value.toLowerCase();
  if (lower.includes("negotiable") || lower === "n/a" || lower === "na") {
    return { salaryMin: null, salaryMax: null, parseable: false, negotiable: true };
  }

  const numbers = [...value.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  if (!numbers.length) {
    return { salaryMin: null, salaryMax: null, parseable: false, negotiable: false };
  }

  const salaryMin = Math.min(...numbers);
  const salaryMax = Math.max(...numbers);

  return {
    salaryMin,
    salaryMax,
    parseable: true,
    negotiable: false,
  };
};

async function migrateJobSalaryNumbers() {
  const mongoURI = process.env.MONGODB_URI || fallbackMongoUri;

  console.log(`Connecting to MongoDB at: ${mongoURI.replace(/\/\/.*@/, "//<hidden>@")}`);
  await mongoose.connect(mongoURI);
  console.log("Connected to MongoDB");

  const jobs = await JobVacancy.find({
    salary: { $exists: true, $ne: "" },
  }).sort({ createdAt: -1 });

  console.log(`Found ${jobs.length} jobs with salary strings to evaluate.`);

  let updated = 0;
  let skipped = 0;
  let negotiable = 0;
  let invalid = 0;

  for (const job of jobs) {
    const parsed = parseSalaryNumbers(job.salary);

    if (parsed.negotiable) {
      job.salaryMin = null;
      job.salaryMax = null;
      await job.save();
      negotiable += 1;
      console.log(`Negotiable: job ${job._id} => salary kept as display text`);
      continue;
    }

    if (!parsed.parseable) {
      skipped += 1;
      console.log(`Skipped: job ${job._id} => no numeric salary found in "${job.salary}"`);
      continue;
    }

    const nextMin = Number(parsed.salaryMin);
    const nextMax = Number(parsed.salaryMax);

    if (!Number.isFinite(nextMin) || !Number.isFinite(nextMax)) {
      invalid += 1;
      console.log(`Invalid: job ${job._id} => ${job.salary}`);
      continue;
    }

    job.salaryMin = nextMin;
    job.salaryMax = nextMax;
    await job.save();

    updated += 1;
    console.log(`Updated: job ${job._id} => ${job.salary} -> min=${nextMin}, max=${nextMax}`);
  }

  console.log("\nMigration summary:");
  console.log(`Updated: ${updated}`);
  console.log(`Negotiable: ${negotiable}`);
  console.log(`Skipped (non-numeric): ${skipped}`);
  console.log(`Invalid: ${invalid}`);
}

migrateJobSalaryNumbers()
  .then(() => {
    console.log("Migration completed successfully.");
    return mongoose.disconnect();
  })
  .then(() => {
    console.log("Disconnected from MongoDB");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
