import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizePhone, isValidPhone, phoneProblem } from "./phone.js";
import { applyErrorKind, formatWait } from "./applyGate.js";

// The SAME vectors the server tests use, so the two checks cannot drift apart.
const vectors = JSON.parse(
  fs.readFileSync(new URL("../../../server/tests/fixtures/phoneVectors.json", import.meta.url), "utf8")
);

test("every server-valid phone is valid on the client", () => {
  for (const v of vectors.valid) assert.equal(isValidPhone(v), true, v);
});

test("every server-invalid phone is invalid on the client", () => {
  for (const v of vectors.invalid) assert.equal(isValidPhone(v), false, JSON.stringify(v));
});

test("normalizes every mobile form to 09XXXXXXXXX", () => {
  for (const v of ["09171234567", "+639171234567", "639171234567", "9171234567", "0917 123 4567"]) {
    assert.equal(normalizePhone(v), "09171234567");
  }
});

test("empty is PHONE_REQUIRED, present but wrong is PHONE_INVALID", () => {
  assert.equal(phoneProblem(""), "PHONE_REQUIRED");
  assert.equal(phoneProblem(undefined), "PHONE_REQUIRED");
  assert.equal(phoneProblem("12345"), "PHONE_INVALID");
  assert.equal(phoneProblem("09171234567"), null);
});

test("applyErrorKind: phone, daily limit, everything else", () => {
  const err = (data) => ({ response: { data } });
  assert.deepEqual(applyErrorKind(err({ code: "PHONE_REQUIRED" })), { kind: "phone", code: "PHONE_REQUIRED" });
  assert.deepEqual(applyErrorKind(err({ code: "PHONE_INVALID" })), { kind: "phone", code: "PHONE_INVALID" });
  assert.deepEqual(applyErrorKind(err({ code: "APPLY_DAILY_LIMIT", retryAfter: 3600 })), { kind: "limit", retryAfter: 3600 });
  assert.deepEqual(applyErrorKind(err({ code: "APPLY_DAILY_LIMIT" })), { kind: "limit", retryAfter: 0 });
  assert.deepEqual(applyErrorKind(err({ code: "SOMETHING" })), { kind: "other" });
  assert.deepEqual(applyErrorKind(err({ message: "x" })), { kind: "other" });
  assert.deepEqual(applyErrorKind(null), { kind: "other" });
  assert.deepEqual(applyErrorKind({}), { kind: "other" });
});

test("formatWait", () => {
  assert.equal(formatWait(45), "45 s");
  assert.equal(formatWait(60), "1 min");
  assert.equal(formatWait(61), "2 min");
  assert.equal(formatWait(3600), "1 h");
  assert.equal(formatWait(3 * 3600 + 20 * 60), "3 h 20 min");
  assert.equal(formatWait(0), "");
  assert.equal(formatWait(-3), "");
  assert.equal(formatWait("x"), "");
});

test("the client codes match the codes the server sends for the apply guards", () => {
  const server = fs.readFileSync(new URL("../../../server/middleware/applyGuards.js", import.meta.url), "utf8");
  for (const code of ["PHONE_REQUIRED", "PHONE_INVALID", "APPLY_DAILY_LIMIT"]) {
    assert.ok(server.includes(code) || fs.readFileSync(new URL("../../../server/utils/phone.js", import.meta.url), "utf8").includes(code), code);
  }
});
