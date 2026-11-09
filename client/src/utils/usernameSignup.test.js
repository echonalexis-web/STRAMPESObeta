import test from "node:test";
import assert from "node:assert/strict";
import {
  isUsernameSignupEnabled,
  userContactLabel,
  hasVerifiedEmail,
  needsEmail,
  shouldShowEmailGate,
  shouldShowEmailBanner,
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

test("shouldShowEmailGate: skip hides it, forced reopens it, excluded pages never show it", () => {
  const user = { role: "jobseeker", hasVerifiedEmail: false };
  assert.equal(shouldShowEmailGate({ user, pathname: "/dashboard" }), true);
  assert.equal(shouldShowEmailGate({ user, pathname: "/dashboard", skipped: true }), false);
  assert.equal(shouldShowEmailGate({ user, pathname: "/dashboard", skipped: true, forced: true }), true);
  for (const pathname of ["/account-suspended", "/verify-email", "/confirm-email"]) {
    assert.equal(shouldShowEmailGate({ user, pathname, forced: true }), false, pathname);
  }
  assert.equal(shouldShowEmailGate({ user: { role: "jobseeker", email: "a@b.co" }, pathname: "/dashboard" }), false);
});

test("shouldShowEmailBanner: only on the screens where limits are felt", () => {
  const user = { role: "jobseeker", hasVerifiedEmail: false };
  for (const pathname of ["/dashboard", "/jobs", "/jobs/123", "/spes", "/spes/postings", "/profile"]) {
    assert.equal(shouldShowEmailBanner({ user, pathname }), true, pathname);
  }
  for (const pathname of ["/settings", "/messages", "/dashboardx"]) {
    assert.equal(shouldShowEmailBanner({ user, pathname }), false, pathname);
  }
  assert.equal(shouldShowEmailBanner({ user: { role: "jobseeker", email: "a@b.co" }, pathname: "/dashboard" }), false);
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
