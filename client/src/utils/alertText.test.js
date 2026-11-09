import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { localizedAlert, ALERT_KEYS } from "./alertText.js";

const t = (key, opts = {}) => (key.startsWith("alerts.") ? `[${key}]` : opts.defaultValue ?? key);

test("a known alertKey is translated", () => {
  const out = localizedAlert({ title: "English", message: "English body", metadata: { alertKey: "accountLocked" } }, t);
  assert.deepEqual(out, { title: "[alerts.accountLockedTitle]", message: "[alerts.accountLockedBody]" });
});

test("anything else is returned untouched", () => {
  const item = { title: "New message", message: "Hi", metadata: { alertKey: "somethingElse" } };
  assert.deepEqual(localizedAlert(item, t), { title: "New message", message: "Hi" });
  assert.deepEqual(localizedAlert({ title: "A", message: "B" }, t), { title: "A", message: "B" });
  assert.deepEqual(localizedAlert(null, t), { title: undefined, message: undefined });
  assert.deepEqual(localizedAlert({ title: "A", message: "B", metadata: { alertKey: "newSignIn" } }, undefined), { title: "A", message: "B" });
});

test("every alert key the server can send has a title and body in both languages", () => {
  const read = (lang) => {
    const text = fs.readFileSync(new URL(`../i18n/locales/${lang}.json`, import.meta.url), "utf8");
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).alerts;
  };
  for (const lang of ["en", "fil"]) {
    const alerts = read(lang);
    for (const key of ALERT_KEYS) {
      assert.ok(alerts[`${key}Title`], `${lang} alerts.${key}Title`);
      assert.ok(alerts[`${key}Body`], `${lang} alerts.${key}Body`);
    }
  }
});

test("alert keys match what the server's accountAlertService defines", () => {
  const source = fs.readFileSync(new URL("../../../server/services/accountAlertService.js", import.meta.url), "utf8");
  for (const key of ALERT_KEYS) assert.ok(new RegExp(`\\b${key}:\\s*\\{`).test(source), `server is missing alert ${key}`);
});
