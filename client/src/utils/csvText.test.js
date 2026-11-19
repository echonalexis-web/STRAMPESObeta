import test from "node:test";
import assert from "node:assert/strict";
import { csvCell, toCsv, CSV_BOM } from "./csvText.js";

test("text that starts like a formula is neutralized with an apostrophe", () => {
  for (const evil of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"]) {
    assert.ok(csvCell(evil).replace(/^"/, "").startsWith("'"), `not neutralized: ${JSON.stringify(evil)}`);
  }
  assert.equal(csvCell("=1+1"), "'=1+1");
});

test("a leading space does not hide a formula start from the check, but a plain space is left alone", () => {
  assert.equal(csvCell(" hello"), " hello");
  assert.equal(csvCell("a=b"), "a=b");
});

test("numbers made by the code stay numbers, including negatives", () => {
  assert.equal(csvCell(-3), "-3");
  assert.equal(csvCell(0), "0");
  assert.equal(csvCell(12), "12");
});

test("quotes, commas and newlines are quoted and doubled; empty values are empty", () => {
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("a formula that also needs quoting is neutralized and then quoted", () => {
  assert.equal(csvCell('=A1,"x"'), `"'=A1,""x"""`);
});

test("toCsv writes a header and the rows, neutralizing labels and values alike", () => {
  const out = toCsv([{ label: "Name", get: (r) => r.name }, { label: "=Bad", get: (r) => r.n }], [{ name: "+evil", n: 2 }, { name: "Ana", n: -1 }]);
  assert.equal(out, "Name,'=Bad\n'+evil,2\nAna,-1");
  assert.equal(CSV_BOM, "﻿");
});
