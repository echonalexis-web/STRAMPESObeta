import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractActivationToken, ACTIVATION_RULES } from "./activationLink.js";
import { getAccountState, getAvailableActions } from "./userStatus.js";
import { STATUS_SHAPES, statusBadgeClass, statusShape } from "./statusBadge.js";
import { passwordProblems } from "./usernameSignup.js";

const TOKEN = "ab".repeat(32);

test("the token is read from the fragment, or from a query, and only when it has the server's shape", () => {
  assert.equal(extractActivationToken(`#token=${TOKEN}`, ""), TOKEN);
  assert.equal(extractActivationToken("", `?token=${TOKEN}`), TOKEN);
  assert.equal(extractActivationToken(`#token=${TOKEN}&x=1`, ""), TOKEN);
});

test("anything that is not a 64-character lowercase hex token reads as no token", () => {
  for (const hash of ["", "#", "#token=", "#token=abc", `#token=${TOKEN.toUpperCase()}`, `#token=${TOKEN}zz`, "#other=1", "#%E0%A4%A"]) {
    assert.equal(extractActivationToken(hash, ""), "", `hash ${hash}`);
  }
  assert.equal(extractActivationToken(undefined, undefined), "");
  assert.equal(extractActivationToken(null, null), "");
});

test("a pending staff account is its own state, not a suspension, and gets no suspend or restore actions", () => {
  const pending = { role: "admin", isActive: false, accountStatus: "pending_activation" };
  assert.equal(getAccountState(pending), "pending");
  assert.deepEqual(getAvailableActions(pending), { deactivate: false, reactivate: false, delete: false, restore: false });
  // A non-staff account in the same shape (never produced by the server) must not offer reactivation either.
  const odd = { role: "jobseeker", isActive: false, accountStatus: "pending_activation" };
  assert.deepEqual(getAvailableActions(odd), { deactivate: false, reactivate: false, delete: false, restore: false });
  // A deleted flag still wins.
  assert.equal(getAccountState({ ...pending, deletedAt: "2026-01-01" }), "deleted");
  // The ordinary states did not change.
  assert.equal(getAccountState({ isActive: false, accountStatus: "suspended" }), "suspended");
  assert.equal(getAccountState({ isActive: true }), "active");
});

test("pending and expired badges have their own shape, so they never rely on colour alone", () => {
  assert.equal(statusShape("pending"), "triangle");
  assert.equal(statusShape("expired"), "bar");
  assert.match(statusBadgeClass("pending"), /sb--pending/);
  assert.match(statusBadgeClass("expired"), /sb--expired/);
  const shapes = Object.values(STATUS_SHAPES);
  assert.equal(new Set(shapes).size, shapes.length, "every state has a different shape");
});

test("the badge colours meet 4.5:1 against their backgrounds", () => {
  const css = fs.readFileSync(new URL("../styles/status-badge.css", import.meta.url), "utf8");
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  for (const state of ["pending", "expired"]) {
    const rule = new RegExp(`\\.sb--${state}\\s*\\{\\s*color:\\s*(#[0-9a-f]{6});\\s*background:\\s*(#[0-9a-f]{6});`, "i").exec(css);
    assert.ok(rule, `${state} rule exists`);
    assert.ok(ratio(rule[1], rule[2]) >= 4.5, `${state} ${rule[1]} on ${rule[2]} is ${ratio(rule[1], rule[2]).toFixed(2)}:1`);
  }
});

test("the password rules the activation page lists are the ones passwordProblems reports", () => {
  assert.deepEqual(passwordProblems({ password: "" }).filter((p) => ACTIVATION_RULES.includes(p)).sort(), [...ACTIVATION_RULES].sort());
  assert.deepEqual(passwordProblems({ password: "Tr0ub4dor&Horse9" }).filter((p) => ACTIVATION_RULES.includes(p)), []);
  assert.deepEqual(passwordProblems({ password: "alllowercase1!" }).filter((p) => ACTIVATION_RULES.includes(p)), ["upper"]);
});
