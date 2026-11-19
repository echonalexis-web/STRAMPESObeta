import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STATE,
  parseDirectoryState,
  serializeDirectoryState,
  toApiParams,
  hasActiveFilters,
} from "./userDirectoryParams.js";

test("a clean URL means defaults, and defaults write a clean URL", () => {
  assert.deepEqual(parseDirectoryState(new URLSearchParams("")), DEFAULT_STATE);
  assert.equal(serializeDirectoryState(DEFAULT_STATE).toString(), "");
  assert.equal(hasActiveFilters(DEFAULT_STATE), false);
});

test("filters, sort and page survive a round trip through the URL", () => {
  const state = {
    tab: "jobseekers", q: "juan dela", status: "suspended", verification: "",
    noEmail: true, idle90: true, lockedNow: true, sort: "lastActive", order: "asc", page: 3,
  };
  assert.deepEqual(parseDirectoryState(serializeDirectoryState(state)), state);
});

test("the verification filter only applies on the employers tab", () => {
  const employers = serializeDirectoryState({ tab: "employers", verification: "pending" });
  assert.equal(employers.get("verification"), "pending");
  const jobseekers = serializeDirectoryState({ tab: "jobseekers", verification: "pending" });
  assert.equal(jobseekers.has("verification"), false);
  assert.equal(toApiParams({ tab: "jobseekers", verification: "pending" }).verificationStatus, undefined);
  assert.equal(toApiParams({ tab: "employers", verification: "pending" }).verificationStatus, "pending");
});

test("junk in the URL falls back to defaults (unknown status, sort, page)", () => {
  const state = parseDirectoryState(new URLSearchParams("status=hacked&sort=password&page=-2&verification=x&order=up"));
  assert.equal(state.status, "");
  assert.equal(state.sort, "joined");
  assert.equal(state.page, 1);
  assert.equal(state.verification, "");
  assert.equal(state.order, "");
});

test("API params: role from the tab, flags as true, paging only when asked", () => {
  const params = toApiParams({ tab: "jobseekers", q: " ana ", status: "deleted", noEmail: true, sort: "name", order: "desc", page: 2 });
  assert.deepEqual(params, { role: "jobseeker", search: "ana", status: "deleted", noEmail: "true", sort: "name", order: "desc", page: 2, limit: 20 });
  const exportParams = toApiParams({ tab: "employers", idle90: true }, { withPaging: false });
  assert.deepEqual(exportParams, { role: "employer", idle90: "true" });
});

test("active filter detection ignores sort and page", () => {
  assert.equal(hasActiveFilters({ sort: "name", page: 4 }), false);
  assert.equal(hasActiveFilters({ q: "x" }), true);
  assert.equal(hasActiveFilters({ lockedNow: true }), true);
});
