import test from "node:test";
import assert from "node:assert/strict";
import { getProfileFormErrors, firstErrorTab, PROFILE_FIELD_TABS } from "./profileFormErrors.js";

test("a valid phone and secondary mobile produce no errors", () => {
  assert.deepEqual(getProfileFormErrors({ phone: "+639171234567", mobileSecondary: "0918 123 4567" }, { role: "jobseeker" }), {});
  assert.deepEqual(getProfileFormErrors({ phone: "", mobileSecondary: "" }, { role: "jobseeker" }), {});
});

test("a bad phone gets the specific message key", () => {
  const errors = getProfileFormErrors({ phone: "912 345 6789" }, { role: "jobseeker" });
  assert.equal(errors.phone.key, "phoneInput.errors.weak");
  assert.equal(getProfileFormErrors({ phone: "+63 917 123 45" }, {}).phone.key, "phoneInput.errors.tooShort");
});

test("an unchanged stored phone is not re-validated", () => {
  const ctx = { role: "jobseeker", originalPhone: "legacy 12" };
  assert.deepEqual(getProfileFormErrors({ phone: "legacy 12" }, ctx), {});
  assert.ok(getProfileFormErrors({ phone: "legacy 13" }, ctx).phone);
});

test("jobseekers are mobile only; employers and staff may use a landline", () => {
  assert.ok(getProfileFormErrors({ phone: "02 8123 4567" }, { role: "jobseeker" }).phone);
  assert.deepEqual(getProfileFormErrors({ phone: "02 8123 4567" }, { role: "employer" }), {});
  assert.deepEqual(getProfileFormErrors({ phone: "02 8123 4567" }, { role: "admin" }), {});
});

test("secondary mobile: punctuation-only is ignored, a bad number is flagged, unchanged is skipped", () => {
  assert.deepEqual(getProfileFormErrors({ mobileSecondary: "-" }, {}), {});
  assert.ok(getProfileFormErrors({ mobileSecondary: "12" }, {}).mobileSecondary);
  assert.deepEqual(getProfileFormErrors({ mobileSecondary: "n/a 12" }, { originalSecondary: "n/a 12" }), {});
});

test("firstErrorTab follows the field order and names the tab", () => {
  assert.equal(PROFILE_FIELD_TABS.phone, "profile");
  assert.equal(firstErrorTab({ mobileSecondary: {}, phone: {} }), "profile");
  assert.equal(firstErrorTab({ mobileSecondary: {} }), "nsrp");
  assert.equal(firstErrorTab({}), null);
});
