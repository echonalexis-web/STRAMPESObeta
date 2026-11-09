import test from "node:test";
import assert from "node:assert/strict";
import {
  NUDGE_INTERVAL_DAYS,
  emptyNudge,
  nudgeIsDue,
  nudgeIsStopped,
  readNudge,
  writeNudge,
  markPromptSeen,
  recordDismissal,
  markBackupStepDismissed,
} from "./emailNudge.js";

const DAY = 24 * 60 * 60 * 1000;
const memoryStorage = () => {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
};
const blockedStorage = () => ({
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
});

test("the schedule is 14, 45 and 90 days", () => {
  assert.deepEqual(NUDGE_INTERVAL_DAYS, [14, 45, 90]);
});

test("due at once with no dismissals; then 14, 45 and 90 days after the matching dismissal; then never", () => {
  const t0 = 1_800_000_000_000;
  const after = (dismissCount, days) => nudgeIsDue({ ...emptyNudge(), dismissCount, lastDismissedAt: t0 }, t0 + days * DAY);
  assert.equal(nudgeIsDue(emptyNudge(), t0), true);
  assert.equal(after(1, 13.99), false);
  assert.equal(after(1, 14), true);
  assert.equal(after(2, 44.99), false);
  assert.equal(after(2, 45), true);
  assert.equal(after(3, 89.99), false);
  assert.equal(after(3, 90), true);
  assert.equal(after(4, 10 * 365), false);
  assert.equal(after(99, 10 * 365), false);
});

test("stopped only after the fourth dismissal", () => {
  assert.equal(nudgeIsStopped({ dismissCount: 3 }), false);
  assert.equal(nudgeIsStopped({ dismissCount: 4 }), true);
});

test("recordDismissal counts, stamps the time, and marks the prompt as seen", () => {
  const s = memoryStorage();
  const first = recordDismissal("u1", 1000, s);
  assert.deepEqual(first, { dismissCount: 1, lastDismissedAt: 1000, promptSeen: true, backupStepDismissed: false });
  const second = recordDismissal("u1", 5000, s);
  assert.equal(second.dismissCount, 2);
  assert.equal(second.lastDismissedAt, 5000);
  assert.equal(readNudge("u1", s).dismissCount, 2);
});

test("each user has their own state", () => {
  const s = memoryStorage();
  recordDismissal("u1", 1000, s);
  assert.equal(readNudge("u2", s).dismissCount, 0);
  markPromptSeen("u2", s);
  assert.equal(readNudge("u1", s).promptSeen, true);
  assert.equal(readNudge("u2", s).dismissCount, 0);
});

test("markPromptSeen and markBackupStepDismissed keep the other fields", () => {
  const s = memoryStorage();
  recordDismissal("u1", 1000, s);
  markBackupStepDismissed("u1", s);
  const state = markPromptSeen("u1", s);
  assert.deepEqual(state, { dismissCount: 1, lastDismissedAt: 1000, promptSeen: true, backupStepDismissed: true });
});

test("storage that throws or holds junk is handled, never thrown", () => {
  const blocked = blockedStorage();
  assert.deepEqual(readNudge("u1", blocked), emptyNudge());
  assert.equal(writeNudge("u1", emptyNudge(), blocked), false);
  assert.doesNotThrow(() => recordDismissal("u1", 1, blocked));

  const s = memoryStorage();
  s.map.set("strampesoEmailNudge:u1", "not json");
  assert.deepEqual(readNudge("u1", s), emptyNudge());
  s.map.set("strampesoEmailNudge:u1", JSON.stringify({ dismissCount: -5, lastDismissedAt: "x", promptSeen: "yes" }));
  assert.deepEqual(readNudge("u1", s), emptyNudge());
  assert.deepEqual(readNudge("", s), emptyNudge());
  assert.deepEqual(readNudge("u1", null), emptyNudge());
});

test("a bogus huge count is capped, not trusted", () => {
  const s = memoryStorage();
  s.map.set("strampesoEmailNudge:u1", JSON.stringify({ dismissCount: 1e9, lastDismissedAt: 1, promptSeen: true }));
  assert.equal(readNudge("u1", s).dismissCount, 99);
  assert.equal(nudgeIsDue(readNudge("u1", s), Date.now()), false);
});
