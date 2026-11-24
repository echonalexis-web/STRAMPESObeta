#!/usr/bin/env node
// Sample-data writer for STRAM-PESO.  Default is a DRY RUN: prints the plan, writes nothing.
// Writing needs --apply and passes the host/database guards in guards.js.
// See README.md in this folder.
//
//   node scripts/seed/seedSample.js                      dry run
//   node scripts/seed/seedSample.js --apply              write (disposable database only)
//
// Flags: --employers 10 --jobseekers 100 --seed <n> --batch <label> --apply
//        --force-new-batch --mongo-uri <uri>   (or env SEED_MONGO_URI)

const fs = require("fs");
const crypto = require("crypto");
const { generateSample, PLACEHOLDER_HASH } = require("./generator");
const { evaluateGuard, evaluateManifestGuard } = require("./guards");
const { formatSummary } = require("./summary");
const { OUTPUT_DIR, DEFAULT_URI, parseArgs, intFlag, defaultBatch, assertSafeBatch, manifestPath, credentialsPath } = require("./cli");

const BCRYPT_COST = 10; // same cost as bcrypt.hash(password, 10) in controllers/authController.js
const FORBIDDEN_MODULES = /[\\/]services[\\/](mailService|notificationService|emailOutboxService|newsRealtimeService|presenceService)\.js$|[\\/]sockets[\\/]/;

// 16 characters with upper, lower, digit and a symbol; starts with a letter so a spreadsheet
// never reads it as a formula. Uses crypto.randomInt, never the seeded generator.
const randomPassword = () => {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!#$%^&*";
  const all = upper + lower + digits + symbols;
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < 15) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return pick(upper + lower) + chars.join("");
};

const csvCell = (value) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const objectIds = (docs) => docs.map((d) => String(d._id));

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const apply = args.apply === true;
  const uri = String(args["mongo-uri"] || process.env.SEED_MONGO_URI || DEFAULT_URI);
  const employers = intFlag(args.employers, 10);
  const jobseekers = intFlag(args.jobseekers, 100);
  const seed = intFlag(args.seed, 20260101, { min: 0 });
  let batch = assertSafeBatch(String(args.batch && args.batch !== true ? args.batch : defaultBatch()));

  const guard = evaluateGuard({ nodeEnv: process.env.NODE_ENV, uri });

  if (!apply) {
    const plan = generateSample({ seed, batch, employers, jobseekers });
    console.log(formatSummary(plan, { manifestPath: manifestPath(batch), credentialsPath: credentialsPath(batch) }));
    console.log(`\nDRY RUN: nothing was written. Target would be ${guard.target ? guard.target.masked : "(none)"}.`);
    console.log(guard.ok ? "Guards: this target would be accepted." : `Guards: this target would be REFUSED: ${guard.reasons.join(" ")}`);
    console.log("Add --apply to write.");
    return;
  }

  // ---- guards: nothing below runs unless every one passes
  if (!guard.ok) throw new Error(`Refusing to write. ${guard.reasons.join(" ")}`);
  console.log(`Target: ${guard.target.masked}  (database "${guard.target.db}")`);
  let manifestExists = fs.existsSync(manifestPath(batch));
  const manifestGuard = evaluateManifestGuard({ manifestExists, forceNewBatch: args["force-new-batch"] === true });
  if (!manifestGuard.ok) throw new Error(`Refusing to write. ${manifestGuard.reasons.join(" ")}`);
  if (manifestExists) {
    batch = `${batch}-${Date.now().toString(36)}`;
    console.log(`Manifest exists; continuing under new batch label "${batch}".`);
  }

  const mongoose = require("mongoose");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  try {
    // Second check against what the driver actually connected to.
    const live = evaluateGuard({
      nodeEnv: process.env.NODE_ENV,
      uri: `mongodb://${mongoose.connection.host}:${mongoose.connection.port}/${mongoose.connection.name}`,
    });
    if (!live.ok) throw new Error(`Connected target failed the guard. ${live.reasons.join(" ")}`);
    console.log(`Connected: ${mongoose.connection.host}/${mongoose.connection.name}`);

    const User = require("../../models/User");
    const EmployerProfile = require("../../models/EmployerProfile");
    const JobseekerProfile = require("../../models/JobseekerProfile");
    const JobVacancy = require("../../models/JobVacancy");
    const JobApplication = require("../../models/JobApplication");

    // No mail, notification or socket module may be loaded: the writer only inserts documents.
    const loaded = Object.keys(require.cache).filter((file) => FORBIDDEN_MODULES.test(file));
    if (loaded.length) throw new Error(`A mail/notification/socket module is loaded (${loaded[0]}). Aborting.`);

    // Read-only: an existing staff account to record as the verifier, as the app does.
    const verifier = await User.findOne({ role: { $in: ["admin", "superadmin"] }, isActive: true }).select("_id").lean();
    if (!verifier) console.log("Note: no admin account found; verificationReviewedBy is left empty.");

    const plan = generateSample({ seed, batch, employers, jobseekers, verifierId: verifier ? verifier._id : null });
    const users = [...plan.employers, ...plan.jobseekers].map((x) => x.user);

    // Refuse on any clash with existing accounts (for example the same seed under another batch).
    const emails = users.map((u) => u.email).filter(Boolean);
    const usernames = users.map((u) => u.username).filter(Boolean);
    const clash = await User.countDocuments({ $or: [{ email: { $in: emails } }, { username: { $in: usernames } }] }).collation({ locale: "en", strength: 2 });
    if (clash > 0) throw new Error(`${clash} planned email/username value(s) already exist. Clean up the earlier batch or use another --seed.`);

    console.log(formatSummary(plan, { manifestPath: manifestPath(batch), credentialsPath: credentialsPath(batch) }));

    // Passwords: random per account, hashed with bcrypt cost 10. Plaintext goes ONLY to the CSV.
    const secrets = new Map();
    for (const u of users) secrets.set(String(u._id), randomPassword());
    for (const u of users) u.password = await require("bcryptjs").hash(secrets.get(String(u._id)), BCRYPT_COST);
    if (users.some((u) => u.password === PLACEHOLDER_HASH)) throw new Error("A password hash was not replaced.");

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const header = "role,username,email,password,account_type";
    const rows = plan.credentials.map((c) => [c.role, c.username, c.email, secrets.get(c.userId), c.accountType].map(csvCell).join(","));
    fs.writeFileSync(credentialsPath(batch), `${header}\n${rows.join("\n")}\n`, { mode: 0o600 });
    try { fs.chmodSync(credentialsPath(batch), 0o600); } catch { /* not supported on every filesystem */ }

    // Manifest first, listing every planned _id, so a failure half way can still be cleaned up.
    const manifest = {
      batch, seed, status: "pending", createdAt: new Date().toISOString(), database: mongoose.connection.name,
      markers: { emailDomain: "seed.stram.example", usernamePrefix: "seed_" },
      counts: { users: users.length, employerProfiles: plan.employers.length, jobseekerProfiles: plan.jobseekers.length, jobs: plan.jobs.length, applications: plan.applications.length },
      ids: {
        users: objectIds(users),
        employerprofiles: objectIds(plan.employers.map((x) => x.profile)),
        jobseekerprofiles: objectIds(plan.jobseekers.map((x) => x.profile)),
        jobvacancies: objectIds(plan.jobs),
        jobapplications: objectIds(plan.applications),
      },
    };
    const saveManifest = () => fs.writeFileSync(manifestPath(batch), JSON.stringify(manifest, null, 2));
    saveManifest();

    try {
      await User.insertMany(users);
      await EmployerProfile.insertMany(plan.employers.map((x) => x.profile));
      await JobseekerProfile.insertMany(plan.jobseekers.map((x) => x.profile));
      await JobVacancy.insertMany(plan.jobs);
      await JobApplication.insertMany(plan.applications);
    } catch (error) {
      manifest.status = "failed";
      manifest.error = String(error.message).slice(0, 300);
      saveManifest();
      throw new Error(`Insert failed (${error.message}). Run seed:cleanup for batch "${batch}" to remove what was written.`);
    }
    manifest.status = "complete";
    saveManifest();

    const verify = {
      users: await User.countDocuments({ _id: { $in: manifest.ids.users } }),
      jobs: await JobVacancy.countDocuments({ _id: { $in: manifest.ids.jobvacancies } }),
      applications: await JobApplication.countDocuments({ _id: { $in: manifest.ids.jobapplications } }),
    };
    console.log(`\nWritten: users ${verify.users}/${manifest.counts.users}, jobs ${verify.jobs}/${manifest.counts.jobs}, applications ${verify.applications}/${manifest.counts.applications}`);
    console.log(`Manifest:    ${manifestPath(batch)}`);
    console.log(`Credentials: ${credentialsPath(batch)}  (passwords are only in this file)`);
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error(`seed:sample failed: ${error.message}`);
  process.exitCode = 1;
});
