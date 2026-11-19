import test from "node:test";
import assert from "node:assert/strict";
import { activeFilterKeys, clearedFilters } from "./jobFilters.js";

test("no filters active for an empty or keyword-and-sort-only state", () => {
  assert.deepEqual(activeFilterKeys({}), []);
  assert.deepEqual(activeFilterKeys({ q: "cook", sortBy: "newest" }), []);
});

test("each refinement counts once", () => {
  const keys = activeFilterKeys({
    location: "Boac",
    jobType: "Contract",
    industry: ["Retail"],
    salaryMin: "15000",
    onlyMeetsRequired: true,
  });
  assert.deepEqual(keys, ["location", "jobType", "industry", "salary", "mustHaves"]);
  assert.deepEqual(activeFilterKeys({ salaryMax: 50000 }), ["salary"]);
  assert.deepEqual(activeFilterKeys({ location: "  " }), []);
});

test("clearedFilters resets refinements but keeps keyword and sort", () => {
  const next = clearedFilters({
    q: "cook",
    sortBy: "salary",
    location: "Boac",
    jobType: "Contract",
    industry: ["Retail"],
    salaryMin: "1",
    salaryMax: "2",
    onlyMeetsRequired: true,
  });
  assert.equal(next.q, "cook");
  assert.equal(next.sortBy, "salary");
  assert.deepEqual(activeFilterKeys(next), []);
});
