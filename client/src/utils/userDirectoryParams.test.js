import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STATE,
  CHIPS_BY_TAB,
  SORT_CHOICES,
  MOBILE_PAGE_SIZE,
  VERIFICATION_PENDING_REVIEW,
  parseDirectoryState,
  serializeDirectoryState,
  toApiParams,
  hasActiveFilters,
  activeFilterCount,
  isCanonicalQuery,
  sortChoiceOf,
  sortPatchFor,
  isChipActive,
  chipPatch,
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

test("the merged sort select maps to the existing sort and order params, and back", () => {
  assert.deepEqual(SORT_CHOICES, ["newest", "oldest", "nameAsc", "nameDesc", "recent", "leastRecent"]);
  assert.deepEqual(sortPatchFor("newest"), { sort: "joined", order: "" });
  assert.deepEqual(sortPatchFor("oldest"), { sort: "joined", order: "asc" });
  assert.deepEqual(sortPatchFor("nameAsc"), { sort: "name", order: "" });
  assert.deepEqual(sortPatchFor("nameDesc"), { sort: "name", order: "desc" });
  assert.deepEqual(sortPatchFor("recent"), { sort: "lastActive", order: "" });
  assert.deepEqual(sortPatchFor("leastRecent"), { sort: "lastActive", order: "asc" });
  // every choice reads back as itself, whichever way the URL spelled the default order
  for (const choice of SORT_CHOICES) assert.equal(sortChoiceOf(sortPatchFor(choice)), choice);
  assert.equal(sortChoiceOf({ sort: "joined", order: "desc" }), "newest");
  assert.equal(sortChoiceOf({ sort: "name", order: "asc" }), "nameAsc");
  assert.equal(sortChoiceOf({ sort: "lastActive", order: "desc" }), "recent");
  assert.equal(sortChoiceOf(DEFAULT_STATE), "newest");
  // and the API params carry them unchanged
  assert.deepEqual(toApiParams({ tab: "employers", ...sortPatchFor("leastRecent") }, { withPaging: false }), { role: "employer", sort: "lastActive", order: "asc" });
});

test("chips: employers get Pending review and Idle; jobseekers get No email, Idle and Locked now", () => {
  assert.deepEqual(CHIPS_BY_TAB.employers, ["pendingReview", "idle90"]);
  assert.deepEqual(CHIPS_BY_TAB.jobseekers, ["noEmail", "idle90", "lockedNow"]);
});

test("a chip toggles the same filter the old checkbox set, and pressing it again clears it", () => {
  let state = { ...DEFAULT_STATE, tab: "jobseekers" };
  for (const chip of ["noEmail", "idle90", "lockedNow"]) {
    assert.equal(isChipActive(state, chip), false);
    state = { ...state, ...chipPatch(state, chip) };
    assert.equal(isChipActive(state, chip), true);
  }
  assert.equal(toApiParams(state).noEmail, "true");
  assert.equal(toApiParams(state).idle90, "true");
  assert.equal(toApiParams(state).lockedNow, "true");
  state = { ...state, ...chipPatch(state, "noEmail") };
  assert.equal(isChipActive(state, "noEmail"), false);
});

test("Pending review sets the verification filter to pending plus under review", () => {
  const on = { ...DEFAULT_STATE, ...chipPatch(DEFAULT_STATE, "pendingReview") };
  assert.equal(on.verification, VERIFICATION_PENDING_REVIEW);
  assert.equal(isChipActive(on, "pendingReview"), true);
  assert.equal(toApiParams(on).verificationStatus, "pending,under_review");
  assert.equal(serializeDirectoryState(on).get("verification"), "pending,under_review");
  assert.equal(parseDirectoryState(serializeDirectoryState(on)).verification, "pending,under_review");
  // a single status is not the chip
  assert.equal(isChipActive({ ...DEFAULT_STATE, verification: "pending" }, "pendingReview"), false);
  assert.equal(chipPatch(on, "pendingReview").verification, "");
});

test("a param whose control is hidden on this tab is ignored and stripped", () => {
  const employers = parseDirectoryState(new URLSearchParams("tab=employers&noEmail=1&lockedNow=1&idle90=1"));
  assert.equal(employers.noEmail, false);
  assert.equal(employers.lockedNow, false);
  assert.equal(employers.idle90, true);
  assert.equal(toApiParams(employers).noEmail, undefined);
  assert.equal(toApiParams(employers).lockedNow, undefined);
  const jobseekers = parseDirectoryState(new URLSearchParams("tab=jobseekers&verification=pending"));
  assert.equal(jobseekers.verification, "");
  assert.equal(isCanonicalQuery(new URLSearchParams("tab=employers&noEmail=1")), false);
  assert.equal(isCanonicalQuery(new URLSearchParams("tab=jobseekers&verification=pending")), false);
  assert.equal(isCanonicalQuery(new URLSearchParams("tab=jobseekers&noEmail=1&sort=name")), true);
  assert.equal(isCanonicalQuery(new URLSearchParams("")), true);
});

test("verification in the URL: one status or exactly the pending pair, nothing else", () => {
  const v = (value) => parseDirectoryState(new URLSearchParams({ verification: value })).verification;
  assert.equal(v("rejected"), "rejected");
  assert.equal(v("under_review,pending"), "pending,under_review");
  assert.equal(v("pending,verified"), "");
  assert.equal(v("pending,bogus"), "pending");
  assert.equal(v("bogus"), "");
});

test("the Filters button count covers status, verification and chips, not search or sort", () => {
  assert.equal(activeFilterCount(DEFAULT_STATE), 0);
  assert.equal(activeFilterCount({ q: "x", sort: "name" }), 0);
  assert.equal(activeFilterCount({ status: "active", verification: "pending", idle90: true }), 3);
});

test("page size and details are passed through to the API", () => {
  assert.equal(toApiParams({ tab: "employers", page: 2 }, { pageSize: MOBILE_PAGE_SIZE, details: true }).limit, 4);
  assert.equal(toApiParams({ tab: "employers" }, { details: true }).details, "true");
  assert.equal(toApiParams({ tab: "employers" }).details, undefined);
});
