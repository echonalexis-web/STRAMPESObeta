// Period bounds in Asia/Manila, age brackets, the small-cell rule, the filter object and the
// shared municipality helpers. Pure functions: no database.

const { periodBounds, parsePeriodQuery, startOfManilaDay, formatManilaStamp, manilaQuarter } = require("../services/analytics/period");
const { AGE_BRACKETS, ageBracketOf, dobRangeForBracket, ageBracketExpression, suppressSmallCells } = require("../services/analytics/privacy");
const { parseAnalyticsFilter, canonicalJson, filterHash, summarizeFilter } = require("../services/analytics/filters");
const { MUNICIPALITY_LABELS, normalizeMunicipalityLabel, getMunicipalityFilterPattern, normalizeApplicantMunicipality } = require("../services/analytics/municipality");
const { PERFORMANCE, SMALL_CELL_THRESHOLD } = require("../services/analytics/config");

const iso = (date) => date.toISOString();

describe("config", () => {
  test("the ranking minimums and the small-cell threshold are the approved values", () => {
    expect(PERFORMANCE.minPostings).toBe(1);
    expect(PERFORMANCE.minApplicants).toBe(3);
    expect(SMALL_CELL_THRESHOLD).toBe(5);
  });
});

describe("period bounds in Asia/Manila", () => {
  const NOW = new Date("2026-11-20T06:00:00Z"); // 14:00 Manila

  test("Manila midnight is 16:00 UTC the day before", () => {
    expect(iso(startOfManilaDay(2026, 1, 1))).toBe("2025-12-31T16:00:00.000Z");
  });

  test("year: starts at Manila midnight on 1 January and is exclusive at the next one", () => {
    const p = periodBounds({ type: "year", year: 2025 }, NOW);
    expect(iso(p.from)).toBe("2024-12-31T16:00:00.000Z");
    expect(iso(p.to)).toBe("2025-12-31T16:00:00.000Z");
    expect(p.isPartial).toBe(false);
    expect(p.label).toBe("2025");
  });

  test("a record at 23:30 Manila on 31 December belongs to the old year even though it is already January in UTC", () => {
    const record = new Date("2025-12-31T15:30:00Z"); // 23:30 Manila 31 Dec 2025
    const y2025 = periodBounds({ type: "year", year: 2025 }, NOW);
    const y2026 = periodBounds({ type: "year", year: 2026 }, NOW);
    expect(record >= y2025.from && record < y2025.to).toBe(true);
    expect(record >= y2026.from && record < y2026.to).toBe(false);
    // 00:30 Manila on 1 January belongs to the new year.
    const next = new Date("2025-12-31T16:30:00Z");
    expect(next >= y2026.from && next < y2026.to).toBe(true);
  });

  test("quarters cover three months each and chain without a gap", () => {
    const quarters = [1, 2, 3, 4].map((quarter) => periodBounds({ type: "quarter", year: 2025, quarter }, NOW));
    expect(iso(quarters[0].from)).toBe("2024-12-31T16:00:00.000Z");
    for (let i = 0; i < 3; i += 1) expect(quarters[i].to.getTime()).toBe(quarters[i + 1].from.getTime());
    expect(iso(quarters[3].to)).toBe("2025-12-31T16:00:00.000Z");
    expect(quarters[1].label).toBe("2025 Q2 (Apr to Jun)");
  });

  test("the previous period: quarter 1 goes back to quarter 4 of last year; a year to last year", () => {
    const q1 = periodBounds({ type: "quarter", year: 2026, quarter: 1 }, NOW);
    const q4 = periodBounds({ type: "quarter", year: 2025, quarter: 4 }, NOW);
    expect(q1.previous.from.getTime()).toBe(q4.from.getTime());
    expect(q1.previous.to.getTime()).toBe(q4.to.getTime());
    const y = periodBounds({ type: "year", year: 2026 }, NOW);
    expect(y.previous.label).toBe("2025");
  });

  test("a period still in progress is partial, with asOf, and compares to the same elapsed stretch of the previous one", () => {
    const q4 = periodBounds({ type: "quarter", year: 2026, quarter: 4 }, NOW);
    expect(q4.isPartial).toBe(true);
    expect(q4.asOf.getTime()).toBe(NOW.getTime());
    const elapsed = NOW.getTime() - q4.from.getTime();
    expect(q4.previousSameElapsedTo.getTime()).toBe(q4.previous.from.getTime() + elapsed);
    const done = periodBounds({ type: "quarter", year: 2026, quarter: 1 }, NOW);
    expect(done.isPartial).toBe(false);
    expect(done.previousSameElapsedTo).toBeNull();
  });

  test("a future period is flagged and is not partial", () => {
    const early = new Date("2026-02-10T06:00:00Z");
    const later = periodBounds({ type: "quarter", year: 2026, quarter: 4 }, early);
    expect(later.isFuture).toBe(true);
    expect(later.isPartial).toBe(false);
    // a whole year after this one is refused outright
    expect(() => periodBounds({ type: "year", year: 2027 }, NOW)).toThrow(expect.objectContaining({ code: "INVALID_PERIOD" }));
  });

  test("custom range includes both days; the previous one is the same length just before", () => {
    const p = periodBounds({ type: "custom", from: "2026-03-01", to: "2026-03-31" }, NOW);
    expect(iso(p.from)).toBe("2026-02-28T16:00:00.000Z");
    expect(iso(p.to)).toBe("2026-03-31T16:00:00.000Z");
    expect(p.previous.to.getTime()).toBe(p.from.getTime());
    expect(p.to.getTime() - p.from.getTime()).toBe(p.from.getTime() - p.previous.from.getTime());
  });

  test("invalid input is rejected with INVALID_PERIOD", () => {
    const bad = [
      { type: "decade" },
      { type: "quarter", year: 2026, quarter: 5 },
      { type: "quarter", year: 2026 },
      { type: "month", year: 2026, month: 0 },
      { type: "year", year: 1999 },
      { type: "year", year: 2100 },
      { type: "year", year: "20x6" },
      { type: "custom", from: "2026-02-30", to: "2026-03-01" },
      { type: "custom", from: "2026-04-01", to: "2026-03-01" },
      { type: "custom", from: "2015-01-01", to: "2026-01-01" },
      { type: "year", year: { $gt: 1 } },
    ];
    for (const input of bad) {
      expect(() => periodBounds(input, NOW)).toThrow(expect.objectContaining({ code: "INVALID_PERIOD", status: 400 }));
    }
  });

  test("defaults to the current Manila year, and reads a query string", () => {
    expect(periodBounds({}, NOW).year).toBe(2026);
    // 17:00 UTC on 31 Dec is already 1 Jan in Manila
    expect(periodBounds({}, new Date("2026-12-31T17:00:00Z")).year).toBe(2027);
    const p = parsePeriodQuery({ period: "quarter", year: "2026", quarter: "2" }, NOW);
    expect(p.quarter).toBe(2);
    expect(parsePeriodQuery({ period: ["month"], year: "2026", month: "5" }, NOW).month).toBe(5);
  });

  test("report timestamps print in Manila time", () => {
    expect(formatManilaStamp(new Date("2026-11-20T06:05:00Z"))).toBe("2026-11-20 14:05 (Asia/Manila)");
    expect(manilaQuarter(new Date("2025-12-31T15:30:00Z"))).toBe(4);
    expect(manilaQuarter(new Date("2025-12-31T16:30:00Z"))).toBe(1);
  });
});

describe("age brackets", () => {
  const NOW = new Date("2026-06-15T04:00:00Z"); // 12:00 Manila, 15 June 2026
  const dob = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

  test("bracket boundaries use whole years, and the birthday itself counts", () => {
    expect(ageBracketOf(dob(2011, 6, 15), NOW)).toBe("15-17"); // turns 15 today
    expect(ageBracketOf(dob(2011, 6, 16), NOW)).toBe("unknown"); // 14 until tomorrow
    expect(ageBracketOf(dob(2008, 6, 15), NOW)).toBe("18-24"); // turns 18 today
    expect(ageBracketOf(dob(2008, 6, 16), NOW)).toBe("15-17");
    expect(ageBracketOf(dob(2001, 6, 15), NOW)).toBe("25-30");
    expect(ageBracketOf(dob(1995, 6, 15), NOW)).toBe("31+");
    expect(ageBracketOf(null, NOW)).toBe("unknown");
    expect(AGE_BRACKETS).toEqual(["15-17", "18-24", "25-30", "31+"]);
  });

  test("the database range and the aggregation expression agree with the in-memory bracket", () => {
    const samples = [dob(2011, 6, 15), dob(2011, 6, 16), dob(2008, 6, 16), dob(2008, 6, 15), dob(2001, 6, 16), dob(2001, 6, 15), dob(1995, 6, 16), dob(1995, 6, 15), dob(1980, 1, 1)];
    for (const sample of samples) {
      const bracket = ageBracketOf(sample, NOW);
      if (bracket === "unknown") continue;
      const range = dobRangeForBracket(bracket, NOW);
      const inRange = (range.$gt === undefined || sample > range.$gt) && (range.$lte === undefined || sample <= range.$lte);
      expect(inRange).toBe(true);
      for (const other of AGE_BRACKETS.filter((b) => b !== bracket)) {
        const r = dobRangeForBracket(other, NOW);
        const also = (r.$gt === undefined || sample > r.$gt) && (r.$lte === undefined || sample <= r.$lte);
        expect(also).toBe(false);
      }
    }
  });

  test("the aggregation expression never returns a date and needs no $dateDiff", () => {
    const expr = ageBracketExpression("$dateOfBirth", NOW);
    const text = JSON.stringify(expr);
    expect(text).not.toContain("$dateDiff");
    expect(expr.$switch.default).toBe("31+");
    expect(expr.$switch.branches.map((b) => b.then)).toEqual(["unknown", "unknown", "15-17", "18-24", "25-30"]);
  });
});

describe("small-cell suppression", () => {
  const cells = (...values) => values.map((value, i) => ({ key: `c${i}`, value }));

  test("a cell of 1 to 4 is hidden; zero and 5 or more stay visible", () => {
    const out = suppressSmallCells(cells(0, 1, 4, 5, 20), { total: null });
    expect(out.cells.map((c) => c.suppressed)).toEqual([false, true, true, false, false]);
    expect(out.cells[1].value).toBeNull();
    expect(out.cells[4].value).toBe(20);
  });

  test("with a total shown, one hidden cell is never left alone: the smallest visible cell is hidden too", () => {
    const out = suppressSmallCells(cells(3, 9, 12, 40), { total: 64 });
    expect(out.cells.filter((c) => c.suppressed)).toHaveLength(2);
    expect(out.cells[1].suppressed).toBe(true); // 9 is the smallest visible
    expect(out.total).toBe(64);
    expect(out.totalHidden).toBe(false);
  });

  test("with nothing safe to pair it with, the total is hidden instead", () => {
    const out = suppressSmallCells(cells(3, 0, 0), { total: 3 });
    expect(out.cells[0].suppressed).toBe(true);
    expect(out.total).toBeNull();
    expect(out.totalHidden).toBe(true);
  });

  test("property: with a total shown, the hidden values can never be derived by subtraction", () => {
    for (let a = 0; a <= 9; a += 1) {
      for (let b = 0; b <= 9; b += 1) {
        for (let c = 0; c <= 12; c += 1) {
          const input = cells(a, b, c);
          const total = a + b + c;
          const out = suppressSmallCells(input, { total });
          const hidden = out.cells.filter((cell) => cell.suppressed).length;
          if (out.total !== null) expect(hidden).not.toBe(1);
          for (const cell of out.cells) {
            if (cell.suppressed) expect(cell.value).toBeNull();
          }
          // no value under the threshold ever leaves, except a true zero
          for (const cell of out.cells) {
            if (!cell.suppressed) expect(cell.value === 0 || cell.value >= SMALL_CELL_THRESHOLD).toBe(true);
          }
        }
      }
    }
  });
});

describe("filter object", () => {
  const NOW = new Date("2026-11-20T06:00:00Z");
  const parse = (query, section = "jobs", options = {}) => parseAnalyticsFilter(query, { section, now: NOW, ...options });

  test("a valid jobs filter is canonical and defaults to scope all, regular dataset", () => {
    const { filter, period } = parse({ period: "quarter", year: "2026", quarter: "3", municipality: "Gasan", jobStatus: "active" });
    expect(filter).toEqual({
      section: "jobs",
      municipality: "Gasan",
      jobStatus: "active",
      scope: "all",
      dataset: "regular",
      period: { type: "quarter", year: 2026, quarter: 3 },
    });
    expect(period.label).toBe("2026 Q3 (Jul to Sep)");
  });

  test("filters from another section are dropped, not errors", () => {
    const { filter } = parse({ verification: "verified", ageBracket: "18-24", jobStatus: "active" }, "jobs");
    expect(filter.verification).toBeUndefined();
    expect(filter.ageBracket).toBeUndefined();
    expect(filter.jobStatus).toBe("active");
    const applicants = parse({ ageBracket: "18-24", jobStatus: "active", municipality: "Boac (Capital)" }, "applicants").filter;
    expect(applicants.ageBracket).toBe("18-24");
    expect(applicants.jobStatus).toBeUndefined();
  });

  test("unknown values, operators and objects are rejected", () => {
    const bad = [
      { municipality: "Atlantis" },
      { jobStatus: "pending" },
      { municipality: { $ne: "x" } },
      { jobStatus: ["active", { $ne: 1 }] },
      { employerId: "not-an-id" },
      { industry: "<script>" },
      { dataset: "all" },
    ];
    for (const query of bad) {
      expect(() => parse(query)).toThrow(expect.objectContaining({ code: expect.stringMatching(/INVALID_FILTER/), status: 400 }));
    }
    expect(() => parse({}, "everything")).toThrow(expect.objectContaining({ code: "INVALID_FILTER" }));
  });

  test("the catalog restricts industry, job type and work nature when it is given", () => {
    const catalog = { industries: new Set(["Retail"]), jobTypes: new Set(["Full-time"]), workNatures: new Set() };
    expect(parse({ industry: "Retail" }, "jobs", { catalog }).filter.industry).toBe("Retail");
    expect(() => parse({ industry: "Mining" }, "jobs", { catalog })).toThrow(expect.objectContaining({ code: "INVALID_FILTER" }));
  });

  test("verification accepts one status or a list, in a fixed order, and rejects unknown names", () => {
    expect(parse({ verification: "under_review,pending" }, "employers").filter.verification).toEqual(["pending", "under_review"]);
    expect(() => parse({ verification: "pending,bogus" }, "employers")).toThrow(expect.objectContaining({ code: "INVALID_FILTER" }));
  });

  test("SPES has no employer: employer, industry and job type are removed", () => {
    const id = "a".repeat(24);
    const { filter } = parse({ dataset: "spes", employerId: id, industry: "Retail", jobType: "Full-time" });
    expect(filter.dataset).toBe("spes");
    expect(filter.employerId).toBeUndefined();
    expect(filter.industry).toBeUndefined();
    expect(parse({ employerId: id }).filter.employerId).toBe(id);
  });

  test("a barangay only counts inside a municipality", () => {
    expect(parse({ barangay: "Poblacion" }).filter.barangay).toBeUndefined();
    expect(parse({ municipality: "Gasan", barangay: "Poblacion" }).filter.barangay).toBe("Poblacion");
  });

  test("the canonical text and hash do not depend on key order", () => {
    const a = parse({ municipality: "Gasan", jobStatus: "active" }).filter;
    const b = { jobStatus: "active", dataset: "regular", scope: "all", section: "jobs", period: a.period, municipality: "Gasan" };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(filterHash(a)).toBe(filterHash(b));
    expect(filterHash(a)).not.toBe(filterHash({ ...a, municipality: "Mogpog" }));
  });

  test("the summary names the period and says what scope all means", () => {
    const { filter, period } = parse({ municipality: "Gasan" });
    const rows = summarizeFilter(filter, period);
    expect(rows[0]).toEqual({ label: "Period", value: period.label });
    expect(rows.find((r) => r.label === "Scope").value).toMatch(/hidden from the public/);
  });
});

describe("municipality helpers (moved from adminController, unchanged)", () => {
  test("labels and matching rules", () => {
    expect(MUNICIPALITY_LABELS).toHaveLength(7);
    expect(normalizeMunicipalityLabel("brgy x, Santa Cruz, Marinduque")).toBe("Santa Cruz");
    expect(normalizeMunicipalityLabel("Manila")).toBe("Other / Outside Province");
    expect(normalizeMunicipalityLabel("")).toBe("Other / Outside Province");
    expect(getMunicipalityFilterPattern("Boac")).toBe("boac|capital");
    expect(normalizeApplicantMunicipality("Gasan", "Marinduque")).toBe("Gasan");
    expect(normalizeApplicantMunicipality("Gasan", "Cebu")).toBe("Other");
  });

  test("adminController still exposes the same helpers", () => {
    const controller = require("../controllers/adminController");
    expect(controller.normalizeMunicipalityLabel).toBe(normalizeMunicipalityLabel);
    expect(typeof controller.escapeRegExp).toBe("function");
  });
});

describe("manilaDayBounds (audit trail date filters)", () => {
  const { manilaDayBounds } = require("../services/analytics/period");

  test("a day runs from Manila midnight to the last millisecond of that Manila day", () => {
    const day = manilaDayBounds("2026-03-31");
    expect(day.start.toISOString()).toBe("2026-03-30T16:00:00.000Z");
    expect(day.end.toISOString()).toBe("2026-03-31T15:59:59.999Z");
  });

  test("anything that is not a real date is ignored, as the old parsing ignored it", () => {
    for (const bad of ["nope", "", undefined, null, "2026-02-30", "2026-13-01", "26-1-1", { $gt: 1 }]) {
      expect(manilaDayBounds(bad)).toBeNull();
    }
  });
});
