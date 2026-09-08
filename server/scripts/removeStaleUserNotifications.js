/**
 * One-off cleanup: drop the legacy `notifications` embedded array from
 * `users` documents. It was superseded by the dedicated `notifications`
 * collection (see models/Notification.js) and is no longer read or written
 * anywhere in the app.
 *
 *   node scripts/removeStaleUserNotifications.js            # apply
 *   node scripts/removeStaleUserNotifications.js --dry-run  # report only
 */
const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, "../.env") });

const mongoose = require("mongoose");

const DRY_RUN = process.argv.includes("--dry-run");

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected. Mode: ${DRY_RUN ? "DRY-RUN" : "APPLY"}`);

  const usersCollection = mongoose.connection.collection("users");
  const affected = await usersCollection.countDocuments({ notifications: { $exists: true } });
  console.log(`Users with a stale "notifications" field: ${affected}`);

  if (!DRY_RUN && affected > 0) {
    const result = await usersCollection.updateMany(
      { notifications: { $exists: true } },
      { $unset: { notifications: "" } }
    );
    console.log(`Cleared "notifications" on ${result.modifiedCount} user document(s).`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
