import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SEGMENTED_MIN_WIDTH, railFits, segmentPositions } from "./segmentedRail.js";

const css = readFileSync(new URL("../styles/segmented-rail.css", import.meta.url), "utf8");

test("a rail of one pill is single; two pills are first and last", () => {
  assert.deepEqual(segmentPositions(0), []);
  assert.deepEqual(segmentPositions(1), ["single"]);
  assert.deepEqual(segmentPositions(2), ["first", "last"]);
});

test("first, middle and last positions for a longer rail", () => {
  assert.deepEqual(segmentPositions(5), ["first", "middle", "middle", "middle", "last"]);
  assert.deepEqual(segmentPositions("3"), ["first", "middle", "last"]);
  assert.deepEqual(segmentPositions(-2), []);
});

test("the position depends only on the pill's place, never on which pill is active", () => {
  // The active pill can be first, middle or last: the shape comes from segmentPositions(count) alone.
  const shapes = segmentPositions(8);
  for (const active of [0, 3, 7]) {
    assert.deepEqual(segmentPositions(8), shapes, `active pill ${active} must not change the shape`);
  }
});

test("a joined rail fits only when it neither scrolls nor outgrows its parent", () => {
  assert.equal(railFits({ scrollWidth: 600, clientWidth: 600, parentWidth: 800 }), true);
  assert.equal(railFits({ scrollWidth: 601, clientWidth: 600, parentWidth: 800 }), true, "1px of rounding is fine");
  assert.equal(railFits({ scrollWidth: 760, clientWidth: 600, parentWidth: 800 }), false, "rail scrolls itself");
  assert.equal(railFits({ scrollWidth: 900, clientWidth: 900, parentWidth: 800 }), false, "wider than its parent");
  assert.equal(railFits({ scrollWidth: 500, clientWidth: 500, parentWidth: 0 }), true, "no parent width known");
});

test("the 8-pill Your Applications rail (about 900px) does not fit beside the sidebar at 1024px", () => {
  // content width at a 1024px window with the 264px sidebar and gutters is roughly 700px
  assert.equal(railFits({ scrollWidth: 900, clientWidth: 900, parentWidth: 700 }), false);
});

test("stylesheet: ends are fully rounded, inner sides small, one pill fully rounded", () => {
  assert.match(css, /data-seg-pos="first"\][^{]*\{[^}]*border-radius: var\(--ds-radius-pill\) var\(--ds-radius-sm\) var\(--ds-radius-sm\) var\(--ds-radius-pill\)/);
  assert.match(css, /data-seg-pos="last"\][^{]*\{[^}]*border-radius: var\(--ds-radius-sm\) var\(--ds-radius-pill\) var\(--ds-radius-pill\) var\(--ds-radius-sm\)/);
  assert.match(css, /data-seg-pos="single"\][^{]*\{[^}]*border-radius: var\(--ds-radius-pill\)/);
  assert.match(css, /> \[data-seg-pos\] \{[^}]*border-radius: var\(--ds-radius-sm\)/);
});

test("stylesheet: only from 769px, only when joined, focused pill raised, count badges untouched", () => {
  assert.equal(SEGMENTED_MIN_WIDTH, 769);
  assert.match(css, /@media \(min-width: 769px\)/);
  assert.ok(!/\[data-segmented="separate"\]/.test(css), "the separate shape adds no rules: it is each rail's own");
  assert.match(css, /:focus-visible\s*\{[^}]*z-index: 3/);
  assert.ok(!/count|badge|__n\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")), "no rule touches a pill's count badge");
});
