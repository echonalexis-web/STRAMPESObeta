// Step rules and free movement for the jobseeker onboarding wizard. Pure.
//
// getStepErrors(step, state, opts) holds the checks that used to live inside
// handleNext, keyed by field so the shared error pattern can mark each field.
// reachability(...) decides which steps the sidebar may open:
//   step N is reachable when every REQUIRED step before N is complete;
//   a completed step is always reachable; the current step is not a link.

import { meetsMinimumAccountAge } from "./age.js";
import { parsePhone } from "./phoneIntl.js";
import { makeError, phoneErrorEntry } from "./formErrors.js";
import {
  EMPLOYMENT_STATUS_NOT_APPLICABLE,
  UNEMPLOYMENT_REASON_NOT_APPLICABLE,
} from "../constants/profileOptions.js";

export const MIN_AGE = 15;
export const TOTAL_STEPS = 9;
// Training & Eligibility (6) and Profile Photo (9) can always be skipped.
export const OPTIONAL_STEPS = [6, 9];
export const CIVIL_STATUS_OTHER_VALUE = "Other";

const blank = (value) => !String(value ?? "").trim();
const need = (errors, field, key, params) => {
  errors[field] = makeError(`wizardErrors.${key}`, params);
};

// state = { form, preferredIndustries, skills }
// opts  = { originalPhone } (a phone the account already had may be a legacy
//          landline; an unchanged value is not re-validated, as on the server).
export const getStepErrors = (step, state, opts = {}) => {
  const form = state?.form || {};
  const errors = {};

  if (step === 1) {
    if (blank(form.surname)) need(errors, "surname", "surname");
    if (blank(form.firstName)) need(errors, "firstName", "firstName");

    const phone = String(form.phone ?? "").trim();
    const unchanged = phone !== "" && phone === String(opts.originalPhone ?? "").trim();
    if (!phone) {
      errors.phone = phoneErrorEntry("PHONE_REQUIRED");
    } else if (!unchanged) {
      const parsed = parsePhone(phone, { allowLandline: false });
      if (!parsed.ok) errors.phone = phoneErrorEntry(parsed.code, parsed.params);
    } else if (!parsePhone(phone, { allowLandline: true }).ok) {
      // An unchanged legacy value that does not parse still blocks finishing:
      // the apply rule needs a plausible number. Ask for a fresh one.
      errors.phone = phoneErrorEntry("PHONE_INVALID");
    }

    if (!form.dateOfBirth) need(errors, "dateOfBirth", "dateOfBirth");
    else if (!meetsMinimumAccountAge(form.dateOfBirth)) need(errors, "dateOfBirth", "dateOfBirthAge", { min: MIN_AGE });
    if (!form.gender) need(errors, "gender", "gender");
    if (blank(form.address)) need(errors, "address", "address");
  }

  if (step === 2 && (state?.preferredIndustries || []).length < 1) {
    need(errors, "preferredIndustries", "industries");
  }

  if (step === 3 && (state?.skills || []).length < 1) {
    need(errors, "skills", "skills");
  }

  if (step === 4) {
    if ((form.preferredOccupations || []).length < 1) need(errors, "preferredOccupations", "occupations");
    if (!form.availabilityStatus) need(errors, "availabilityStatus", "availability");
  }

  if (step === 5) {
    if (!form.educationalAttainment) need(errors, "educationalAttainment", "attainment");
    if (!form.workExperience) need(errors, "workExperience", "workExperience");
  }

  // Step 6 (Training & Eligibility) is optional.

  if (step === 7) {
    if (!form.civilStatus) need(errors, "civilStatus", "civilStatus");
    if (form.civilStatus === CIVIL_STATUS_OTHER_VALUE && blank(form.civilStatusOther)) {
      need(errors, "civilStatusOther", "civilStatusOther");
    }
    if (blank(form.citizenship)) need(errors, "citizenship", "citizenship");
    if (blank(form.placeOfBirth)) need(errors, "placeOfBirth", "placeOfBirth");
    const pa = form.presentAddress || {};
    if (!pa.region || !pa.province || !pa.municipality || !pa.barangay) need(errors, "presentAddress", "presentAddress");
  }

  if (step === 8) {
    if (!form.employmentStatus) {
      need(errors, "employmentStatus", "employmentStatus");
    } else if (form.employmentStatus === "employed") {
      if (!form.employmentType) need(errors, "employmentType", "employmentType");
    } else if (form.employmentStatus === "unemployed") {
      if (!form.unemploymentReason) {
        need(errors, "unemploymentReason", "unemploymentReason");
      } else if (form.unemploymentReason === "laidoff_abroad" && blank(form.laidoffCountry)) {
        need(errors, "laidoffCountry", "laidoffCountry");
      }
    }
    // "not_applicable" (and "Prefer not to say") needs nothing more.
  }

  // Step 9 (Profile Photo) is optional.
  return errors;
};

export const isStepComplete = (step, state, opts) =>
  Object.keys(getStepErrors(step, state, opts)).length === 0;

const isOptional = (step) => OPTIONAL_STEPS.includes(step);

// The first REQUIRED step that is not complete, or null when all are.
export const firstIncompleteStep = (state, opts, total = TOTAL_STEPS) => {
  for (let step = 1; step <= total; step += 1) {
    if (!isOptional(step) && !isStepComplete(step, state, opts)) return step;
  }
  return null;
};

// Per-step navigation state for the sidebar, the pills and the jump menu.
//   status: "current" | "done" | "available" | "locked"
//   reachable: the user may open it now (false for the current step)
//   blockedBy: the first incomplete required step that locks it (locked only)
export const reachability = (currentStep, state, opts, total = TOTAL_STEPS) => {
  const complete = {};
  for (let step = 1; step <= total; step += 1) complete[step] = isStepComplete(step, state, opts);

  const result = [];
  for (let step = 1; step <= total; step += 1) {
    let blockedBy = null;
    for (let earlier = 1; earlier < step; earlier += 1) {
      if (!isOptional(earlier) && !complete[earlier]) { blockedBy = earlier; break; }
    }
    const locked = blockedBy !== null;
    let status;
    if (step === currentStep) status = "current";
    else if (locked) status = "locked";
    else if ((!isOptional(step) && complete[step]) || (isOptional(step) && step < currentStep)) status = "done";
    else status = "available";
    result.push({ step, status, reachable: !locked && step !== currentStep, blockedBy: locked ? blockedBy : null });
  }
  return result;
};

// The earlier required step that needs attention while the user stands on a later
// step (a draft restored from an older build, or an earlier step edited into an
// incomplete state), or null when everything before the current step is complete.
export const earlierStepNeedingAttention = (currentStep, state, opts, total = TOTAL_STEPS) => {
  const earlier = firstIncompleteStep(state, opts, total);
  return earlier !== null && earlier < currentStep ? earlier : null;
};

export const isNotApplicableStatus = (status) => status === EMPLOYMENT_STATUS_NOT_APPLICABLE;
export const isNotApplicableReason = (reason) => reason === UNEMPLOYMENT_REASON_NOT_APPLICABLE;
