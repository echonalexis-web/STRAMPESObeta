import test from "node:test";
import assert from "node:assert/strict";
import {
  countGroups,
  groupOf,
  initialOpenId,
  matchesFilter,
  replacementCount,
  searchApplications,
  sortApplications,
} from "./spesApplications.js";

const app = (id, status, createdAt, extra = {}) => ({ _id: id, status, createdAt, ...extra });

test("statuses map to the four groups (legacy names too)", () => {
  assert.equal(groupOf("submitted"), "inProgress");
  assert.equal(groupOf("documents_review"), "inProgress");
  assert.equal(groupOf("qualified"), "inProgress");
  assert.equal(groupOf("evaluated"), "inProgress");
  assert.equal(groupOf("result_recorded"), "inProgress");
  assert.equal(groupOf("needs_resubmission"), "needsAction");
  assert.equal(groupOf("results_released"), "released");
  assert.equal(groupOf("withdrawn"), "closed");
  assert.equal(groupOf("disqualified"), "closed");
  assert.equal(groupOf("under_review"), "inProgress");
});

test("counts and filters", () => {
  const items = [app("a", "submitted"), app("b", "needs_resubmission"), app("c", "disqualified"), app("d", "results_released")];
  assert.deepEqual(countGroups(items), { all: 4, inProgress: 1, needsAction: 1, released: 1, closed: 1 });
  assert.equal(items.filter((i) => matchesFilter(i, "closed")).length, 1);
  assert.equal(items.filter((i) => matchesFilter(i, "all")).length, 4);
});

test("sort: action needed first, then newest or oldest", () => {
  const items = [
    app("old", "submitted", "2026-01-01"),
    app("new", "submitted", "2026-06-01"),
    app("act", "needs_resubmission", "2026-02-01"),
  ];
  assert.deepEqual(sortApplications(items, "newest").map((i) => i._id), ["act", "new", "old"]);
  assert.deepEqual(sortApplications(items, "oldest").map((i) => i._id), ["act", "old", "new"]);
});

test("initially open row: needs action, else most recent when few, else none", () => {
  const few = sortApplications([app("a", "submitted", "2026-01-01"), app("b", "submitted", "2026-02-01")]);
  assert.equal(initialOpenId(few), "b");
  const withAction = sortApplications([app("a", "submitted", "2026-03-01"), app("b", "needs_resubmission", "2026-01-01")]);
  assert.equal(initialOpenId(withAction), "b");
  const many = sortApplications(["1", "2", "3", "4"].map((id, i) => app(id, "submitted", `2026-0${i + 1}-01`)));
  assert.equal(initialOpenId(many), null);
  assert.equal(initialOpenId([]), null);
});

test("documents needing replacement are counted; search matches the title", () => {
  const a = app("a", "needs_resubmission", "2026-01-01", {
    documents: [{ verification: { state: "needs_replacement" } }, { verification: { state: "verified" } }, {}],
    posting: { title: "SPES 2026 Christmas Break" },
  });
  assert.equal(replacementCount(a), 1);
  assert.equal(replacementCount({}), 0);
  const titleOf = (x) => x.posting?.title;
  assert.equal(searchApplications([a], "christmas", titleOf).length, 1);
  assert.equal(searchApplications([a], "summer", titleOf).length, 0);
  assert.equal(searchApplications([a], "  ", titleOf).length, 1);
});
