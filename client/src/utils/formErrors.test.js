import test from "node:test";
import assert from "node:assert/strict";
import {
  makeError,
  firstInvalidField,
  countErrors,
  mapServerError,
  messageFor,
  phoneErrorEntry,
} from "./formErrors.js";

const axiosError = (data) => ({ response: { data } });

test("firstInvalidField follows the visual order, then falls back to unlisted fields", () => {
  const errors = { phone: makeError("a"), surname: makeError("b"), extra: makeError("c") };
  assert.equal(firstInvalidField(["surname", "phone"], errors), "surname");
  assert.equal(firstInvalidField(["gender", "phone"], errors), "phone");
  assert.equal(firstInvalidField(["gender"], { extra: makeError("c") }), "extra");
  assert.equal(firstInvalidField(["surname"], {}), null);
  assert.equal(firstInvalidField(["surname"], null), null);
});

test("countErrors ignores empty entries", () => {
  assert.equal(countErrors({ a: makeError("x"), b: null, c: undefined }), 1);
  assert.equal(countErrors(null), 0);
});

test("mapServerError: { code, field } is field-level", () => {
  const res = mapServerError(axiosError({ code: "PHONE_PH_FORMAT", field: "phone", message: "x" }));
  assert.equal(res.field, "phone");
  assert.equal(res.key, "phoneInput.errors.phFormat");
});

test("mapServerError: { code } uses the form's field map, else it is form-level", () => {
  assert.equal(mapServerError(axiosError({ code: "USERNAME_TAKEN" }), { USERNAME_TAKEN: "username" }).field, "username");
  const res = mapServerError(axiosError({ code: "SOMETHING" }));
  assert.equal(res.field, null);
  assert.equal(res.key, "errors.codes.SOMETHING");
});

test("mapServerError: message-only and errors[] shapes are form-level and never guess a field", () => {
  const a = mapServerError(axiosError({ message: "Name is required" }));
  assert.deepEqual({ field: a.field, key: a.key, message: a.message }, { field: null, key: null, message: "Name is required" });
  const b = mapServerError(axiosError({ errors: ["first", "second"] }));
  assert.equal(b.message, "first");
  assert.equal(b.field, null);
  assert.equal(mapServerError(null).message, "");
});

test("messageFor: i18n key, then server message, then fallback", () => {
  const t = (key, params) => (key === "known" ? `Known ${params?.n ?? ""}`.trim() : key);
  assert.equal(messageFor(makeError("known", { n: 3 }), t), "Known 3");
  assert.equal(messageFor({ key: "missing", message: "From server" }, t), "From server");
  assert.equal(messageFor({ key: "missing" }, t, "Fallback"), "Fallback");
  assert.equal(messageFor("plain text", t), "plain text");
  assert.equal(messageFor(null, t), "");
});

test("phoneErrorEntry maps every phone code and falls back to the format message", () => {
  assert.equal(phoneErrorEntry("PHONE_REQUIRED").key, "phoneInput.errors.required");
  assert.equal(phoneErrorEntry("PHONE_TOO_SHORT", { min: 10 }).params.min, 10);
  assert.equal(phoneErrorEntry("PHONE_WEIRD").key, "phoneInput.errors.phFormat");
});
