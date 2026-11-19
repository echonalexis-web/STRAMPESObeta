// The report indexes are listed in one config file and created only by a script, never
// declared on a schema (Mongoose would build them automatically on a production start-up).

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { REPORT_INDEXES } = require("../config/reportIndexes");
const JobApplication = require("../models/JobApplication");

describe("report indexes", () => {
  test("names are unique and prefixed, and every spec has a collection and a key", () => {
    const names = REPORT_INDEXES.map((spec) => spec.options.name);
    expect(new Set(names).size).toBe(names.length);
    for (const spec of REPORT_INDEXES) {
      expect(spec.options.name).toMatch(/^report_/);
      expect(spec.collection).toMatch(/^[a-z]+$/);
      expect(Object.keys(spec.key).length).toBeGreaterThan(0);
    }
    expect(REPORT_INDEXES.find((spec) => spec.options.name === "report_reportId_unique").options.unique).toBe(true);
  });

  test("no model declares them with schema.index (autoIndex would build them in production)", () => {
    const modelsDir = path.join(__dirname, "../models");
    for (const file of fs.readdirSync(modelsDir).filter((name) => name.endsWith(".js"))) {
      const text = fs.readFileSync(path.join(modelsDir, file), "utf8");
      expect(text).not.toMatch(/report_/);
    }
    const declared = JobApplication.schema.indexes().map(([fields]) => JSON.stringify(fields));
    expect(declared).not.toContain(JSON.stringify({ createdAt: 1 }));
    expect(declared).not.toContain(JSON.stringify({ status: 1, hiredAt: 1 }));
  });

  test("the scripts at least parse (they are never run here)", () => {
    for (const script of ["createReportIndexes.js", "backfillApplicationDates.js"]) {
      expect(() => execFileSync(process.execPath, ["--check", path.join(__dirname, "../scripts", script)])).not.toThrow();
    }
  });

  test("the application model has the new date fields, defaulting to empty", () => {
    const doc = new JobApplication({ applicant: "a".repeat(24), vacancy: "b".repeat(24) });
    expect(doc.hiredAt).toBeNull();
    expect(doc.firstResponseAt).toBeNull();
    expect(doc.hiredAtApproximate).toBe(false);
  });
});
