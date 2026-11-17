import test from "node:test";
import assert from "node:assert/strict";
import {
  employmentStatusLabel,
  experienceYearsText,
  unemploymentReasonLabel,
  workExperienceLabel,
  isNotApplicableExperience,
} from "./profileLabels.js";
import { WORK_EXPERIENCE_OPTIONS, EMPLOYMENT_STATUS_OPTIONS, optionLabel } from "../constants/profileOptions.js";
import { UNEMPLOYMENT_REASON_OPTIONS } from "../constants/unemploymentReasons.js";

test("every old value keeps its label", () => {
  assert.equal(employmentStatusLabel("employed"), "Employed");
  assert.equal(employmentStatusLabel("unemployed"), "Unemployed");
  assert.equal(employmentStatusLabel("Prefer not to say"), "Prefer not to say");
  assert.equal(employmentStatusLabel(""), "");
  assert.equal(unemploymentReasonLabel("fresh_grad"), "Fresh Graduate");
  assert.equal(unemploymentReasonLabel("laidoff_abroad"), "Laid off (Abroad)");
  assert.equal(unemploymentReasonLabel("some_old_value"), "some old value");
  assert.equal(workExperienceLabel("3–5 years"), "3–5 years");
});

test("the new values never show their raw stored text", () => {
  assert.match(employmentStatusLabel("not_applicable"), /Not applicable/);
  assert.doesNotMatch(employmentStatusLabel("not_applicable"), /_/);
  assert.match(unemploymentReasonLabel("not_applicable"), /Not applicable/);
  assert.equal(workExperienceLabel("Not applicable"), "Not applicable");
});

test("labels use the translate function when it returns a real string", () => {
  const t = (key) => (key === "profileOptions.workExperienceNotApplicable" ? "Hindi naaangkop" : key);
  assert.equal(workExperienceLabel("Not applicable", t), "Hindi naaangkop");
  // A missing key (t returns the key) falls back to English.
  assert.match(employmentStatusLabel("not_applicable", t), /Not applicable/);
});

test("option lists: Not applicable is last in Work Experience, third in status, last in reasons", () => {
  assert.equal(WORK_EXPERIENCE_OPTIONS.at(-1).value, "Not applicable");
  assert.equal(WORK_EXPERIENCE_OPTIONS.length, 6);
  assert.deepEqual(EMPLOYMENT_STATUS_OPTIONS.map((o) => o.value), ["employed", "unemployed", "not_applicable"]);
  assert.equal(UNEMPLOYMENT_REASON_OPTIONS.at(-1).value, "not_applicable");
  assert.equal(UNEMPLOYMENT_REASON_OPTIONS.length, 8);
  const t = (key) => `T:${key}`;
  assert.equal(optionLabel(WORK_EXPERIENCE_OPTIONS.at(-1), t), "T:profileOptions.workExperienceNotApplicable");
  assert.equal(optionLabel(WORK_EXPERIENCE_OPTIONS[0], t), "Fresh Graduate");
});

test("isNotApplicableExperience", () => {
  assert.equal(isNotApplicableExperience("Not applicable"), true);
  assert.equal(isNotApplicableExperience("Fresh Graduate"), false);
});

test("cover letter: {years} is not filled with 'Not applicable'", () => {
  assert.equal(experienceYearsText("3–5 years"), "3–5 years");
  assert.equal(experienceYearsText("Not applicable"), "");
  assert.equal(experienceYearsText(""), "");
  assert.equal(experienceYearsText(null), "");
});
