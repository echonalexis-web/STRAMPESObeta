const { memoizeString } = require("../utils/memoizeString");

test("repeated short inputs reuse their computed value", () => {
  const compute = jest.fn(key => key.split(" "));
  const memoized = memoizeString(compute, { maxEntries: 2, maxKeyLength: 20 });
  const first = memoized("office clerk");
  expect(memoized("office clerk")).toBe(first);
  expect(compute).toHaveBeenCalledTimes(1);
});

test("a small bounded cache evicts and recomputes without changing outputs", () => {
  const compute = jest.fn(key => [key.toUpperCase()]);
  const memoized = memoizeString(compute, { maxEntries: 2, maxKeyLength: 20 });
  const first = memoized("first");
  const second = memoized("second");
  memoized("third");
  expect(memoized("second")).toBe(second);
  const recomputed = memoized("first");
  expect(recomputed).toEqual(first);
  expect(recomputed).not.toBe(first);
  expect(compute).toHaveBeenCalledTimes(4);
});

test("long inputs are computed correctly without occupying or evicting cached entries", () => {
  const compute = jest.fn(key => [key]);
  const memoized = memoizeString(compute, { maxEntries: 1, maxKeyLength: 4 });
  const short = memoized("ok");
  expect(memoized("long-input")).toEqual(["long-input"]);
  expect(memoized("long-input")).toEqual(["long-input"]);
  expect(memoized("ok")).toBe(short);
  expect(compute).toHaveBeenCalledTimes(3);
});

test("nullish values retain the original empty-string normalization", () => {
  const compute = jest.fn(key => [key]);
  const memoized = memoizeString(compute, { maxEntries: 1, maxKeyLength: 4 });
  expect(memoized(null)).toEqual([""]);
  expect(memoized(undefined)).toEqual([""]);
  expect(compute).toHaveBeenCalledTimes(1);
});

test("failed computation does not poison the cache", () => {
  const compute = jest.fn().mockImplementationOnce(() => { throw new Error("dummy failure"); }).mockReturnValue(["ok"]);
  const memoized = memoizeString(compute, { maxEntries: 1, maxKeyLength: 4 });
  expect(() => memoized("key")).toThrow("dummy failure");
  expect(memoized("key")).toEqual(["ok"]);
  expect(compute).toHaveBeenCalledTimes(2);
});

test.each([
  { maxEntries: 0, maxKeyLength: 4 }, { maxEntries: Infinity, maxKeyLength: 4 },
  { maxEntries: 1.5, maxKeyLength: 4 }, { maxEntries: 2, maxKeyLength: -1 },
])("invalid bounds cannot silently create an unbounded cache (%j)", options => {
  expect(() => memoizeString(String, options)).toThrow(RangeError);
});
