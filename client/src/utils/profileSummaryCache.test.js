import test from "node:test";
import assert from "node:assert/strict";
import { createHoverController, createSummaryCache, supportsHoverCards } from "./profileSummaryCache.js";

// A manual clock for timers.
const fakeTimers = () => {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  return {
    setTimer: (fn, ms) => {
      const id = nextId++;
      pending.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimer: (id) => pending.delete(id),
    advance: (ms) => {
      now += ms;
      for (const [id, t] of [...pending]) {
        if (t.at <= now) {
          pending.delete(id);
          t.fn();
        }
      }
    },
    count: () => pending.size,
  };
};

test("hover opens only after the open delay", () => {
  const clock = fakeTimers();
  const opened = [];
  const hover = createHoverController({ onOpen: (k) => opened.push(k), ...clock });
  hover.enter("a");
  clock.advance(399);
  assert.deepEqual(opened, []);
  clock.advance(1);
  assert.deepEqual(opened, ["a"]);
  assert.equal(hover.isOpen(), true);
});

test("a quick pass over a trigger never opens (no request)", () => {
  const clock = fakeTimers();
  const opened = [];
  const hover = createHoverController({ onOpen: (k) => opened.push(k), ...clock });
  hover.enter("a");
  clock.advance(200);
  hover.leave();
  clock.advance(1000);
  assert.deepEqual(opened, []);
  assert.equal(clock.count(), 0);
});

test("leaving closes after the grace delay and entering the card cancels it", () => {
  const clock = fakeTimers();
  const closed = [];
  const hover = createHoverController({ onOpen() {}, onClose: (k) => closed.push(k), ...clock });
  hover.enter("a");
  clock.advance(400);
  hover.leave();
  clock.advance(149);
  assert.deepEqual(closed, []);
  hover.cardEnter();
  clock.advance(1000);
  assert.deepEqual(closed, []);
  hover.cardLeave();
  clock.advance(150);
  assert.deepEqual(closed, ["a"]);
});

test("moving between two triggers cancels the first one's timers", () => {
  const clock = fakeTimers();
  const opened = [];
  const hover = createHoverController({ onOpen: (k) => opened.push(k), onClose() {}, ...clock });
  hover.enter("a");
  clock.advance(300);
  hover.leave();
  hover.enter("b");
  clock.advance(400);
  assert.deepEqual(opened, ["b"]);
});

test("entering the same trigger again does not restart the timer", () => {
  const clock = fakeTimers();
  const opened = [];
  const hover = createHoverController({ onOpen: (k) => opened.push(k), ...clock });
  hover.enter("a");
  clock.advance(300);
  hover.enter("a");
  clock.advance(100);
  assert.deepEqual(opened, ["a"]);
});

test("keyboard focus opens immediately and escape closes", () => {
  const clock = fakeTimers();
  const opened = [];
  const closed = [];
  const hover = createHoverController({ onOpen: (k) => opened.push(k), onClose: (k) => closed.push(k), ...clock });
  hover.focus("a");
  assert.deepEqual(opened, ["a"]);
  hover.closeNow();
  assert.deepEqual(closed, ["a"]);
  assert.equal(hover.isOpen(), false);
  assert.equal(clock.count(), 0);
});

test("closeNow before the open delay cancels the pending open", () => {
  const clock = fakeTimers();
  const opened = [];
  const hover = createHoverController({ onOpen: (k) => opened.push(k), ...clock });
  hover.enter("a");
  hover.closeNow();
  clock.advance(1000);
  assert.deepEqual(opened, []);
});

test("cache entries expire after the ttl", () => {
  let now = 0;
  const cache = createSummaryCache({ ttlMs: 120000, now: () => now });
  cache.set("a", { name: "A" });
  now = 119999;
  assert.deepEqual(cache.get("a"), { name: "A" });
  now = 120000;
  assert.equal(cache.get("a"), undefined);
});

test("cache keeps at most max entries and drops the oldest", () => {
  const cache = createSummaryCache({ max: 3 });
  ["a", "b", "c", "d"].forEach((k) => cache.set(k, k));
  assert.equal(cache.size(), 3);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("d"), "d");
});

test("concurrent fetches share one request and the result is cached", async () => {
  const cache = createSummaryCache();
  let calls = 0;
  const load = async () => {
    calls += 1;
    return { name: "A" };
  };
  const [one, two] = [cache.fetch("a", load), cache.fetch("a", load)];
  await Promise.all([one.promise, two.promise]);
  assert.equal(calls, 1);
  const third = cache.fetch("a", load);
  assert.equal(third.cached, true);
  assert.equal(calls, 1);
  assert.equal(cache.inFlightCount(), 0);
});

test("cancel aborts the in-flight request through the AbortController", async () => {
  const cache = createSummaryCache();
  let aborted = false;
  const load = (controller) =>
    new Promise((resolve, reject) => {
      controller.signal.addEventListener("abort", () => {
        aborted = true;
        reject(new Error("aborted"));
      });
    });
  const handle = cache.fetch("a", load);
  await new Promise((resolve) => setTimeout(resolve, 0)); // let the request start
  handle.cancel();
  await assert.rejects(handle.promise);
  assert.equal(aborted, true);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.inFlightCount(), 0);
});

test("unavailable answers are cached too, so a list does not re-request them", async () => {
  const cache = createSummaryCache();
  let calls = 0;
  const load = async () => {
    calls += 1;
    return { unavailable: true };
  };
  await cache.fetch("a", load).promise;
  await cache.fetch("a", load).promise;
  assert.equal(calls, 1);
});

test("a failed request is not cached", async () => {
  const cache = createSummaryCache();
  await assert.rejects(cache.fetch("a", async () => { throw new Error("net"); }).promise);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.inFlightCount(), 0);
});

test("hover cards are only for fine hovering pointers", () => {
  const win = (matches) => ({ matchMedia: (q) => ({ matches: matches && q.includes("hover: hover") }) });
  assert.equal(supportsHoverCards(win(true)), true);
  assert.equal(supportsHoverCards(win(false)), false);
  assert.equal(supportsHoverCards(null), false);
  assert.equal(supportsHoverCards({}), false);
  assert.equal(supportsHoverCards({ matchMedia: () => { throw new Error("x"); } }), false);
});

test("cancelling before the request starts rejects without loading anything", async () => {
  const cache = createSummaryCache();
  let loaded = false;
  const handle = cache.fetch("a", async () => {
    loaded = true;
    return {};
  });
  handle.cancel();
  await assert.rejects(handle.promise, { name: "AbortError" });
  assert.equal(loaded, false);
  assert.equal(cache.inFlightCount(), 0);
});

test("a fetch after a cancel starts a fresh request (StrictMode remount)", async () => {
  const cache = createSummaryCache();
  let calls = 0;
  const load = (controller) =>
    new Promise((resolve, reject) => {
      calls += 1;
      controller.signal.addEventListener("abort", () => reject(new Error("aborted")));
      setTimeout(() => resolve({ name: "A" }), 5);
    });
  const first = cache.fetch("a", load);
  first.promise.catch(() => {});
  first.cancel();
  const second = cache.fetch("a", load);
  assert.deepEqual(await second.promise, { name: "A" });
  assert.equal(calls <= 2, true);
  assert.deepEqual(cache.get("a"), { name: "A" });
});
