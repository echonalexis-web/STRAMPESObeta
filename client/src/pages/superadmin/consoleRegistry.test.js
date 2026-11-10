import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONSOLE_FUNCTIONS,
  CONSOLE_GROUPS,
  CONSOLE_HOME,
  descriptionKey,
  filterFunctions,
  findFunction,
  groupFunctions,
  groupKey,
  legacyHashTarget,
  titleKey,
} from "./consoleRegistry.js";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const en = JSON.parse(read("../../i18n/locales/en.json"));
const fil = JSON.parse(read("../../i18n/locales/fil.json"));
const get = (o, key) => key.split(".").reduce((a, p) => (a == null ? a : a[p]), o);
const app = read("../../App.jsx");

test("registry shape: unique ids and paths under /superadmin, known groups", () => {
  assert.equal(new Set(CONSOLE_FUNCTIONS.map((f) => f.id)).size, CONSOLE_FUNCTIONS.length);
  assert.equal(new Set(CONSOLE_FUNCTIONS.map((f) => f.path)).size, CONSOLE_FUNCTIONS.length);
  for (const entry of CONSOLE_FUNCTIONS) {
    assert.ok(entry.path.startsWith(`${CONSOLE_HOME}/`), entry.id);
    assert.equal(entry.path, `${CONSOLE_HOME}/${entry.id}`);
    assert.ok(CONSOLE_GROUPS.includes(entry.group), entry.id);
    assert.ok(entry.icon, entry.id);
  }
});

test("every function and group has a title and description in both locales", () => {
  for (const entry of CONSOLE_FUNCTIONS) {
    for (const key of [titleKey(entry), descriptionKey(entry)]) {
      assert.equal(typeof get(en, key), "string", `en ${key}`);
      assert.equal(typeof get(fil, key), "string", `fil ${key}`);
    }
  }
  for (const group of CONSOLE_GROUPS) {
    assert.equal(typeof get(en, groupKey(group)), "string", group);
    assert.equal(typeof get(fil, groupKey(group)), "string", group);
  }
});

test("every function has a superadmin-only route in App.jsx", () => {
  for (const entry of CONSOLE_FUNCTIONS) {
    const line = app.split("\n").find((l) => l.includes(`path="${entry.path}"`));
    assert.ok(line, `${entry.path} not registered`);
    assert.ok(line.includes('<ProtectedRoute requiredRole="superadmin">'), `${entry.path} is not superadmin only`);
  }
  const home = app.split("\n").find((l) => l.includes(`path="${CONSOLE_HOME}"`));
  assert.ok(home.includes('requiredRole="superadmin"'));
});

const text = (entry) => ({ title: `Title ${entry.id}`, description: entry.id === "catalogs" ? "dropdown lists for forms" : "other" });

test("filterFunctions matches words in the title or description, case-insensitively", () => {
  assert.equal(filterFunctions(CONSOLE_FUNCTIONS, "", text).length, CONSOLE_FUNCTIONS.length);
  assert.equal(filterFunctions(CONSOLE_FUNCTIONS, "   ", text).length, CONSOLE_FUNCTIONS.length);
  assert.deepEqual(filterFunctions(CONSOLE_FUNCTIONS, "DROPDOWN", text).map((f) => f.id), ["catalogs"]);
  assert.deepEqual(filterFunctions(CONSOLE_FUNCTIONS, "dropdown forms", text).map((f) => f.id), ["catalogs"]);
  assert.deepEqual(filterFunctions(CONSOLE_FUNCTIONS, "title nsrp", text).map((f) => f.id), ["nsrp-forms"]);
  assert.deepEqual(filterFunctions(CONSOLE_FUNCTIONS, "nothing like this", text), []);
});

test("groupFunctions keeps group order and drops empty groups", () => {
  const grouped = groupFunctions(CONSOLE_FUNCTIONS);
  assert.deepEqual(grouped.map((g) => g.group), CONSOLE_GROUPS.filter((g) => CONSOLE_FUNCTIONS.some((f) => f.group === g)));
  assert.equal(grouped.flatMap((g) => g.entries).length, CONSOLE_FUNCTIONS.length);
  assert.deepEqual(groupFunctions([findFunction("catalogs")]).map((g) => g.group), ["matching"]);
  assert.deepEqual(groupFunctions([]), []);
});

test("legacy anchors redirect to the matching function page", () => {
  assert.equal(legacyHashTarget("#nsrp-templates-title"), "/superadmin/nsrp-forms");
  assert.equal(legacyHashTarget("#match-weight-bounds-title"), "/superadmin/matching-bounds");
  assert.equal(legacyHashTarget("#system-options-title"), "/superadmin/catalogs");
  assert.equal(legacyHashTarget("#banner-templates-title"), "/superadmin/banner-templates");
  assert.equal(legacyHashTarget("#sac-admins"), "/superadmin/admin-accounts");
  assert.equal(legacyHashTarget("#Catalogs"), "/superadmin/catalogs");
  assert.equal(legacyHashTarget("#unknown"), null);
  assert.equal(legacyHashTarget(""), null);
  assert.equal(legacyHashTarget(undefined), null);
});

test("every redirect target is a registered page", () => {
  const paths = new Set(CONSOLE_FUNCTIONS.map((f) => f.path));
  for (const hash of ["nsrp-templates-title", "match-weight-bounds-title", "system-options-title", "banner-templates-title", "sac-admins"]) {
    assert.ok(paths.has(legacyHashTarget(hash)), hash);
  }
});
