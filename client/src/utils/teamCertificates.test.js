import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCertificateRows,
  expiryInfo,
  formatCertDate,
  parseCertDate,
  sortCertificates,
  stripIssuerPrefix,
} from "./teamCertificates.js";

test("a year-only date sorts as the end of that year", () => {
  const sorted = sortCertificates([
    { name: "a", year: "2025" },
    { name: "b", year: "June 1, 2025" },
    { name: "c", year: "2026" },
    { name: "d", year: "not a date" },
  ]);
  assert.deepEqual(sorted.map((c) => c.name), ["c", "a", "b", "d"]);
});

test("month and day show only when the date has them", () => {
  assert.equal(formatCertDate("2025"), "2025");
  assert.equal(formatCertDate("May 2024"), "May 2024");
  assert.equal(formatCertDate("May 19, 2024"), "May 19, 2024");
  assert.equal(parseCertDate("Smarch 2024"), null);
});

test("issuer prefix is stripped only when it leads the title", () => {
  assert.equal(stripIssuerPrefix("CISCO Network Defense", "CISCO"), "Network Defense");
  assert.equal(stripIssuerPrefix("Intro to CISCO gear", "CISCO"), "Intro to CISCO gear");
  assert.equal(stripIssuerPrefix("CISCO", "CISCO"), "CISCO");
});

test("3+ certificates from one issuer fold into a group; fewer stay single", () => {
  const rows = buildCertificateRows([
    { name: "CISCO One", issuer: "CISCO", year: "2025" },
    { name: "Solo", issuer: "Other", year: "2026" },
    { name: "CISCO Two", issuer: "CISCO", year: "2024" },
    { name: "CISCO Three", issuer: "CISCO", year: "2025" },
    { name: "Pair A", issuer: "Pair", year: "2023" },
    { name: "Pair B", issuer: "Pair", year: "2023" },
  ]);
  assert.deepEqual(rows.map((r) => r.type), ["single", "group", "single", "single"]);
  const group = rows[1];
  assert.equal(group.issuer, "CISCO");
  assert.equal(group.range, "2024–2025");
  assert.deepEqual(group.items.map((c) => c.name), ["One", "Three", "Two"]);
});

test("expiry labels: none, future, past", () => {
  const now = new Date(2026, 5, 1).getTime();
  assert.equal(expiryInfo(null, now), null);
  assert.deepEqual(expiryInfo("March 2030", now), { kind: "expires", text: "Mar 2030" });
  assert.deepEqual(expiryInfo("2026", now), { kind: "expires", text: "2026" });
  assert.deepEqual(expiryInfo("May 31, 2026", now), { kind: "expired" });
});
