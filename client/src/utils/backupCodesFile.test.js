import test from "node:test";
import assert from "node:assert/strict";
import { backupCodesFilename, buildBackupCodesText, localDateStamp } from "./backupCodesFile.js";

const CODES = ["ABCD-2345", "WXYZ-9876", "KMNP-QRST"];
const HEADER = { title: "STRAM PESO - Backup codes", generatedLabel: "Generated: 2026-11-08", notes: ["Each code works once.", "Keep this file private."] };

test("codes are written bare, verbatim, in order, one per line", () => {
  const lines = buildBackupCodesText(CODES, HEADER).split("\r\n");
  const codeLines = lines.filter((l) => /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(l));
  assert.deepEqual(codeLines, CODES);
});

test("no numbering, bullets or extra text on a code line", () => {
  const text = buildBackupCodesText(CODES, HEADER);
  for (const code of CODES) {
    const line = text.split("\r\n").find((l) => l.includes(code));
    assert.equal(line, code);
  }
});

test("uses CRLF line endings and ends with a newline", () => {
  const text = buildBackupCodesText(CODES, HEADER);
  assert.ok(text.endsWith("\r\n"));
  assert.ok(!/[^\r]\n/.test(text), "found a bare LF");
});

test("header and notes come first, separated from the codes by a blank line", () => {
  const lines = buildBackupCodesText(CODES, HEADER).split("\r\n");
  assert.equal(lines[0], HEADER.title);
  assert.equal(lines[1], HEADER.generatedLabel);
  assert.equal(lines[2], "");
  assert.equal(lines[3], HEADER.notes[0]);
  assert.equal(lines[lines.indexOf(CODES[0]) - 1], "");
});

test("works without a header (codes only)", () => {
  assert.equal(buildBackupCodesText(CODES), CODES.join("\r\n") + "\r\n");
});

test("never writes account details", () => {
  const text = buildBackupCodesText(CODES, HEADER);
  assert.ok(!/@/.test(text));
});

test("empty or invalid code lists are rejected", () => {
  assert.throws(() => buildBackupCodesText([]));
  assert.throws(() => buildBackupCodesText(null));
  assert.throws(() => buildBackupCodesText(["", "  "]));
});

test("filename is strampeso-backup-codes-YYYY-MM-DD.txt using the local date", () => {
  const d = new Date(2026, 10, 8, 23, 59); // 8 Nov 2026, local
  assert.equal(localDateStamp(d), "2026-11-08");
  assert.equal(backupCodesFilename(d), "strampeso-backup-codes-2026-11-08.txt");
  assert.match(backupCodesFilename(), /^strampeso-backup-codes-\d{4}-\d{2}-\d{2}\.txt$/);
});

test("settings.account.backupCodes.* keys match between en.json and fil.json", async () => {
  const { readFileSync } = await import("node:fs");
  const load = (lang) => {
    const text = readFileSync(new URL(`../i18n/locales/${lang}.json`, import.meta.url), "utf8");
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).settings.account.backupCodes;
  };
  const flat = (node, prefix = "") =>
    Object.entries(node).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));
  const en = Object.fromEntries(flat(load("en")));
  const fil = Object.fromEntries(flat(load("fil")));
  assert.deepEqual(Object.keys(fil).sort(), Object.keys(en).sort());
  for (const key of ["download", "downloaded", "downloadError", "file.title", "file.generated", "file.note1", "file.note2"]) {
    assert.ok(String(en[key]).trim(), `en ${key}`);
    assert.ok(String(fil[key]).trim(), `fil ${key}`);
  }
  assert.ok(en["file.generated"].includes("{{date}}") && fil["file.generated"].includes("{{date}}"));
});
