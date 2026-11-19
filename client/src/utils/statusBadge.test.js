import test from "node:test";
import assert from "node:assert/strict";
import { STATUS_SHAPES, statusShape, statusBadgeClass } from "./statusBadge.js";

test("each account state has its own shape", () => {
  assert.deepEqual(STATUS_SHAPES, { active: "dot", suspended: "diamond", deactivated: "square", deleted: "ring", banned: "cross" });
  assert.equal(new Set(Object.values(STATUS_SHAPES)).size, 5);
});

test("an unknown state falls back to the active dot instead of throwing", () => {
  assert.equal(statusShape("whatever"), "dot");
  assert.equal(statusBadgeClass("whatever"), "sb sb--active sb--dot");
  assert.equal(statusBadgeClass("banned"), "sb sb--banned sb--cross");
});
