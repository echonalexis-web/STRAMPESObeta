import test from "node:test";
import assert from "node:assert/strict";
import {
  getStepErrors,
  isStepComplete,
  firstIncompleteStep,
  reachability,
  earlierStepNeedingAttention,
} from "./wizardSteps.js";

const presentAddress = { region: "IV-B", province: "Marinduque", municipality: "Boac", barangay: "Poblacion" };

// A fully complete draft. Date of birth is far enough in the past for the age rule.
const complete = () => ({
  form: {
    surname: "Dela Cruz",
    firstName: "Ana",
    phone: "917 123 4567",
    dateOfBirth: "2000-01-01",
    gender: "Female",
    address: "Brgy. Poblacion",
    preferredOccupations: ["Clerk"],
    availabilityStatus: "Actively Looking",
    educationalAttainment: "College Graduate",
    workExperience: "Fresh Graduate",
    civilStatus: "Single",
    citizenship: "Filipino",
    placeOfBirth: "Boac",
    presentAddress,
    employmentStatus: "unemployed",
    unemploymentReason: "fresh_grad",
  },
  preferredIndustries: ["Government Services"],
  skills: ["encoding"],
});

const statuses = (current, state) => reachability(current, state).map((s) => s.status);

test("a complete draft has no errors on any step", () => {
  const state = complete();
  for (let step = 1; step <= 9; step += 1) assert.deepEqual(getStepErrors(step, state), {}, `step ${step}`);
  assert.equal(firstIncompleteStep(state), null);
});

test("step 1 errors are keyed by field and carry specific message keys", () => {
  const state = complete();
  state.form.surname = "  ";
  state.form.phone = "";
  state.form.gender = "";
  const errors = getStepErrors(1, state);
  assert.deepEqual(Object.keys(errors).sort(), ["gender", "phone", "surname"]);
  assert.equal(errors.surname.key, "wizardErrors.surname");
  assert.equal(errors.phone.key, "phoneInput.errors.required");
});

test("phone: PH rule, weak number, and an unchanged legacy value", () => {
  const state = complete();
  state.form.phone = "812 345 6789";
  assert.equal(getStepErrors(1, state).phone.key, "phoneInput.errors.phFormat");
  state.form.phone = "912 345 6789";
  assert.equal(getStepErrors(1, state).phone.key, "phoneInput.errors.weak");
  // The account already holds a legacy landline: unchanged, still plausible, allowed.
  state.form.phone = "02 8123 4567";
  assert.equal(getStepErrors(1, state).phone?.key, "phoneInput.errors.phFormat");
  assert.deepEqual(getStepErrors(1, state, { originalPhone: "02 8123 4567" }), {});
});

test("step 8: Not applicable needs no type or reason; employed and unemployed still do", () => {
  const state = complete();
  state.form.employmentStatus = "not_applicable";
  state.form.unemploymentReason = "";
  assert.deepEqual(getStepErrors(8, state), {});
  state.form.employmentStatus = "employed";
  assert.equal(getStepErrors(8, state).employmentType.key, "wizardErrors.employmentType");
  state.form.employmentStatus = "unemployed";
  assert.equal(getStepErrors(8, state).unemploymentReason.key, "wizardErrors.unemploymentReason");
  state.form.unemploymentReason = "not_applicable";
  assert.deepEqual(getStepErrors(8, state), {});
  state.form.unemploymentReason = "laidoff_abroad";
  assert.equal(getStepErrors(8, state).laidoffCountry.key, "wizardErrors.laidoffCountry");
});

test("step 5 accepts Not applicable as an answer", () => {
  const state = complete();
  state.form.workExperience = "Not applicable";
  assert.deepEqual(getStepErrors(5, state), {});
  state.form.workExperience = "";
  assert.ok(getStepErrors(5, state).workExperience);
});

test("step 7: civil status Other needs the specify text; address must be complete", () => {
  const state = complete();
  state.form.civilStatus = "Other";
  assert.ok(getStepErrors(7, state).civilStatusOther);
  state.form.civilStatusOther = "Separated";
  state.form.presentAddress = { ...presentAddress, barangay: "" };
  assert.deepEqual(Object.keys(getStepErrors(7, state)), ["presentAddress"]);
});

test("Step 5 to Step 1 and back to Step 5 is allowed when steps 1-4 are complete", () => {
  const state = complete();
  const onStep5 = reachability(5, state);
  assert.equal(onStep5[0].reachable, true); // can jump to Step 1
  const onStep1 = reachability(1, state);
  assert.equal(onStep1[4].reachable, true); // and straight back to Step 5
  assert.equal(onStep1[8].reachable, true); // optional steps never block, so even Step 9
});

test("the current step is never a link", () => {
  const info = reachability(3, complete());
  assert.equal(info[2].status, "current");
  assert.equal(info[2].reachable, false);
});

test("an incomplete required step locks everything after it and names the blocker", () => {
  const state = complete();
  state.skills = [];
  const info = reachability(1, state);
  assert.equal(info[1].reachable, true); // step 2 is before the gap
  assert.equal(info[2].reachable, true); // step 3 itself is reachable (steps 1-2 complete)
  assert.equal(info[3].status, "locked");
  assert.equal(info[3].blockedBy, 3);
  assert.equal(info[8].blockedBy, 3);
});

test("optional steps 6 and 9 never lock later steps", () => {
  const state = complete();
  const info = reachability(1, state);
  assert.equal(info[6].reachable, true); // step 7 reachable though step 6 was never filled
});

test("editing step 1 into an incomplete state locks later steps again", () => {
  const state = complete();
  assert.equal(statuses(5, state)[7], "done");
  state.form.surname = "";
  const after = reachability(5, state);
  assert.equal(after[1].status, "locked");
  assert.equal(after[1].blockedBy, 1);
  assert.equal(earlierStepNeedingAttention(5, state), 1);
  assert.equal(earlierStepNeedingAttention(1, state), null);
});

test("completed required steps show as done; the first gap is available", () => {
  const state = complete();
  state.form.workExperience = "";
  const s = statuses(1, state);
  assert.equal(s[1], "done");
  assert.equal(s[4], "available"); // step 5 incomplete but reachable
  assert.equal(s[5], "locked"); // step 6 behind the incomplete step 5
  assert.equal(isStepComplete(5, state), false);
});
