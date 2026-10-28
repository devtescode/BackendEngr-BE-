// Opt-in migration: grandfather legacy users (created before email
// verification existed) by marking them verified.
//
// Only touches users where `isEmailVerified` does not exist at all; users
// who signed up under the new flow (isEmailVerified: false) are left alone.
//
// Usage (from the project root):
//   node scripts/mark-existing-users-verified.js          # dry run, prints count
//   node scripts/mark-existing-users-verified.js --apply  # writes changes
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const User = require("../Models/user.models.js");

const APPLY = process.argv.includes("--apply");
// Accounts created before email verification existed never got a
// verification token; matching on that (not just a missing field) still
// catches legacy users whose document was re-saved with the default false.
const FILTER = { isEmailVerified: { $ne: true }, emailVerificationToken: { $exists: false } };

async function main() {
  const URI = process.env.URI;
  if (!URI) {
    console.error("URI is not set (expected in .env, same as index.js).");
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(URI);

  try {
    const count = await User.countDocuments(FILTER);
    console.log(`Legacy users without isEmailVerified: ${count}`);

    if (!APPLY) {
      console.log("Dry run — no changes written. Re-run with --apply to update.");
      return;
    }

    const result = await User.updateMany(FILTER, {
      $set: { isEmailVerified: true, emailVerifiedAt: new Date() },
    });
    console.log(`Marked ${result.modifiedCount} user(s) as verified.`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exitCode = 1;
});
