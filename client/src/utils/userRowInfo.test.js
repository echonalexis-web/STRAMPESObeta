import test from "node:test";
import assert from "node:assert/strict";
import { removalDays, hasNoEmail } from "./userRowInfo.js";

const NOW = new Date("2026-06-01T00:00:00Z").getTime();

test("days until removal rounds up and never goes below zero", () => {
  assert.equal(removalDays("2026-07-01T00:00:00Z", NOW), 30);
  assert.equal(removalDays("2026-06-01T06:00:00Z", NOW), 1);
  assert.equal(removalDays("2026-05-01T00:00:00Z", NOW), 0);
  assert.equal(removalDays(null, NOW), null);
  assert.equal(removalDays("not a date", NOW), null);
});

test("an account with no address on file reads as no email", () => {
  assert.equal(hasNoEmail({ email: "" }), true);
  assert.equal(hasNoEmail({ email: "  " }), true);
  assert.equal(hasNoEmail({}), true);
  assert.equal(hasNoEmail({ email: "a@b.co" }), false);
});

test("directory dates read as Mon D, YYYY and fall back to a dash", async () => {
  const { formatDirectoryDate } = await import("./userRowInfo.js");
  assert.match(formatDirectoryDate("2026-06-15T12:00:00Z"), /^Jun 1[45], 2026$/);
  assert.equal(formatDirectoryDate(null), "—");
  assert.equal(formatDirectoryDate("nope"), "—");
});
