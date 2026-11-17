import test from "node:test";
import assert from "node:assert/strict";
import { getEmployerStepErrors, employerReachability } from "./employerWizardSteps.js";

const complete = () => ({
  companyName: "ABC Corp",
  industry: "Retail",
  companySize: "small",
  businessAddress: "Boac, Marinduque",
  phone: "917 123 4567",
  companyDescription: "We sell things to people.",
  website: "",
});

test("a complete form has no errors", () => {
  assert.deepEqual(getEmployerStepErrors(1, complete()), {});
  assert.deepEqual(getEmployerStepErrors(2, complete()), {});
});

test("step 1: each missing field has its own message", () => {
  const errors = getEmployerStepErrors(1, { companyName: " ", industry: "", companySize: "", businessAddress: "" });
  assert.deepEqual(Object.keys(errors), ["companyName", "industry", "companySize", "businessAddress"]);
});

test("step 2: specific phone error, description length, website format", () => {
  const form = { ...complete(), phone: "", companyDescription: "short", website: "facebook.com/x" };
  const errors = getEmployerStepErrors(2, form);
  assert.equal(errors.phone.key, "phoneInput.errors.required");
  assert.equal(errors.companyDescription, "Description must be at least 10 characters");
  assert.equal(errors.website, "Please enter a valid URL (e.g., https://example.com)");
});

test("employers may give a Philippine landline; a weak or short number is refused", () => {
  assert.equal(getEmployerStepErrors(2, { ...complete(), phone: "02 8123 4567" }).phone, undefined);
  assert.equal(getEmployerStepErrors(2, { ...complete(), phone: "912 345 6789" }).phone.key, "phoneInput.errors.weak");
  assert.equal(getEmployerStepErrors(2, { ...complete(), phone: "917 123 45" }).phone.key, "phoneInput.errors.tooShort");
});

test("reachability: step 2 needs step 1, step 3 needs both, step 4 only after submit", () => {
  const form = complete();
  const onStep1 = employerReachability(1, form, false);
  assert.deepEqual(onStep1.map((s) => s.reachable), [false, true, true, false]);
  const incomplete = employerReachability(1, { ...form, companyName: "" }, false);
  assert.equal(incomplete[1].status, "locked");
  assert.equal(incomplete[1].blockedBy, 1);
  assert.equal(incomplete[2].blockedBy, 1);
  const noPhone = employerReachability(2, { ...form, phone: "" }, false);
  assert.equal(noPhone[2].blockedBy, 2);
  assert.equal(noPhone[0].reachable, true); // can always go back to step 1
});

test("after the submit only the picture step is left", () => {
  const info = employerReachability(4, complete(), true);
  assert.deepEqual(info.map((s) => s.status), ["locked", "locked", "locked", "current"]);
  assert.equal(info[0].submitted, true);
  assert.equal(info[0].blockedBy, null);
});
