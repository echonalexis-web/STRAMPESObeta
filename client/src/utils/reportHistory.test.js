import test from "node:test";
import assert from "node:assert/strict";
import { setupScope, periodText } from "./reportHistory.js";

const item = (overrides) => ({ dataset: "jobs", format: "pdf", municipality: null, period: { type: "30d", from: "2026-10-22", to: "2026-11-20" }, ...overrides });

test("a rolling preset is kept as a preset", () => {
  assert.deepEqual(setupScope(item()), { preset: "30d", from: "", to: "", municipality: "" });
  assert.deepEqual(setupScope(item({ period: { type: "90d", from: "2026-08-23", to: "2026-11-20" } })), { preset: "90d", from: "", to: "", municipality: "" });
});

test("a year, quarter, month or custom period becomes the same two days as a custom range", () => {
  for (const type of ["year", "quarter", "month", "custom"]) {
    assert.deepEqual(setupScope(item({ period: { type, from: "2026-01-01", to: "2026-03-31" } })), { preset: "custom", from: "2026-01-01", to: "2026-03-31", municipality: "" });
  }
});

test("the municipality is carried over", () => {
  assert.equal(setupScope(item({ municipality: "Gasan" })).municipality, "Gasan");
});

test("an old row with no period falls back to the default scope", () => {
  assert.deepEqual(setupScope(item({ period: { type: null, from: null, to: null } })), { preset: "30d", from: "", to: "", municipality: "" });
  assert.deepEqual(setupScope({ dataset: "hires", format: "csv", period: null }), { preset: "30d", from: "", to: "", municipality: "" });
});

test("the period column names a preset and shows its days; other periods show only the days", () => {
  const t = (key, values) => (key === "adminAnalytics.filter.last" ? `Last ${values.period}` : key === "adminAnalytics.filter.periods.30d" ? "30 days" : key);
  assert.equal(periodText(item(), t), "Last 30 days (2026-10-22 – 2026-11-20)");
  assert.equal(periodText(item({ period: { type: "quarter", from: "2026-07-01", to: "2026-09-30" } }), t), "2026-07-01 – 2026-09-30");
  assert.equal(periodText(null, t), "");
});
