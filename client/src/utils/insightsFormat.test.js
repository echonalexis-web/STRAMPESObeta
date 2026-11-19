import test from "node:test";
import assert from "node:assert/strict";
import { actionKey, insightsKind, lockState } from "./insightsFormat.js";

test("audit actions become dot-free i18n keys", () => {
  assert.equal(actionKey("admin.user.soft_deleted"), "admin_user_soft_deleted");
  assert.equal(actionKey(undefined), "");
});

test("insights kind follows which role section the server sent", () => {
  assert.equal(insightsKind({ jobseeker: {} }), "jobseeker");
  assert.equal(insightsKind({ employer: {} }), "employer");
  assert.equal(insightsKind({}), null);
  assert.equal(insightsKind(null), null);
});

test("lock state is only locked while the server says lockedNow", () => {
  assert.deepEqual(lockState({ lockedNow: false, lockedUntil: null }), { locked: false, until: null });
  assert.deepEqual(lockState({ lockedNow: true, lockedUntil: "2026-01-01" }), { locked: true, until: "2026-01-01" });
  assert.deepEqual(lockState(undefined), { locked: false, until: null });
});
