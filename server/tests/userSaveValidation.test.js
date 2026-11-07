// Guards the fix for a real incident: a stale `workExperience` value (from
// before that enum was tightened) blocked POST /auth/username — and would
// have blocked setPassword, resetPassword, redeemBackupCode, login's
// reactivation branch, googleAuth's account-linking branch, updateAvatar,
// and every other narrow action in authController.js that calls
// `user.save()` — because a full-document .save() re-validates EVERY
// enum-constrained path on the document, not just the ones that particular
// call actually changed. See scripts/migrateWorkExperienceLegacyValues.js
// (the data-side fix) and scripts/checkEnumDrift.js (ongoing health check).
//
// This is a static, source-text check rather than a behavioral one on
// purpose: reproducing Mongoose's real full-document-validation semantics
// would need a live schema (this project's test suite deliberately has no
// DB harness — see the other test files' own comments on that), and the
// actual bug here is "a call site forgot the option", which a plain text
// scan catches directly, for every call site at once, including ones with
// no dedicated behavioral test of their own.
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "../controllers/authController.js"), "utf8");

describe("authController.js — user.save() validation scope", () => {
  test("every user.save() call scopes validation to the paths it actually modified", () => {
    const calls = source.match(/user\.save\([^)]*\)/g) || [];
    // Sanity check on the check itself: if this ever matches nothing, the
    // regex (or the file) changed shape and the test below would pass
    // vacuously without protecting anything.
    expect(calls.length).toBeGreaterThan(15);

    const unscoped = calls.filter((call) => !call.includes("validateModifiedOnly"));
    expect(unscoped).toEqual([]);
  });

  test("updateProfile's findByIdAndUpdate enforces schema validators (enum fields come straight from req.body)", () => {
    const match = source.match(/await User\.findByIdAndUpdate\(userId, cleanCommon,[^)]*\)/);
    expect(match).not.toBeNull();
    expect(match[0]).toContain("runValidators: true");
    // context:"query" is what makes a custom validator's `this` refer to
    // the query instead of an empty object during an update — the Mongoose-
    // recommended companion to runValidators on any findByIdAndUpdate.
    expect(match[0]).toContain('context: "query"');
  });
});
