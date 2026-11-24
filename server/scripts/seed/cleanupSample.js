#!/usr/bin/env node
// Removes one seed batch. Default is a DRY RUN; deleting needs --apply and the same
// host/database guards as the writer.
//
//   node scripts/seed/cleanupSample.js --batch <label>            dry run
//   node scripts/seed/cleanupSample.js --batch <label> --apply    delete
//
// Only documents that are in the batch manifest AND still carry the seed markers are deleted:
//   users         email ends with @seed.stram.example, or username starts with seed_
//   profiles      belong to a matched seed user
//   jobs          belong to a matched seed employer
//   applications  applicant is a matched seed user AND the job is a matched seed job
// A seed job that also has an application from someone outside the manifest is kept and reported.

const fs = require("fs");
const { evaluateGuard } = require("./guards");
const { DEFAULT_URI, parseArgs, assertSafeBatch, manifestPath } = require("./cli");

const EMAIL_RE = /@seed\.stram\.example$/i;
const USERNAME_RE = /^seed_/i;

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.batch || args.batch === true) throw new Error("Pass --batch <label> (the label printed by seed:sample).");
  const batch = assertSafeBatch(String(args.batch));
  const apply = args.apply === true;
  const uri = String(args["mongo-uri"] || process.env.SEED_MONGO_URI || DEFAULT_URI);

  const allowDb = typeof args["allow-db"] === "string" ? args["allow-db"] : undefined;
  const guard = evaluateGuard({ nodeEnv: process.env.NODE_ENV, uri, allowDb });
  if (!guard.ok) throw new Error(`Refusing to run. ${guard.reasons.join(" ")}`);
  console.log(`Target: ${guard.target.masked}  (database "${guard.target.db}")`);

  const file = manifestPath(batch);
  if (!fs.existsSync(file)) throw new Error(`No manifest at ${file}.`);
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  const ids = manifest.ids || {};

  const mongoose = require("mongoose");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  try {
    const live = evaluateGuard({ nodeEnv: process.env.NODE_ENV, uri: `mongodb://${mongoose.connection.host}:${mongoose.connection.port}/${mongoose.connection.name}`, allowDb });
    if (!live.ok) throw new Error(`Connected target failed the guard. ${live.reasons.join(" ")}`);
    if (manifest.database && manifest.database !== mongoose.connection.name) {
      throw new Error(`Manifest was written to database "${manifest.database}" but this is "${mongoose.connection.name}".`);
    }

    const User = require("../../models/User");
    const EmployerProfile = require("../../models/EmployerProfile");
    const JobseekerProfile = require("../../models/JobseekerProfile");
    const JobVacancy = require("../../models/JobVacancy");
    const JobApplication = require("../../models/JobApplication");
    const toObjectIds = (list = []) => list.map((id) => new mongoose.Types.ObjectId(id));

    // Users: in the manifest AND still carrying a seed marker.
    const manifestUsers = await User.find({ _id: { $in: toObjectIds(ids.users) } }).select("_id email username role").lean();
    const seedUsers = manifestUsers.filter((u) => EMAIL_RE.test(u.email || "") || USERNAME_RE.test(u.username || ""));
    const seedUserIds = seedUsers.map((u) => u._id);
    const seedUserSet = new Set(seedUserIds.map(String));

    const jobs = await JobVacancy.find({ _id: { $in: toObjectIds(ids.jobvacancies) } }).select("_id employer").lean();
    const seedJobs = jobs.filter((j) => seedUserSet.has(String(j.employer)));
    const seedJobIds = seedJobs.map((j) => j._id);

    // Applications on seed jobs that are NOT ours: those jobs must stay.
    const foreign = await JobApplication.aggregate([
      { $match: { vacancy: { $in: seedJobIds }, _id: { $nin: toObjectIds(ids.jobapplications) } } },
      { $group: { _id: "$vacancy", n: { $sum: 1 } } },
    ]);
    const keepJobs = new Set(foreign.map((f) => String(f._id)));
    const deletableJobIds = seedJobIds.filter((id) => !keepJobs.has(String(id)));

    const apps = await JobApplication.find({ _id: { $in: toObjectIds(ids.jobapplications) } }).select("_id applicant vacancy").lean();
    const deletableJobSet = new Set(deletableJobIds.map(String));
    const seedApps = apps.filter((a) => seedUserSet.has(String(a.applicant)) && deletableJobSet.has(String(a.vacancy)));
    const seedAppIds = seedApps.map((a) => a._id);

    const employerProfiles = await EmployerProfile.find({ _id: { $in: toObjectIds(ids.employerprofiles) } }).select("_id userId").lean();
    const jobseekerProfiles = await JobseekerProfile.find({ _id: { $in: toObjectIds(ids.jobseekerprofiles) } }).select("_id userId").lean();
    const epIds = employerProfiles.filter((p) => seedUserSet.has(String(p.userId))).map((p) => p._id);
    const jpIds = jobseekerProfiles.filter((p) => seedUserSet.has(String(p.userId))).map((p) => p._id);

    // Users that still own a kept job stay as well.
    const keptEmployers = new Set(seedJobs.filter((j) => keepJobs.has(String(j._id))).map((j) => String(j.employer)));
    const deletableUserIds = seedUserIds.filter((id) => !keptEmployers.has(String(id)));

    const plan = [
      ["jobapplications", ids.jobapplications?.length || 0, seedAppIds.length],
      ["jobvacancies", ids.jobvacancies?.length || 0, deletableJobIds.length],
      ["employerprofiles", ids.employerprofiles?.length || 0, epIds.length],
      ["jobseekerprofiles", ids.jobseekerprofiles?.length || 0, jpIds.length],
      ["users", ids.users?.length || 0, deletableUserIds.length],
    ];
    console.log(`\nBatch "${batch}" (manifest status: ${manifest.status})`);
    console.log("collection           in manifest   would delete");
    for (const [name, inManifest, count] of plan) console.log(`${name.padEnd(20)} ${String(inManifest).padStart(11)}   ${String(count).padStart(12)}`);
    if (keepJobs.size) console.log(`Kept ${keepJobs.size} seed job(s) because applications from outside this manifest reference them.`);

    if (!apply) {
      console.log("\nDRY RUN: nothing was deleted. Add --apply to delete.");
      return;
    }
    // Children first, so a failure never leaves a child pointing at a deleted parent.
    const results = {
      jobapplications: (await JobApplication.deleteMany({ _id: { $in: seedAppIds } })).deletedCount,
      jobvacancies: (await JobVacancy.deleteMany({ _id: { $in: deletableJobIds } })).deletedCount,
      employerprofiles: (await EmployerProfile.deleteMany({ _id: { $in: epIds } })).deletedCount,
      jobseekerprofiles: (await JobseekerProfile.deleteMany({ _id: { $in: jpIds } })).deletedCount,
      users: (await User.deleteMany({ _id: { $in: deletableUserIds } })).deletedCount,
    };
    console.log("\nDeleted:", JSON.stringify(results));
    manifest.cleanedAt = new Date().toISOString();
    manifest.cleanup = results;
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error(`seed:cleanup failed: ${error.message}`);
  process.exitCode = 1;
});
