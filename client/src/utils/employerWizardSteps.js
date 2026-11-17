// Step rules and free movement for the employer onboarding wizard. Pure.
//   1 Company Information   2 Contact Details   3 Review & Submit   4 Profile picture
// Step N opens when every required step before it is complete; steps 1-3 lock for
// good once the details were submitted (only the picture step is left).

import { parsePhone } from "./phoneIntl.js";
import { phoneErrorEntry } from "./formErrors.js";

export const EMPLOYER_TOTAL_STEPS = 4;
export const EMPLOYER_SUBMIT_STEP = 3;
export const EMPLOYER_PHOTO_STEP = 4;

const blank = (value) => !String(value ?? "").trim();

// Same messages the page showed before; the phone gets the specific phone errors.
export const getEmployerStepErrors = (step, form) => {
  const errors = {};
  const f = form || {};
  if (step === 1) {
    if (blank(f.companyName)) errors.companyName = "Company name is required";
    if (blank(f.industry)) errors.industry = "Please select an industry";
    if (blank(f.companySize)) errors.companySize = "Please select a company size";
    if (blank(f.businessAddress)) errors.businessAddress = "Business address is required";
  }
  if (step === 2) {
    // An employer may give a landline (many businesses only have one).
    const parsed = parsePhone(f.phone, { allowLandline: true });
    if (!parsed.ok) errors.phone = phoneErrorEntry(parsed.code, parsed.params);
    if (blank(f.companyDescription)) errors.companyDescription = "Please add a short company description";
    else if (String(f.companyDescription).trim().length < 10) errors.companyDescription = "Description must be at least 10 characters";
    if (!blank(f.website) && !/^https?:\/\/[^\s]+$/.test(String(f.website).trim())) {
      errors.website = "Please enter a valid URL (e.g., https://example.com)";
    }
  }
  return errors;
};

export const isEmployerStepComplete = (step, form) => Object.keys(getEmployerStepErrors(step, form)).length === 0;

// Same shape as reachability() in wizardSteps.js. `finished` is true once the
// details were submitted. blockedBy is the step to finish first; locked steps
// after the submit have blockedBy null and `submitted: true`.
export const employerReachability = (currentStep, form, finished) => {
  const complete = { 1: isEmployerStepComplete(1, form), 2: isEmployerStepComplete(2, form) };
  const result = [];
  for (let step = 1; step <= EMPLOYER_TOTAL_STEPS; step += 1) {
    let blockedBy = null;
    let submitted = false;
    if (finished) {
      if (step <= EMPLOYER_SUBMIT_STEP) submitted = true;
    } else if (step === EMPLOYER_PHOTO_STEP) {
      blockedBy = EMPLOYER_SUBMIT_STEP;
    } else {
      for (let earlier = 1; earlier < step && earlier <= 2; earlier += 1) {
        if (!complete[earlier]) { blockedBy = earlier; break; }
      }
    }
    const locked = blockedBy !== null || submitted;
    let status;
    if (step === currentStep) status = "current";
    else if (locked) status = "locked";
    else if (step <= 2 && complete[step]) status = "done";
    else status = "available";
    result.push({ step, status, reachable: !locked && step !== currentStep, blockedBy, submitted });
  }
  return result;
};
