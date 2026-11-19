import test, { mock } from "node:test";
import assert from "node:assert/strict";
import {
  TYPED_DEBOUNCE_MS,
  serializeFilters,
  parseFilters,
  createDebouncer,
  createRequestGate,
  highlightParts,
  nextActiveIndex,
} from "./liveSearch.js";

test("serializeFilters writes only set filters; page only above 1", () => {
  assert.equal(serializeFilters({}).toString(), "");
  assert.equal(serializeFilters({ q: "  cook ", sortBy: "" }).toString(), "q=cook");
  const params = serializeFilters(
    { q: "cook", location: "Boac", jobType: "Contract", sortBy: "newest", industry: ["A", "B"], salaryMin: "15000", salaryMax: "", onlyMeetsRequired: true },
    3
  );
  assert.deepEqual(params.getAll("industry"), ["A", "B"]);
  assert.equal(params.get("salaryMin"), "15000");
  assert.equal(params.has("salaryMax"), false);
  assert.equal(params.get("onlyMeetsRequired"), "true");
  assert.equal(params.get("page"), "3");
  assert.equal(serializeFilters({ q: "x" }, 1).has("page"), false);
});

test("parseFilters restores what serializeFilters wrote (reload round trip)", () => {
  const filters = { q: "cook & bake", location: "Boac, Marinduque", jobType: "Contract", sortBy: "salary", industry: ["Food, Beverage", "Retail"], salaryMin: "15000", salaryMax: "30000", onlyMeetsRequired: true };
  const back = parseFilters(serializeFilters(filters, 2));
  assert.deepEqual(back.filters, filters);
  assert.equal(back.page, 2);
});

test("parseFilters tolerates junk: empty, bad page, non-digit salary", () => {
  assert.deepEqual(parseFilters(""), { filters: {}, page: 1 });
  assert.equal(parseFilters("page=abc").page, 1);
  assert.equal(parseFilters("page=-4").page, 1);
  assert.deepEqual(parseFilters("salaryMin=abc&onlyMeetsRequired=nope").filters, {});
});

test("debouncer: typed changes wait, later calls replace earlier ones", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const calls = [];
    const d = createDebouncer(TYPED_DEBOUNCE_MS);
    d.schedule(() => calls.push("a"));
    mock.timers.tick(200);
    d.schedule(() => calls.push("b"));
    mock.timers.tick(299);
    assert.deepEqual(calls, []);
    assert.equal(d.pending(), true);
    mock.timers.tick(1);
    assert.deepEqual(calls, ["b"]);
    assert.equal(d.pending(), false);
  } finally {
    mock.timers.reset();
  }
});

test("debouncer: cancel (an immediate commit) drops the pending run", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const calls = [];
    const d = createDebouncer(300);
    d.schedule(() => calls.push("late"));
    d.cancel();
    mock.timers.tick(1000);
    assert.deepEqual(calls, []);
  } finally {
    mock.timers.reset();
  }
});

test("request gate: a new request aborts the old one and only the newest is current", () => {
  const gate = createRequestGate();
  const first = gate.begin();
  const second = gate.begin();
  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  assert.equal(second.signal.aborted, false);
  assert.equal(second.isCurrent(), true);
  gate.abort();
  assert.equal(second.signal.aborted, true);
  assert.equal(second.isCurrent(), false);
});

test("highlightParts marks every case-insensitive match", () => {
  assert.deepEqual(highlightParts("Cook Cookie", "cook"), [
    { text: "Cook", match: true },
    { text: " ", match: false },
    { text: "Cook", match: true },
    { text: "ie", match: false },
  ]);
  assert.deepEqual(highlightParts("Welder", ""), [{ text: "Welder", match: false }]);
  assert.deepEqual(highlightParts("Welder", "zzz"), [{ text: "Welder", match: false }]);
  assert.deepEqual(highlightParts("c++ dev", "c++"), [
    { text: "c++", match: true },
    { text: " dev", match: false },
  ]);
});

test("nextActiveIndex wraps and returns -1 with no options", () => {
  assert.equal(nextActiveIndex(-1, 3, "ArrowDown"), 0);
  assert.equal(nextActiveIndex(2, 3, "ArrowDown"), 0);
  assert.equal(nextActiveIndex(-1, 3, "ArrowUp"), 2);
  assert.equal(nextActiveIndex(0, 3, "ArrowUp"), 2);
  assert.equal(nextActiveIndex(1, 3, "ArrowUp"), 0);
  assert.equal(nextActiveIndex(0, 0, "ArrowDown"), -1);
});
