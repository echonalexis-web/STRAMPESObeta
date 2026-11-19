import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source-level guard for the fluid Browse Jobs grid. Layout itself is checked
// by eye (no DOM in this test runner).
const css = readFileSync(new URL("../styles/jobboard.css", import.meta.url), "utf8");
const page = readFileSync(new URL("../pages/JobBoard.jsx", import.meta.url), "utf8");

test(".jb-list is an intrinsic auto-fit grid, not auto-fill or fixed columns", () => {
  const rule = css.match(/\.jb-list \{[^}]*\}/)?.[0] ?? "";
  assert.match(rule, /repeat\(\s*auto-fit/);
  assert.doesNotMatch(rule, /auto-fill/);
  assert.doesNotMatch(css, /\.jb-list \{ grid-template-columns: repeat\(auto-fill/);
});

test("every results section shares the fluid .jb-list grid and wraps cards in .jb-cell", () => {
  assert.equal((page.match(/className="jb-list"/g) || []).length, 2);
  assert.match(page, /className="jb-cell"/);
  assert.equal((page.match(/\.map\(renderCard\)/g) || []).length, 2);
});

test("wide cells get the two-column card layout through a container query", () => {
  assert.match(css, /container-type:\s*inline-size/);
  assert.match(css, /@container \(min-width: 640px\)/);
});
