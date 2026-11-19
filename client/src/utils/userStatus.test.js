import test from "node:test";
import assert from "node:assert/strict";
import { getAccountState, getAvailableActions, canConfirmDelete, confirmationTarget } from "./userStatus.js";

test("account state: deleted wins, then banned / deactivated / suspended, else active", () => {
  assert.equal(getAccountState({ isActive: true }), "active");
  assert.equal(getAccountState({ isActive: false, accountStatus: "suspended" }), "suspended");
  assert.equal(getAccountState({ isActive: false, accountStatus: "banned" }), "banned");
  assert.equal(getAccountState({ isActive: false, accountStatus: "deactivated" }), "deactivated");
  // an inactive row with no status recorded reads as suspended, not active
  assert.equal(getAccountState({ isActive: false }), "suspended");
  assert.equal(getAccountState({ isActive: false, accountStatus: "suspended", deletedAt: "2026-01-01" }), "deleted");
});

test("buttons: active gets Deactivate; inactive gets Reactivate + Delete; deleted gets Restore", () => {
  assert.deepEqual(getAvailableActions({ role: "jobseeker", isActive: true }), { deactivate: true, reactivate: false, delete: false, restore: false });
  for (const accountStatus of ["suspended", "banned", "deactivated"]) {
    assert.deepEqual(getAvailableActions({ role: "employer", isActive: false, accountStatus }), { deactivate: false, reactivate: true, delete: true, restore: false });
  }
  assert.deepEqual(getAvailableActions({ role: "employer", isActive: false, deletedAt: "x" }), { deactivate: false, reactivate: false, delete: false, restore: true });
});

test("staff rows never get deactivate, delete or restore", () => {
  for (const role of ["admin", "superadmin"]) {
    for (const row of [{ isActive: true }, { isActive: false }, { isActive: false, deletedAt: "x" }]) {
      assert.deepEqual(getAvailableActions({ role, ...row }), { deactivate: false, reactivate: false, delete: false, restore: false });
    }
  }
});

test("delete needs a listed reason and the exact username or email (case-insensitive)", () => {
  const user = { username: "Juan.DC", email: "juan@x.com" };
  assert.equal(canConfirmDelete({ user, reason: "other", typed: "juan.dc" }), true);
  assert.equal(canConfirmDelete({ user, reason: "other", typed: " juan@x.com " }), true);
  assert.equal(canConfirmDelete({ user, reason: "", typed: "juan.dc" }), false);
  assert.equal(canConfirmDelete({ user, reason: "bogus", typed: "juan.dc" }), false);
  assert.equal(canConfirmDelete({ user, reason: "other", typed: "juan" }), false);
  assert.equal(canConfirmDelete({ user, reason: "other", typed: "" }), false);
  assert.equal(canConfirmDelete({ user: null, reason: "other", typed: "x" }), false);
});

test("the confirmation target is the username, else the email", () => {
  assert.equal(confirmationTarget({ username: "a", email: "b@x.com" }), "a");
  assert.equal(confirmationTarget({ email: "b@x.com" }), "b@x.com");
  assert.equal(confirmationTarget({}), "");
});
