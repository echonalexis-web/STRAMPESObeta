// Locale parity for the new age-gate / error-code / SPES namespaces, and that
// every code the server can send has a translated message in both languages.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ADMIN_TRANSITIONS, ALL_SPES_SLOTS, RESULT_OUTCOMES, SPES_STAGE_KEYS } from "./spesSlots.js";
import { AGE_TIERS } from "./age.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../i18n/locales");
const load = (name) => JSON.parse(readFileSync(path.join(dir, name), "utf8").replace(/^﻿/, ""));
const en = load("en.json");
const fil = load("fil.json");

const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
const get = (o, key) => key.split(".").reduce((a, k) => (a == null ? a : a[k]), o);

for (const ns of ["ageGate", "errors", "spes", "spesPostings"]) {
  test(`en and fil have the same keys under ${ns}`, () => {
    const a = new Set(flat(en[ns]));
    const b = new Set(flat(fil[ns]));
    assert.deepEqual([...a].filter((k) => !b.has(k)), []);
    assert.deepEqual([...b].filter((k) => !a.has(k)), []);
  });

  test(`no empty strings under ${ns}`, () => {
    for (const locale of [en, fil]) {
      for (const key of flat(locale[ns])) assert.notEqual(String(get(locale[ns], key)).trim(), "", key);
    }
  });
}

test("every server error code used by the apply, review and age flows is translated", () => {
  const codes = [
    "DOB_REQUIRED", "DOB_INVALID", "DOB_LOCKED", "AGE_UNDER_MINIMUM", "GOOGLE_PENDING_EXPIRED",
    "EMPLOYER_ADULT_ATTESTATION_REQUIRED", "JOB_APPLY_AGE_RESTRICTED", "MESSAGING_AGE_RESTRICTED",
    "NSRP_INCOMPLETE", "SPES_AGE_BELOW_MIN", "SPES_AGE_ABOVE_MAX", "SPES_NOT_OPEN", "SPES_DEADLINE_PASSED",
    "SPES_ALREADY_APPLIED", "SPES_STUDENT_FIELDS_REQUIRED", "SPES_GWA_INVALID", "SPES_CONTACT_INVALID",
    "SPES_GUARDIAN_REQUIRED", "SPES_DOCS_MISSING", "SPES_FILE_TYPE", "SPES_FILE_TOO_LARGE", "SPES_DOCS_LOCKED",
    "SPES_TRANSITION_NOT_ALLOWED", "SPES_REASON_REQUIRED", "SPES_DOCS_NOT_VERIFIED", "SPES_NO_DOCS_REJECTED",
    "SPES_ALREADY_RELEASED", "SPES_NOT_RELEASED", "SPES_SCORE_INVALID", "SPES_NOT_QUALIFIED", "SPES_SCORES_REQUIRED",
    "SPES_RANK_INVALID", "SPES_UNDECIDED_REMAIN", "SPES_WITHDRAW_NOT_ALLOWED", "GENERIC",
  ];
  for (const locale of [en, fil]) for (const code of codes) assert.ok(get(locale, `errors.codes.${code}`), code);
});

test("every lifecycle status, stage, outcome, slot and age tier has a label in both languages", () => {
  const statuses = new Set(["submitted", "documents_review", "needs_resubmission", "qualified", "evaluated", "result_recorded", "results_released", "withdrawn", "disqualified"]);
  Object.values(ADMIN_TRANSITIONS).flat().forEach((s) => statuses.add(s));
  for (const locale of [en, fil]) {
    for (const s of statuses) assert.ok(get(locale, `spes.status.${s}`), `status ${s}`);
    for (const s of SPES_STAGE_KEYS) assert.ok(get(locale, `spes.stage.${s}`), `stage ${s}`);
    for (const o of RESULT_OUTCOMES) assert.ok(get(locale, `spes.outcome.${o}`), `outcome ${o}`);
    for (const s of ALL_SPES_SLOTS) assert.ok(get(locale, `spes.docs.slot.${s}`), `slot ${s}`);
    for (const state of ["missing", "pending", "verified", "needs_replacement"]) assert.ok(get(locale, `spes.docs.state.${state}`), `state ${state}`);
    for (const tier of Object.values(AGE_TIERS).filter((t) => t !== AGE_TIERS.UNDER_15)) {
      assert.ok(get(locale, `spes.admin.tier.${tier}`), `tier ${tier}`);
    }
    for (const s of [...statuses, "default"]) assert.ok(get(locale, `spes.nextStep.${s}`), `nextStep ${s}`);
  }
});

test("posting display statuses, tabs and the new nav labels exist in both languages", () => {
  for (const locale of [en, fil]) {
    for (const status of ["draft", "open", "closed", "results_released", "archived"]) {
      assert.ok(get(locale, `spesPostings.status.${status}`), `status ${status}`);
    }
    for (const tab of ["open", "closed", "all"]) assert.ok(get(locale, `spesPostings.tab.${tab}`), `tab ${tab}`);
    for (const key of ["mySpesGroup", "spesGroup", "spesPostings", "mySpesApplications", "spesMonitoring"]) {
      assert.ok(get(locale, `navbar.${key}`), `navbar ${key}`);
    }
    for (const reason of ["deadline", "manual", "inactive", "notYetOpen", "resultsReleased"]) {
      assert.ok(get(locale, `spes.admin.closedReason.${reason}`), `closedReason ${reason}`);
    }
  }
});

test("every posting error code the server can send is translated", () => {
  const codes = ["SPES_TITLE_REQUIRED", "SPES_DATE_INVALID", "SPES_PERIOD_INVALID", "SPES_SLOTS_INVALID", "SPES_SLOT_TYPES_INVALID", "SPES_DEADLINE_IN_PAST", "SPES_POSTING_LEGACY", "SPES_STATUS_INVALID", "SPES_HAS_APPLICATIONS", "SPES_DELETE_NOT_ALLOWED"];
  for (const locale of [en, fil]) for (const code of codes) assert.ok(get(locale, `errors.codes.${code}`), code);
});
