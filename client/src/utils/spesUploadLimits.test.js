// Client upload limits and the messages shown for them: type, size, count, network.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  SPES_COVER_LIMITS,
  SPES_DOC_LIMITS,
  SPES_MAX_FILES_PER_APPLICATION,
  bytesToMb,
  formatFileSize,
  uploadErrorCode,
  uploadMessageParams,
  validateUploadFile,
} from "./spesUploadLimits.js";
import { SPES_ALLOWED_MIME, SPES_MAX_FILE_SIZE, checkSpesFile } from "./spesSlots.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../i18n/locales");
const load = (name) => JSON.parse(readFileSync(path.join(dir, name), "utf8").replace(/^﻿/, ""));
const locales = { en: load("en.json"), fil: load("fil.json") };

const file = (type, size) => ({ type, size, name: "x" });
const MB = 1024 * 1024;

test("limits match the spec: documents 5 MB PDF/JPG/PNG, cover 3 MB JPG/PNG/WEBP, four files", () => {
  assert.equal(SPES_DOC_LIMITS.maxBytes, 5 * MB);
  assert.deepEqual(SPES_DOC_LIMITS.mimes, ["application/pdf", "image/jpeg", "image/png"]);
  assert.equal(SPES_COVER_LIMITS.maxBytes, 3 * MB);
  assert.deepEqual(SPES_COVER_LIMITS.mimes, ["image/jpeg", "image/png", "image/webp"]);
  assert.equal(SPES_MAX_FILES_PER_APPLICATION, 4);
});

test("spesSlots re-exports the same limits (one source of truth)", () => {
  assert.equal(SPES_MAX_FILE_SIZE, SPES_DOC_LIMITS.maxBytes);
  assert.equal(SPES_ALLOWED_MIME, SPES_DOC_LIMITS.mimes);
  assert.equal(checkSpesFile(file("application/pdf", MB)), null);
});

test("documents: valid, too large, wrong type, empty, missing", () => {
  assert.equal(validateUploadFile(file("application/pdf", 5 * MB)), null);
  assert.equal(validateUploadFile(file("image/png", 1)), null);
  assert.equal(validateUploadFile(file("application/pdf", 5 * MB + 1)), "SPES_FILE_TOO_LARGE");
  assert.equal(validateUploadFile(file("image/gif", MB)), "SPES_FILE_TYPE");
  assert.equal(validateUploadFile(file("application/pdf", 0)), "SPES_FILE_TYPE");
  assert.equal(validateUploadFile(null), "SPES_DOCS_MISSING");
});

test("cover: WEBP allowed, PDF refused, 3 MB cap", () => {
  assert.equal(validateUploadFile(file("image/webp", MB), SPES_COVER_LIMITS), null);
  assert.equal(validateUploadFile(file("application/pdf", MB), SPES_COVER_LIMITS), "SPES_COVER_TYPE");
  assert.equal(validateUploadFile(file("image/png", 3 * MB + 1), SPES_COVER_LIMITS), "SPES_COVER_TOO_LARGE");
});

test("file sizes and limits are formatted for people", () => {
  assert.equal(formatFileSize(500), "500 B");
  assert.equal(formatFileSize(2048), "2 KB");
  assert.equal(formatFileSize(2.5 * MB), "2.5 MB");
  assert.equal(bytesToMb(5 * MB), 5);
});

test("failed requests map to stable codes, never raw transport text", () => {
  assert.equal(uploadErrorCode({ code: "ERR_CANCELED" }), "UPLOAD_CANCELED");
  assert.equal(uploadErrorCode({ response: { status: 413, data: { code: "SPES_FILE_TOO_LARGE" } } }), "SPES_FILE_TOO_LARGE");
  assert.equal(uploadErrorCode({ response: { status: 413, data: {} } }), "SPES_FILE_TOO_LARGE");
  assert.equal(uploadErrorCode({ response: { status: 415, data: {} } }), "SPES_FILE_TYPE");
  assert.equal(uploadErrorCode({ code: "ECONNABORTED" }), "UPLOAD_TIMEOUT");
  assert.equal(uploadErrorCode({ message: "Network Error" }), "UPLOAD_NETWORK");
  assert.equal(uploadErrorCode({ response: { status: 500, data: {} } }), "SPES_UPLOAD_FAILED");
});

test("every upload code is translated in both languages and states the real limit", () => {
  const codes = [
    "SPES_FILE_TYPE", "SPES_FILE_TOO_LARGE", "SPES_FILE_UNEXPECTED", "SPES_TOO_MANY_FILES",
    "SPES_UPLOAD_FAILED", "SPES_COVER_TYPE", "SPES_COVER_TOO_LARGE", "UPLOAD_ONE_FILE",
    "UPLOAD_NETWORK", "UPLOAD_TIMEOUT", "UPLOAD_CANCELED",
  ];
  for (const [name, locale] of Object.entries(locales)) {
    for (const code of codes) {
      const text = locale.errors.codes[code];
      assert.ok(text && text.trim(), `${name}: errors.codes.${code}`);
    }
    // The size messages interpolate the limit instead of hard-coding it.
    assert.match(locale.errors.codes.SPES_FILE_TOO_LARGE, /\{\{max\}\}/, name);
    assert.match(locale.errors.codes.SPES_COVER_TOO_LARGE, /\{\{coverMax\}\}/, name);
    assert.match(locale.errors.codes.SPES_TOO_MANY_FILES, /\{\{count\}\}/, name);
  }
  assert.deepEqual(uploadMessageParams(), { max: 5, coverMax: 3, count: 4 });
});
