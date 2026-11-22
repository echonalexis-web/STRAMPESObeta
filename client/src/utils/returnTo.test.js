import test from "node:test";
import assert from "node:assert/strict";
import { loginStateFor, safeReturnPath } from "./returnTo.js";

test("only the public jobs pages can be returned to", () => {
  for (const ok of ["/jobs", "/jobs?q=welder&page=2", "/jobs/507f1f77bcf86cd799439011", "/jobs/507f1f77bcf86cd799439011/apply", "/", "/#available-jobs"]) {
    assert.equal(safeReturnPath(ok), ok);
  }
});

test("anything else is dropped: other pages, other sites, tricks", () => {
  for (const bad of ["", null, undefined, "/dashboard", "/admin", "//evil.example", "https://evil.example/jobs", "/jobs/../admin", "/jobs\\evil", "/jobs#frag", "/#other", "/?x=1", "javascript:alert(1)", `/jobs?${"a".repeat(500)}`]) {
    assert.equal(safeReturnPath(bad), "", String(bad));
  }
});

test("the login state remembers the path and the filters", () => {
  assert.deepEqual(loginStateFor({ pathname: "/jobs", search: "?q=welder" }), { from: "/jobs?q=welder" });
  assert.deepEqual(loginStateFor({ pathname: "/jobs/abc", search: "" }), { from: "/jobs/abc" });
  assert.deepEqual(loginStateFor(null), { from: "" });
});
