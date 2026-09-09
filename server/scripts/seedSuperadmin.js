/**
 * Bootstrap the first (and normally only) superadmin account.
 *
 * The superadmin role supersedes admin and is the only role that can provision
 * LMDPESO admin accounts. It can't be created through the app — this script is
 * the one way in, and also the recovery path if every superadmin login is lost.
 *
 * Usage (from the server/ directory):
 *
 *   SEED_SUPERADMIN_EMAIL=dev@example.com SEED_SUPERADMIN_PASSWORD='a-strong-passphrase' \
 *   SEED_SUPERADMIN_NAME='Jane Dev' npm run seed:superadmin
 *
 * On Windows PowerShell:
 *
 *   $env:SEED_SUPERADMIN_EMAIL='dev@example.com'; $env:SEED_SUPERADMIN_PASSWORD='a-strong-passphrase'; `
 *   $env:SEED_SUPERADMIN_NAME='Jane Dev'; npm run seed:superadmin
 *
 * Refuses to run if a superadmin account already exists (use the console or a
 * direct DB edit for a deliberate second one).
 */
const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, "../.env") });

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function run() {
  const email = String(process.env.SEED_SUPERADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.SEED_SUPERADMIN_PASSWORD || "");
  const name = String(process.env.SEED_SUPERADMIN_NAME || "System Superadmin").trim();

  if (!EMAIL_RE.test(email)) {
    console.error("✖ SEED_SUPERADMIN_EMAIL is missing or not a valid email address.");
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("✖ SEED_SUPERADMIN_PASSWORD must be at least 12 characters.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB.");

  const existingSuperadmin = await User.findOne({ role: "superadmin" }).select("email");
  if (existingSuperadmin) {
    console.error(
      `✖ A superadmin account already exists (${existingSuperadmin.email}). Aborting.`
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  const emailTaken = await User.findOne({ email }).select("_id role");
  if (emailTaken) {
    console.error(`✖ ${email} is already registered as "${emailTaken.role}". Aborting.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const user = await User.create({
    name,
    email,
    password: await bcrypt.hash(password, 10),
    role: "superadmin",
    mustChangePassword: false,
    hasCompletedOnboarding: true,
    onboardingComplete: true,
  });

  console.log(`✔ Superadmin account created: ${user.email}`);
  console.log("  Sign in at /login, then open /superadmin.");

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
