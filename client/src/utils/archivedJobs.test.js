import test from "node:test";
import assert from "node:assert/strict";
import {
  buildArchivedQuery,
  canExpand,
  candidateLink,
  durationParts,
  emptyKind,
  hasApplicants,
  percentOf,
  showFunnelBars,
  statText,
  statusKey,
  statusTone,
} from "./archivedJobs.js";

test("status chip text key and tone per status", () => {
  assert.equal(statusKey("filled"), "filled");
  assert.equal(statusKey("auto_closed"), "auto_closed");
  assert.equal(statusKey("something-new"), "closed");
  assert.equal(statusTone("filled"), "success");
  assert.equal(statusTone("expired"), "warning");
  assert.equal(statusTone("closed"), "neutral");
});

test("zero-applicant rows are not expandable", () => {
  assert.equal(hasApplicants({ funnel: { applicants: 0 } }), false);
  assert.equal(canExpand({ funnel: { applicants: 0 } }), false);
  assert.equal(canExpand({ funnel: { applicants: 3 } }), true);
  assert.equal(canExpand({}), false);
});

test("duration: under a day, days, unknown", () => {
  assert.deepEqual(durationParts(0), { key: "lessThanDay" });
  assert.deepEqual(durationParts(43), { key: "daysOpen", count: 43 });
  assert.equal(durationParts(null), null);
  assert.equal(durationParts(undefined), null);
});

test("percent and bars", () => {
  assert.equal(percentOf(1, 1), 100);
  assert.equal(percentOf(1, 3), 33);
  assert.equal(percentOf(0, 0), null);
  assert.equal(showFunnelBars({ applicants: 4 }), false);
  assert.equal(showFunnelBars({ applicants: 5 }), true);
});

test("query: defaults are omitted, bad values ignored", () => {
  assert.deepEqual(buildArchivedQuery(), { page: 1, limit: 10 });
  assert.deepEqual(buildArchivedQuery({ page: 2, pageSize: 25, filter: "expired", sort: "applicants", q: "  cook " }), { page: 2, limit: 25, filter: "expired", sort: "applicants", q: "cook" });
  assert.deepEqual(buildArchivedQuery({ filter: "bogus", sort: "bogus" }), { page: 1, limit: 10 });
});

test("empty states: nothing archived vs nothing after a filter", () => {
  assert.equal(emptyKind({ total: 3, counts: { all: 3 }, filter: "all", q: "" }), null);
  assert.equal(emptyKind({ total: 0, counts: { all: 0 }, filter: "all", q: "" }), "none");
  assert.equal(emptyKind({ total: 0, counts: { all: 5 }, filter: "expired", q: "" }), "filtered");
  assert.equal(emptyKind({ total: 0, counts: { all: 5 }, filter: "all", q: "zzz" }), "filtered");
  assert.equal(emptyKind({ total: 0, counts: undefined, filter: "all", q: "" }), "none");
});

test("hired candidate link: none for a deleted account", () => {
  assert.equal(candidateLink({ id: "u1", name: "Maria" }), "/employer/applicants/u1");
  assert.equal(candidateLink({ id: "ghost", former: true }), null);
  assert.equal(candidateLink(null), null);
});

test("stat text uses an em dash for no data", () => {
  assert.equal(statText(null), "—");
  assert.equal(statText(undefined, "%"), "—");
  assert.equal(statText(50, "%"), "50%");
  assert.equal(statText(0), "0");
});
