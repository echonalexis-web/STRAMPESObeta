import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localDayStartIso, localDayEndIso } from "./newsDateRange.js";

test("start of day is local midnight, end of day is local 23:59:59.999", () => {
  const start = new Date(localDayStartIso("2026-11-13"));
  const end = new Date(localDayEndIso("2026-11-13"));
  assert.deepEqual([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours(), start.getMinutes()], [2026, 10, 13, 0, 0]);
  assert.deepEqual([end.getFullYear(), end.getMonth(), end.getDate(), end.getHours(), end.getMinutes(), end.getSeconds()], [2026, 10, 13, 23, 59, 59]);
  assert.ok(end > start);
});

test("empty or malformed values give undefined", () => {
  for (const bad of ["", undefined, null, "2026-13-40x", "13/11/2026", "abc"]) {
    assert.equal(localDayStartIso(bad), undefined);
    assert.equal(localDayEndIso(bad), undefined);
  }
});

test("news.filters strings exist in en and fil with the same keys", () => {
  const read = (name) => JSON.parse(readFileSync(new URL(`../i18n/locales/${name}.json`, import.meta.url), "utf8"));
  const en = read("en").news?.filters;
  const fil = read("fil").news?.filters;
  assert.ok(en && fil, "news.filters missing in en or fil");
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fil).sort());
  for (const key of Object.keys(en)) assert.ok(String(fil[key]).trim(), `fil.${key} empty`);
});
