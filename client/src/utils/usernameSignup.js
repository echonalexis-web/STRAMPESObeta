// Pure helpers for username-only sign-up (no React, no network), so the rules
// are unit-testable. The server is the authority on every one of these; the
// client only mirrors them to give early, specific feedback.

import { nudgeIsDue } from "./emailNudge.js";

const JOBSEEKER_ROLES = ["jobseeker", "employee", "resident"];

// Build-time flag mirroring the server's USERNAME_SIGNUP_ENABLED. It hides the
// sign-up toggle, the remember-username box and the forgot-username link when
// off. (The email prompt and banner are driven by the account itself: only an
// email-less jobseeker ever sees them. An email is optional, never required.)
export const isUsernameSignupEnabled = (env) => {
  const source = env ?? (typeof import.meta !== "undefined" ? import.meta.env : undefined);
  return String(source?.VITE_USERNAME_SIGNUP_ENABLED ?? "").trim().toLowerCase() === "true";
};

// ---------------------------------------------------------------- contact label

// What to show wherever an email used to be shown. Never invents an address.
export const userContactLabel = (user, { emptyLabel = "—" } = {}) => {
  const email = String(user?.email ?? "").trim();
  if (email) return email;
  const username = String(user?.username ?? "").trim();
  if (username) return `@${username}`;
  return emptyLabel;
};

// ---------------------------------------------------------------- email prompt (optional)

// Server flag wins when present; otherwise derive it the way the server does
// (an address, and not a literal isEmailVerified === false).
export const hasVerifiedEmail = (user) => {
  if (!user) return false;
  if (typeof user.hasVerifiedEmail === "boolean") return user.hasVerifiedEmail;
  return Boolean(String(user.email ?? "").trim()) && user.isEmailVerified !== false;
};

// True only for a jobseeker with no verified email. It decides who is OFFERED an
// email; nothing is blocked for them.
export const needsEmail = (user) => Boolean(user) && JOBSEEKER_ROLES.includes(user.role) && !hasVerifiedEmail(user);

// A jobseeker with no email address at all (a username-only account).
export const isUsernameOnly = (user) =>
  Boolean(user) && JOBSEEKER_ROLES.includes(user.role) && !String(user.email ?? "").trim();

export const onboardingDone = (user) => user?.hasCompletedOnboarding === true || user?.onboardingComplete === true;

// Never over the email-confirmation or suspension pages.
const EXCLUDED_PREFIXES = ["/account-suspended", "/verify-email", "/confirm-email"];
const excluded = (pathname) => EXCLUDED_PREFIXES.some((prefix) => pathname.startsWith(prefix));

// The one-time card, right after onboarding. It is a card, not a dialog, and
// never blocks navigation. `forced` is an explicit "Add email" click.
export const shouldShowEmailPrompt = ({ user, pathname = "", nudge, forced = false }) => {
  if (!needsEmail(user) || excluded(pathname)) return false;
  if (forced) return true;
  return onboardingDone(user) && !(nudge && nudge.promptSeen);
};

// The slim banner. After the one-time card it comes back only when the
// reappearance schedule (14, 45, 90 days, then never) says so.
const BANNER_PREFIXES = ["/dashboard", "/jobs", "/spes", "/profile"];
export const shouldShowEmailBanner = ({ user, pathname = "", nudge, now = Date.now() }) =>
  needsEmail(user) &&
  !excluded(pathname) &&
  BANNER_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) &&
  Boolean(nudge && nudge.promptSeen) &&
  nudgeIsDue(nudge, now);

// The default backup-codes card right after a username-only sign-up (on the first
// onboarding screen) until backup codes exist or the person dismisses it.
export const shouldShowBackupStep = ({ user, pathname = "", nudge }) =>
  isUsernameOnly(user) &&
  !user.backupCodesGeneratedAt &&
  pathname.startsWith("/onboarding") &&
  !(nudge && nudge.backupStepDismissed);

// ---------------------------------------------------------------- code input

export const CODE_LENGTH = 6;

// Whatever was typed or pasted, reduced to at most six digits.
export const parseCodeInput = (raw) => String(raw ?? "").replace(/\D/g, "").slice(0, CODE_LENGTH);

export const isCompleteCode = (code) => /^\d{6}$/.test(String(code ?? ""));

// ---------------------------------------------------------------- countdown

// "0:42", "12:05". Negative or invalid values read as 0:00.
export const formatCountdown = (totalSeconds) => {
  const n = Number(totalSeconds);
  const safe = Number.isFinite(n) && n > 0 ? Math.ceil(n) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

// Whole seconds left until `untilMs`, never negative.
export const secondsLeft = (untilMs, nowMs = Date.now()) => Math.max(0, Math.ceil((Number(untilMs) - nowMs) / 1000));

// ---------------------------------------------------------------- identifier

// "email" when it contains "@", otherwise "username" (the same split the
// server's login uses); "empty" for blank input.
export const identifierKind = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return "empty";
  return text.includes("@") ? "email" : "username";
};

// ---------------------------------------------------------------- remembered username

export const REMEMBERED_USERNAME_KEY = "strampesoRememberedUsername";

// Storage is injected so this stays testable and every call is guarded:
// localStorage can throw (private windows, blocked site data). Only a USERNAME
// is ever stored: never a password, never an email (shared PESO and school
// computers).
export const readRememberedUsername = (storage) => {
  try {
    const value = String(storage?.getItem(REMEMBERED_USERNAME_KEY) ?? "").trim();
    return identifierKind(value) === "username" ? value : "";
  } catch {
    return "";
  }
};

export const writeRememberedUsername = (storage, identifier) => {
  try {
    const value = String(identifier ?? "").trim();
    if (identifierKind(value) !== "username") return false;
    storage.setItem(REMEMBERED_USERNAME_KEY, value);
    return true;
  } catch {
    return false;
  }
};

export const clearRememberedUsername = (storage) => {
  try {
    storage.removeItem(REMEMBERED_USERNAME_KEY);
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------- password hints

export const MIN_PASSWORD_LENGTH = 8;
export const MIN_PASSWORD_LENGTH_USERNAME_ONLY = 10;
const SPECIAL = /[!@#$%^&*(),.?":{}|<>]/;

const dobDigitForms = (dateOfBirth) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateOfBirth ?? ""));
  if (!match) return [];
  const [, y, m, d] = match;
  return [`${y}${m}${d}`, `${d}${m}${y}`, `${m}${d}${y}`, `${y}-${m}-${d}`, `${d}-${m}-${y}`, `${m}-${d}-${y}`];
};

// Returns the list of problems as stable keys (translated by the caller under
// password.*). It cannot mirror the server's common-password list; the server
// answers PASSWORD_TOO_COMMON for those.
export const passwordProblems = ({ password, username = "", dateOfBirth = "", usernameOnly = false } = {}) => {
  const value = String(password ?? "");
  const problems = [];
  const min = usernameOnly ? MIN_PASSWORD_LENGTH_USERNAME_ONLY : MIN_PASSWORD_LENGTH;
  if (value.length < min) problems.push(usernameOnly ? "tooShortUsernameMode" : "tooShort");
  if (!/[A-Z]/.test(value)) problems.push("upper");
  if (!/[a-z]/.test(value)) problems.push("lower");
  if (!/\d/.test(value)) problems.push("number");
  if (!SPECIAL.test(value)) problems.push("special");

  const name = String(username ?? "").trim().toLowerCase();
  if (name && value.toLowerCase().includes(name)) problems.push("sameAsUsername");

  const lower = value.toLowerCase();
  if (dobDigitForms(dateOfBirth).some((form) => lower === form || (/^\d{8}$/.test(form) && value.includes(form)))) {
    problems.push("sameAsBirthDate");
  }
  return problems;
};
