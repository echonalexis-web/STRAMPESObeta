import test from "node:test";
import assert from "node:assert/strict";
import {
  isUsernameSignupEnabled,
  userContactLabel,
  hasVerifiedEmail,
  needsEmail,
  isUsernameOnly,
  onboardingDone,
  shouldShowEmailPrompt,
  shouldShowEmailBanner,
  shouldShowBackupStep,
  parseCodeInput,
  isCompleteCode,
  formatCountdown,
  secondsLeft,
  identifierKind,
  readRememberedUsername,
  writeRememberedUsername,
  clearRememberedUsername,
  REMEMBERED_USERNAME_KEY,
  passwordProblems,
} from "./usernameSignup.js";

const memoryStorage = () => {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
};
const throwingStorage = () => ({
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
  removeItem() {
    throw new Error("blocked");
  },
});

test("flag is on only for the exact string 'true'", () => {
  assert.equal(isUsernameSignupEnabled({}), false);
  assert.equal(isUsernameSignupEnabled({ VITE_USERNAME_SIGNUP_ENABLED: "1" }), false);
  assert.equal(isUsernameSignupEnabled({ VITE_USERNAME_SIGNUP_ENABLED: " True " }), true);
});

test("userContactLabel: email, then @username, then an em dash; never invents anything", () => {
  assert.equal(userContactLabel({ email: "a@b.co", username: "juan" }), "a@b.co");
  assert.equal(userContactLabel({ email: "  ", username: "juan" }), "@juan");
  assert.equal(userContactLabel({ username: "juan" }), "@juan");
  assert.equal(userContactLabel({}), "—");
  assert.equal(userContactLabel(null), "—");
  assert.equal(userContactLabel({}, { emptyLabel: "No email" }), "No email");
});

test("hasVerifiedEmail: server flag wins, else derived like the server", () => {
  assert.equal(hasVerifiedEmail({ hasVerifiedEmail: false, email: "a@b.co" }), false);
  assert.equal(hasVerifiedEmail({ hasVerifiedEmail: true }), true);
  assert.equal(hasVerifiedEmail({ email: "a@b.co" }), true); // legacy: isEmailVerified undefined
  assert.equal(hasVerifiedEmail({ email: "a@b.co", isEmailVerified: false }), false);
  assert.equal(hasVerifiedEmail({ username: "x" }), false);
  assert.equal(hasVerifiedEmail(null), false);
});

test("needsEmail: jobseekers without a verified email only", () => {
  assert.equal(needsEmail({ role: "jobseeker", hasVerifiedEmail: false }), true);
  assert.equal(needsEmail({ role: "employee", username: "x" }), true);
  assert.equal(needsEmail({ role: "jobseeker", email: "a@b.co" }), false);
  assert.equal(needsEmail({ role: "employer" }), false);
  assert.equal(needsEmail({ role: "admin" }), false);
  assert.equal(needsEmail(null), false);
});

const DAY = 24 * 60 * 60 * 1000;
const seen = { dismissCount: 0, lastDismissedAt: 0, promptSeen: true, backupStepDismissed: false };
const NOT_SEEN = { dismissCount: 0, lastDismissedAt: 0, promptSeen: false, backupStepDismissed: false };
const emailless = { role: "jobseeker", hasVerifiedEmail: false, hasCompletedOnboarding: true };

test("isUsernameOnly and onboardingDone", () => {
  assert.equal(isUsernameOnly({ role: "jobseeker" }), true);
  assert.equal(isUsernameOnly({ role: "jobseeker", email: "a@b.co" }), false);
  assert.equal(isUsernameOnly({ role: "employer" }), false);
  assert.equal(onboardingDone({ hasCompletedOnboarding: true }), true);
  assert.equal(onboardingDone({ onboardingComplete: true }), true);
  assert.equal(onboardingDone({ hasCompletedOnboarding: false }), false);
});

test("shouldShowEmailPrompt: once, only after onboarding, never on excluded pages, forced by an Add email click", () => {
  assert.equal(shouldShowEmailPrompt({ user: emailless, pathname: "/dashboard", nudge: NOT_SEEN }), true);
  assert.equal(shouldShowEmailPrompt({ user: emailless, pathname: "/dashboard", nudge: seen }), false);
  assert.equal(shouldShowEmailPrompt({ user: { ...emailless, hasCompletedOnboarding: false }, pathname: "/onboarding", nudge: NOT_SEEN }), false);
  assert.equal(shouldShowEmailPrompt({ user: emailless, pathname: "/dashboard", nudge: seen, forced: true }), true);
  for (const pathname of ["/account-suspended", "/verify-email", "/confirm-email"]) {
    assert.equal(shouldShowEmailPrompt({ user: emailless, pathname, nudge: NOT_SEEN, forced: true }), false, pathname);
  }
  assert.equal(shouldShowEmailPrompt({ user: { role: "jobseeker", email: "a@b.co" }, pathname: "/dashboard", nudge: NOT_SEEN }), false);
  assert.equal(shouldShowEmailPrompt({ user: { role: "employer" }, pathname: "/dashboard", nudge: NOT_SEEN }), false);
});

test("shouldShowEmailBanner: only after the one-time card, only on the listed screens, and only when due", () => {
  const now = 1_800_000_000_000;
  for (const pathname of ["/dashboard", "/jobs", "/jobs/123", "/spes", "/spes/postings", "/profile"]) {
    assert.equal(shouldShowEmailBanner({ user: emailless, pathname, nudge: seen, now }), true, pathname);
  }
  for (const pathname of ["/settings", "/messages", "/dashboardx"]) {
    assert.equal(shouldShowEmailBanner({ user: emailless, pathname, nudge: seen, now }), false, pathname);
  }
  // before the card has been shown the banner stays away
  assert.equal(shouldShowEmailBanner({ user: emailless, pathname: "/dashboard", nudge: NOT_SEEN, now }), false);
  // an account with an email never sees it
  assert.equal(shouldShowEmailBanner({ user: { role: "jobseeker", email: "a@b.co" }, pathname: "/dashboard", nudge: seen, now }), false);
});

test("shouldShowEmailBanner follows the 14, 45, 90 day schedule and then stops", () => {
  const t0 = 1_800_000_000_000;
  const dismissed = (count) => ({ ...seen, dismissCount: count, lastDismissedAt: t0 });
  const show = (count, afterDays) => shouldShowEmailBanner({ user: emailless, pathname: "/dashboard", nudge: dismissed(count), now: t0 + afterDays * DAY });
  assert.equal(show(1, 13), false);
  assert.equal(show(1, 14), true);
  assert.equal(show(2, 44), false);
  assert.equal(show(2, 45), true);
  assert.equal(show(3, 89), false);
  assert.equal(show(3, 90), true);
  assert.equal(show(4, 100000), false); // after the fourth dismissal it never returns
});

test("shouldShowBackupStep: username-only accounts on the first onboarding screen, until saved or dismissed", () => {
  const user = { role: "jobseeker" };
  assert.equal(shouldShowBackupStep({ user, pathname: "/onboarding", nudge: NOT_SEEN }), true);
  assert.equal(shouldShowBackupStep({ user, pathname: "/dashboard", nudge: NOT_SEEN }), false);
  assert.equal(shouldShowBackupStep({ user: { ...user, backupCodesGeneratedAt: "2026-11-10" }, pathname: "/onboarding", nudge: NOT_SEEN }), false);
  assert.equal(shouldShowBackupStep({ user, pathname: "/onboarding", nudge: { ...NOT_SEEN, backupStepDismissed: true } }), false);
  assert.equal(shouldShowBackupStep({ user: { role: "jobseeker", email: "a@b.co" }, pathname: "/onboarding", nudge: NOT_SEEN }), false);
  assert.equal(shouldShowBackupStep({ user: { role: "employer" }, pathname: "/onboarding", nudge: NOT_SEEN }), false);
});

test("parseCodeInput strips everything but digits and caps at six", () => {
  assert.equal(parseCodeInput("123 456"), "123456");
  assert.equal(parseCodeInput("123-456"), "123456");
  assert.equal(parseCodeInput(" 12a3 "), "123");
  assert.equal(parseCodeInput("1234567890"), "123456");
  assert.equal(parseCodeInput(undefined), "");
  assert.equal(isCompleteCode("123456"), true);
  assert.equal(isCompleteCode("12345"), false);
  assert.equal(isCompleteCode("12345a"), false);
});

test("formatCountdown and secondsLeft", () => {
  assert.equal(formatCountdown(42), "0:42");
  assert.equal(formatCountdown(60), "1:00");
  assert.equal(formatCountdown(605), "10:05");
  assert.equal(formatCountdown(41.2), "0:42");
  assert.equal(formatCountdown(-5), "0:00");
  assert.equal(formatCountdown("x"), "0:00");
  assert.equal(secondsLeft(10_500, 10_000), 1);
  assert.equal(secondsLeft(9_000, 10_000), 0);
});

test("identifierKind splits on '@'", () => {
  assert.equal(identifierKind("juan_dc"), "username");
  assert.equal(identifierKind("juan@example.com"), "email");
  assert.equal(identifierKind("   "), "empty");
});

test("remembered username: stores usernames only, never an email, never throws", () => {
  const s = memoryStorage();
  assert.equal(writeRememberedUsername(s, "juan_dc"), true);
  assert.equal(s.map.get(REMEMBERED_USERNAME_KEY), "juan_dc");
  assert.equal(readRememberedUsername(s), "juan_dc");
  assert.equal(writeRememberedUsername(s, "juan@example.com"), false);
  assert.equal(s.map.get(REMEMBERED_USERNAME_KEY), "juan_dc"); // unchanged
  s.map.set(REMEMBERED_USERNAME_KEY, "leaked@example.com");
  assert.equal(readRememberedUsername(s), ""); // an email in storage is ignored
  assert.equal(clearRememberedUsername(s), true);
  assert.equal(readRememberedUsername(s), "");

  const blocked = throwingStorage();
  assert.equal(readRememberedUsername(blocked), "");
  assert.equal(writeRememberedUsername(blocked, "juan_dc"), false);
  assert.equal(clearRememberedUsername(blocked), false);
});

test("passwordProblems mirrors the server rules", () => {
  assert.deepEqual(passwordProblems({ password: "Zq7!mNvKwpL" }), []);
  assert.deepEqual(passwordProblems({ password: "short" }), ["tooShort", "upper", "number", "special"]);
  assert.ok(passwordProblems({ password: "Zq7!mNvKw", usernameOnly: true }).includes("tooShortUsernameMode"));
  assert.ok(!passwordProblems({ password: "Zq7!mNvKwp", usernameOnly: true }).includes("tooShortUsernameMode"));
  assert.ok(passwordProblems({ password: "Juan_dc1!Xy", username: "juan_dc" }).includes("sameAsUsername"));
  assert.ok(passwordProblems({ password: "Ab15012000!", dateOfBirth: "2000-01-15" }).includes("sameAsBirthDate"));
  assert.ok(passwordProblems({ password: "2000-01-15", dateOfBirth: "2000-01-15" }).includes("sameAsBirthDate"));
  assert.ok(!passwordProblems({ password: "Zq7!mNvKwpL", dateOfBirth: "2000-01-15" }).includes("sameAsBirthDate"));
});
