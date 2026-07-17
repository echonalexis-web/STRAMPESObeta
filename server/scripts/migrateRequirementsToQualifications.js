const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

// Load environment variables from the server root
dotenv.config({ path: path.join(__dirname, "../.env") });

// Import models
const JobVacancy = require("../models/JobVacancy");

async function migrateRequirementsToQualifications() {
  try {
    const mongoURI = process.env.MONGODB_URI || "mongodb+srv://alexis:ecjan05@stram-peso.nevsgla.mongodb.net/?appName=STRAM-PESO";
    console.log(`🔍 Connecting to MongoDB at: ${mongoURI.replace(/\/\/.*@/, '//<hidden>@')}`);

    // Remove deprecated options – they are now ignored anyway
    await mongoose.connect(mongoURI);
    console.log("✅ Connected to MongoDB");

    console.log("📊 Fetching jobs with legacy requirements...");
    
    const jobs = await JobVacancy.find({
      requirements: { $exists: true, $ne: "" },
      $or: [
        { qualifications: { $exists: false } },
        { qualifications: { $size: 0 } },
        { qualifications: null }
      ]
    });

    console.log(`📋 Found ${jobs.length} jobs to migrate`);

    let updatedCount = 0;
    let errorCount = 0;

    for (const job of jobs) {
      try {
        if (job.qualifications && job.qualifications.length > 0) {
          console.log(`⏭️  Skipping job ${job._id} (already has qualifications)`);
          continue;
        }

        const qualification = {
          type: "other",
          value: job.requirements.trim(),
          optional: false,
          order: 0,
        };

        job.qualifications = [qualification];
        await job.save();
        updatedCount++;
        console.log(`✅ Migrated job ${job._id}: "${job.title}"`);
      } catch (err) {
        errorCount++;
        console.error(`❌ Failed to migrate job ${job._id}:`, err.message);
      }
    }

    console.log("\n📊 Migration Summary:");
    console.log(`   ✅ Updated: ${updatedCount} jobs`);
    console.log(`   ❌ Errors: ${errorCount} jobs`);
    console.log(`   ⏭️  Skipped: ${jobs.length - updatedCount - errorCount} jobs`);

    // FIXED: Use $ne: [] to count non‑empty qualification arrays
    const remaining = await JobVacancy.countDocuments({
      requirements: { $exists: true, $ne: "" },
      qualifications: { $exists: true, $ne: [] }
    });
    console.log(`   📝 Jobs with both requirements and qualifications: ${remaining}`);

  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("👋 Disconnected from MongoDB");
  }
}

migrateRequirementsToQualifications();