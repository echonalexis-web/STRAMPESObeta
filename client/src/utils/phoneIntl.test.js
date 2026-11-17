import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parsePhone,
  toE164,
  sanitizeNational,
  interpretPaste,
  formatNational,
  formatPhoneDisplay,
  phoneHref,
  phoneExample,
  splitStored,
  searchCountries,
  maxNationalDigits,
} from "./phoneIntl.js";
import { PHONE_COUNTRIES } from "../constants/phoneCountries.js";

const vectors = JSON.parse(
  fs.readFileSync(new URL("../../../server/tests/fixtures/phoneVectors.json", import.meta.url), "utf8")
);

test("the same shared vectors the server uses", () => {
  for (const v of vectors.valid) assert.equal(parsePhone(v).ok, true, v);
  for (const v of vectors.invalid) assert.equal(parsePhone(v).ok, false, JSON.stringify(v));
});

test("client list equals server/data/phoneCountries.json (parity)", () => {
  const server = JSON.parse(
    fs.readFileSync(new URL("../../../server/data/phoneCountries.json", import.meta.url), "utf8")
  );
  assert.deepEqual(PHONE_COUNTRIES, server);
});

test("Philippine mobile forms all parse to the same E.164", () => {
  for (const v of ["917 123 4567", "0917 123 4567", "09171234567", "+63 917 123 4567", "639171234567"]) {
    assert.equal(toE164(v), "+639171234567", v);
  }
});

test("error codes: short, long, wrong start, weak, letters, unknown country", () => {
  assert.equal(parsePhone("917 123 456").code, "PHONE_TOO_SHORT");
  assert.equal(parsePhone("0917 123 45678").code, "PHONE_TOO_LONG");
  assert.equal(parsePhone("112 345 6789").code, "PHONE_PH_FORMAT");
  assert.equal(parsePhone("912 345 6789").code, "PHONE_WEAK");
  assert.equal(parsePhone("0917-ABC-4567").code, "PHONE_BAD_CHARS");
  assert.equal(parsePhone("+999 123456").code, "PHONE_COUNTRY_UNKNOWN");
  assert.equal(parsePhone("").code, "PHONE_REQUIRED");
});

test("typing: digits only; a leading 0 is ignored for the Philippines; capped at 10", () => {
  assert.equal(sanitizeNational("09abc17-123 4567", "PH"), "9171234567");
  assert.equal(sanitizeNational("91712345678999", "PH"), "9171234567");
  assert.equal(sanitizeNational("0", "PH"), "");
  assert.equal(sanitizeNational("(0917) 123", "PH"), "917123");
  assert.equal(maxNationalDigits("PH"), 10);
  assert.equal(maxNationalDigits("AE"), 12); // 15 - dial 3
});

test("paste: 09 / 63 / +63 forms drop the prefix; letters are reported and dropped", () => {
  for (const text of ["09171234567", "639171234567", "+63 917 123 4567", "0917 123 4567"]) {
    const res = interpretPaste(text, "PH");
    assert.equal(res.iso, "PH", text);
    assert.equal(res.national, "9171234567", text);
    assert.equal(res.rejected, false, text);
  }
  const letters = interpretPaste("0917-ABC-4567", "PH");
  assert.equal(letters.rejected, true);
  assert.equal(letters.national, "9174567");
});

test("paste: an international number with a known dial code sets the country", () => {
  const us = interpretPaste("+1 415 555 2671", "PH");
  assert.deepEqual({ iso: us.iso, national: us.national }, { iso: "US", national: "4155552671" });
  const gb = interpretPaste("+44 7911 123456", "PH");
  assert.deepEqual({ iso: gb.iso, national: gb.national }, { iso: "GB", national: "7911123456" });
  const unknown = interpretPaste("+999 123456", "PH");
  assert.equal(unknown.iso, "PH");
  assert.equal(unknown.rejected, true);
});

test("display: grouped, Philippine and international; unparseable text is shown as stored", () => {
  assert.equal(formatNational("PH", "9171234567"), "917 123 4567");
  assert.equal(formatNational("PH", "917"), "917");
  assert.equal(formatPhoneDisplay("09125826297"), "+63 912 582 6297");
  assert.equal(formatPhoneDisplay("+639125826297"), "+63 912 582 6297");
  assert.equal(formatPhoneDisplay("+14155552671"), "+1 415 555 2671");
  assert.equal(formatPhoneDisplay("call the office"), "call the office");
  assert.equal(formatPhoneDisplay(""), "");
  assert.equal(formatPhoneDisplay(null), "");
});

test("tel: href uses E.164 when it parses", () => {
  assert.equal(phoneHref("0917 123 4567"), "+639171234567");
  assert.equal(phoneHref("call the office"), "call the office");
});

test("example hint is a number that passes the weak-pattern rule", () => {
  assert.equal(phoneExample("PH"), "917 123 4567");
  assert.equal(parsePhone(phoneExample("PH")).ok, true);
  assert.equal(phoneExample("US"), "");
});

test("splitStored reads any stored format", () => {
  assert.deepEqual(splitStored("+639125826297"), { iso: "PH", national: "9125826297" });
  assert.deepEqual(splitStored("09125826297"), { iso: "PH", national: "9125826297" });
  assert.deepEqual(splitStored("+14155552671"), { iso: "US", national: "4155552671" });
  assert.deepEqual(splitStored(""), { iso: "PH", national: "" });
});

test("country search by name, ISO, and dial code with or without +", () => {
  assert.equal(searchCountries("phil")[0].iso, "PH");
  assert.equal(searchCountries("ph").some((c) => c.iso === "PH"), true);
  assert.equal(searchCountries("63")[0].iso, "PH");
  assert.equal(searchCountries("+63")[0].iso, "PH");
  assert.ok(searchCountries("+44").some((c) => c.iso === "GB"));
  assert.ok(searchCountries("united").length >= 3);
  assert.equal(searchCountries("zzzz").length, 0);
  assert.equal(searchCountries("").length, PHONE_COUNTRIES.length);
  assert.equal(PHONE_COUNTRIES[0].iso, "PH");
});
