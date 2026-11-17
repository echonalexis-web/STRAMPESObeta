// Client-side checks for the Edit profile form (mirrors what the server checks;
// the server stays the authority). Returns { [field]: errorEntry } and `tabs`
// saying which Edit profile tab holds each field, so the page can open it.

import { parsePhone } from "./phoneIntl.js";
import { phoneErrorEntry } from "./formErrors.js";

// Which tab holds a field (Edit profile tab ids).
export const PROFILE_FIELD_TABS = {
  phone: "profile",
  mobileSecondary: "nsrp",
};

// Fields in the order the person meets them (tab order, then top to bottom).
export const PROFILE_FIELD_ORDER = ["phone", "mobileSecondary"];

// ctx = { role, originalPhone, originalSecondary }
//   An unchanged value is never re-validated (an old stored value must not block
//   an unrelated save), the same rule the server applies.
export const getProfileFormErrors = (formData, ctx = {}) => {
  const errors = {};
  const phone = String(formData?.phone ?? "").trim();
  if (phone && phone !== String(ctx.originalPhone ?? "").trim()) {
    const parsed = parsePhone(phone, { allowLandline: ctx.role !== "jobseeker" });
    if (!parsed.ok) errors.phone = phoneErrorEntry(parsed.code, parsed.params);
  }

  const secondary = String(formData?.mobileSecondary ?? "").trim();
  if (secondary && secondary.replace(/\D/g, "") && secondary !== String(ctx.originalSecondary ?? "").trim()) {
    const parsed = parsePhone(secondary, { allowLandline: false });
    if (!parsed.ok) errors.mobileSecondary = phoneErrorEntry(parsed.code, parsed.params);
  }
  return errors;
};

// The first tab id that holds an error, in field order, or null.
export const firstErrorTab = (errors) => {
  const field = PROFILE_FIELD_ORDER.find((name) => errors[name]);
  return field ? PROFILE_FIELD_TABS[field] : null;
};
