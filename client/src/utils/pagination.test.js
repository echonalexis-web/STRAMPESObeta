import test from "node:test";
import assert from "node:assert/strict";
import { ELLIPSIS, clampPage, getPageItems, pageRange, parsePage, parsePageSize, totalPagesFor } from "./pagination.js";

test("page and page size come from the URL safely", () => {
  assert.equal(parsePage("3"), 3);
  assert.equal(parsePage("0"), 1);
  assert.equal(parsePage("-2"), 1);
  assert.equal(parsePage("abc"), 1);
  assert.equal(parsePage(null), 1);
  assert.equal(parsePageSize("25"), 25);
  assert.equal(parsePageSize("7"), 10);
  assert.equal(parsePageSize(undefined), 10);
});

test("total pages, clamping and the shown range", () => {
  assert.equal(totalPagesFor(0, 10), 1);
  assert.equal(totalPagesFor(10, 10), 1);
  assert.equal(totalPagesFor(11, 10), 2);
  assert.equal(totalPagesFor(23, 10), 3);
  assert.equal(clampPage(9, 3), 3);
  assert.equal(clampPage(0, 3), 1);
  assert.deepEqual(pageRange(1, 10, 23), { from: 1, to: 10 });
  assert.deepEqual(pageRange(3, 10, 23), { from: 21, to: 23 });
  assert.deepEqual(pageRange(1, 10, 1), { from: 1, to: 1 });
  assert.deepEqual(pageRange(1, 10, 0), { from: 0, to: 0 });
});

test("numbered pages with ellipses", () => {
  assert.deepEqual(getPageItems(1, 1), [1]);
  assert.deepEqual(getPageItems(2, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(getPageItems(1, 7), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(getPageItems(1, 20), [1, 2, 3, 4, 5, ELLIPSIS, 20]);
  assert.deepEqual(getPageItems(10, 20), [1, ELLIPSIS, 9, 10, 11, ELLIPSIS, 20]);
  assert.deepEqual(getPageItems(20, 20), [1, ELLIPSIS, 16, 17, 18, 19, 20]);
  // Never more slots than the list can hold, and the current page is always listed.
  for (let total = 1; total <= 30; total += 1) {
    for (let current = 1; current <= total; current += 1) {
      const items = getPageItems(current, total);
      assert.ok(items.includes(current), `${current}/${total}`);
      assert.ok(items.length <= 7, `${current}/${total}`);
      assert.equal(items[0], 1);
      assert.equal(items[items.length - 1], total);
    }
  }
});
