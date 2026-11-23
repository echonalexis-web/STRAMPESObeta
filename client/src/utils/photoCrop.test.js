import test from "node:test";
import assert from "node:assert/strict";
import { cropRect, MAX_ZOOM } from "./photoCrop.js";

test("zoom 1 takes the largest centred square", () => {
  assert.deepEqual(cropRect(800, 400), { sx: 200, sy: 0, side: 400 });
  assert.deepEqual(cropRect(400, 800), { sx: 0, sy: 200, side: 400 });
  assert.deepEqual(cropRect(500, 500), { sx: 0, sy: 0, side: 500 });
});

test("zooming in shrinks the square around the centre", () => {
  assert.deepEqual(cropRect(800, 400, 2), { sx: 300, sy: 100, side: 200 });
});

test("the offsets slide the square to the edges and no further", () => {
  assert.deepEqual(cropRect(800, 400, 2, -1, -1), { sx: 0, sy: 0, side: 200 });
  assert.deepEqual(cropRect(800, 400, 2, 1, 1), { sx: 600, sy: 200, side: 200 });
  assert.deepEqual(cropRect(800, 400, 2, 9, -9), { sx: 600, sy: 0, side: 200 }); // clamped
});

test("zoom is clamped and junk values fall back to centre", () => {
  assert.equal(cropRect(400, 400, 99).side, 400 / MAX_ZOOM);
  assert.equal(cropRect(400, 400, 0.1).side, 400);
  assert.deepEqual(cropRect(800, 400, 1, NaN, undefined), { sx: 200, sy: 0, side: 400 });
});
