import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
const load = (lang) => {
  const text = read(`../i18n/locales/${lang}.json`);
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
};
const flatten = (node, prefix = "") =>
  Object.entries(node).flatMap(([key, value]) =>
    value && typeof value === "object" ? flatten(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]]
  );

const en = load("en");
const fil = load("fil");
const enFlat = Object.fromEntries(flatten(en));
const filFlat = Object.fromEntries(flatten(fil));

const NAMESPACES = [
  "register",
  "password",
  "emailStep",
  "emailBanner",
  "login",
  "forgot",
  "forgotUsername",
  "alerts",
  "admin.accounts",
  "admin.reset",
  "admin.find",
  "navbar.findAccount",
  "emailPrompt",
  "backupSignup",
  "applyStep",
  "recoveryPhone",
  "report.applicant",
  "emailBanner.messageBenefits",
  "emailBanner.dismiss",
  "navbar.reviewReports",
  "superadmin.moderation.adminOnlyNote",
  "staffRecovery.phoneChip",
  "staffRecovery.completeInPerson",
  "staffRecovery.inPersonHint",
  "staffRecovery.idTypeShown",
  "staffRecovery.idChecked",
  "staffRecovery.chooseIdType",
  "staffRecovery.fields.contactPhone",
  "settings.account.emailNotSet",
  "settings.account.addEmail",
  "settings.account.emailUnverifiedHint",
  "common.emailNotAdded",
  "common.noEmailOnFile",
];
const inScope = (key) => NAMESPACES.some((ns) => key === ns || key.startsWith(`${ns}.`));

// Every error code the server can return from the username sign-up routes.
const SERVER_CODES = [
  "APPLY_DAILY_LIMIT",
  "CONVERSATION_DAILY_LIMIT",
  "UPLOAD_DAILY_LIMIT",
  "PHONE_REQUIRED",
  "PHONE_INVALID",
  "RESET_REASON_REQUIRED",
  "ID_CHECK_REQUIRED",
  "ID_TYPE_REQUIRED",
  "STAFF_PASSWORD_INCORRECT",
  "REPORT_ACTION_FORBIDDEN",
  "RECOVERY_PENDING",
  "ACCOUNT_INACTIVE",
  "EMAIL_CODE_INVALID",
  "EMAIL_CODE_COOLDOWN",
  "EMAIL_CODE_LIMIT",
  "EMAIL_INVALID",
  "EMAIL_ALREADY_SET",
  "USERNAME_TAKEN",
  "USERNAME_INVALID",
  "SIGNUP_DISABLED",
  "SIGNUP_REJECTED",
  "RATE_LIMITED",
  "PASSWORD_INCORRECT",
  "PASSWORD_WEAK",
  "PASSWORD_TOO_COMMON",
  "PASSWORD_SAME_AS_USERNAME",
  "PASSWORD_SAME_AS_BIRTHDATE",
  "PASSWORD_TOO_SHORT_USERNAME_MODE",
  "REASON_REQUIRED",
];

const placeholders = (s) => (String(s).match(/\{\{\s*\w+\s*\}\}/g) || []).sort().join(",");

test("new namespaces exist in both locales with identical keys", () => {
  const enKeys = Object.keys(enFlat).filter(inScope).sort();
  const filKeys = Object.keys(filFlat).filter(inScope).sort();
  assert.ok(enKeys.length > 50);
  assert.deepEqual(filKeys, enKeys);
});

test("new strings are non-empty and keep the same {{placeholders}}", () => {
  for (const key of Object.keys(enFlat).filter(inScope)) {
    assert.ok(String(enFlat[key]).trim(), `en ${key} is empty`);
    assert.ok(String(filFlat[key]).trim(), `fil ${key} is empty`);
    assert.equal(placeholders(filFlat[key]), placeholders(enFlat[key]), `placeholder mismatch in ${key}`);
  }
});

test("every server error code from the new routes is translated in both languages", () => {
  for (const code of SERVER_CODES) {
    assert.ok(enFlat[`errors.codes.${code}`], `en errors.codes.${code}`);
    assert.ok(filFlat[`errors.codes.${code}`], `fil errors.codes.${code}`);
    assert.equal(placeholders(filFlat[`errors.codes.${code}`]), placeholders(enFlat[`errors.codes.${code}`]));
  }
});

test("the three rewritten settings strings no longer assume an email", () => {
  for (const flat of [enFlat, filFlat]) {
    assert.doesNotMatch(flat["settings.account.username.noneHint"], /only sign in with your email|email lang/i);
  }
  assert.doesNotMatch(enFlat["settings.account.recoveryEmail.formHint"], /Must be different from your sign-in email\./);
});

// Every literal t("...") key used by the new or changed components must exist.
const COMPONENT_FILES = [
  "../components/EmailPrompt.jsx",
  "../pages/admin/FindAccount.jsx",
  "../components/EmailBanner.jsx",
  "../components/BackupCodesStep.jsx",
  "../components/ApplyPhoneStep.jsx",
  "../components/ResetPasswordControl.jsx",
  "../components/TemporaryPasswordPanel.jsx",
  "../components/CodeInput.jsx",
  "../components/AccountSecuritySummary.jsx",
  "../pages/ForgotUsername.jsx",
  "../pages/ForgotPassword.jsx",
  "../pages/Login.jsx",
  "../pages/Register.jsx",
];
const NEW_NAMESPACES = [
  "register.",
  "password.",
  "emailStep.",
  "emailBanner.",
  "login.",
  "forgot.",
  "forgotUsername.",
  "alerts.",
  "admin.accounts.",
  "admin.reset.",
  "admin.find.",
  "emailPrompt.",
  "backupSignup.",
  "applyStep.",
  "recoveryPhone.",
  "report.",
];

test("literal translation keys used by the sign-up components exist in en and fil", () => {
  for (const file of COMPONENT_FILES) {
    let source;
    try {
      source = read(file);
    } catch {
      assert.fail(`missing component file ${file}`);
    }
    for (const match of source.matchAll(/\bt\(\s*["']([\w.]+)["']/g)) {
      const key = match[1];
      if (!NEW_NAMESPACES.some((ns) => key.startsWith(ns)) && !key.startsWith("settings.account.") && !key.startsWith("common.")) continue;
      assert.ok(key in enFlat, `${file}: en is missing ${key}`);
      assert.ok(key in filFlat, `${file}: fil is missing ${key}`);
    }
  }
});

test("password problem keys produced by the helper are all translated", async () => {
  const { passwordProblems } = await import("./usernameSignup.js");
  const problems = new Set([
    ...passwordProblems({ password: "a" }),
    ...passwordProblems({ password: "a", usernameOnly: true }),
    ...passwordProblems({ password: "juan_dc1!Aa", username: "juan_dc" }),
    ...passwordProblems({ password: "2000-01-15", dateOfBirth: "2000-01-15" }),
  ]);
  assert.ok(problems.size >= 8);
  for (const key of problems) {
    assert.ok(enFlat[`password.${key}`], `en password.${key}`);
    assert.ok(filFlat[`password.${key}`], `fil password.${key}`);
  }
});
