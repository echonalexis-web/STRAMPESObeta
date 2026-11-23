// Report generator core: catalog and permissions, validation, the "prepared by" facts, CSV
// output, audit-first behaviour, history, caps, the in-flight guard, regeneration and privacy.
// Models are mocked; what is checked is what the generator asks for and what it returns.

jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../models/User", () => ({ findById: jest.fn(), find: jest.fn(), aggregate: jest.fn() }));
jest.mock("../models/JobVacancy", () => ({ aggregate: jest.fn(), find: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ aggregate: jest.fn(), find: jest.fn() }));
jest.mock("../models/SpesPosting", () => ({ aggregate: jest.fn() }));
jest.mock("../models/SpesApplication", () => ({ aggregate: jest.fn() }));
jest.mock("../models/AuditLog", () => ({ create: jest.fn(), aggregate: jest.fn() }));
jest.mock("../models/ReportExport", () => ({ create: jest.fn(), find: jest.fn(), findOne: jest.fn(), countDocuments: jest.fn() }));
jest.mock("../models/SystemOption", () => ({
  find: jest.fn(() => ({ sort: () => ({ select: () => ({ lean: async () => [{ category: "industry", value: "Retail" }] }) }) })),
}));
jest.mock("../utils/jobVisibility", () => ({
  withListedEmployers: jest.fn(async (filter) => filter),
  getUnlistedEmployerIds: jest.fn(async () => []),
  UNLISTED_ACCOUNT_STATUSES: ["suspended", "banned", "deactivated"],
}));

jest.mock("../services/analytics/overviewStats", () => ({ scopeCounts: jest.fn(async () => ({ vacancies: 5, applications: 12, enough: true })) }));

const crypto = require("crypto");
const User = require("../models/User");
const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const AuditLog = require("../models/AuditLog");
const ReportExport = require("../models/ReportExport");
const service = require("../services/reports/reportService");
const controller = require("../controllers/reportExportController");
const { catalogForRole } = require("../services/reports/catalog");

const NOW = new Date("2026-11-20T06:05:00Z"); // 14:05 in Manila
const ADMIN = { _id: "64b7f0f0f0f0f0f0f0f0f001", role: "admin", name: "Token Name" };
const OTHER_ADMIN = { _id: "64b7f0f0f0f0f0f0f0f0f002", role: "admin" };
const SUPER = { _id: "64b7f0f0f0f0f0f0f0f0f003", role: "superadmin" };

const answer = (Model, { count = 0, rows = [] }) => {
  Model.aggregate.mockImplementation((pipeline) => {
    const last = pipeline[pipeline.length - 1];
    return { option: () => Promise.resolve(last && last.$count ? (count ? [{ n: count }] : []) : rows) };
  });
};

const job = (overrides = {}) => ({
  title: "Cashier",
  slots: 2,
  jobType: "Full-time",
  workNature: "onsite",
  industry: ["Retail", "Food"],
  createdAt: new Date("2026-10-05T01:00:00Z"),
  closedAt: null,
  closeReason: null,
  municipalityBucket: "Gasan",
  statusBucket: "active",
  emp: { companyName: "Acme Corp", name: "Owner", deletedAt: null },
  counts: { applicants: 3, hires: 1 },
  ...overrides,
});

const body = (overrides = {}) => ({ dataset: "jobs", params: { period: "quarter", year: "2026", quarter: "4" }, format: "csv", ...overrides });

const preparer = (extra = {}) => ({ _id: ADMIN._id, name: "Maria Santos", role: "admin", staffNote: null, ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  service._inFlight.clear();
  User.findById.mockReturnValue({ select: () => ({ lean: async () => preparer() }) });
  User.find.mockReturnValue({ select: () => ({ lean: async () => [] }) });
  answer(JobVacancy, { count: 1, rows: [job()] });
  AuditLog.create.mockResolvedValue({});
  ReportExport.create.mockResolvedValue({});
});

const text = (result) => result.bytes.toString("utf8");

describe("catalog and permissions", () => {
  test("the audit summary is superadmin only", () => {
    expect(catalogForRole("admin").datasets.map((d) => d.id)).not.toContain("audit_summary");
    expect(catalogForRole("superadmin").datasets.map((d) => d.id)).toContain("audit_summary");
  });

  test("no catalog column is a contact detail, id, address, document or date of birth", () => {
    const keys = catalogForRole("superadmin").datasets.flatMap((d) => d.columns.map((c) => c.key.toLowerCase()));
    for (const banned of ["email", "phone", "contact", "dateofbirth", "dob", "address", "password", "token", "tin", "url", "ip", "useragent", "applicant", "name"]) {
      expect(keys).not.toContain(banned);
    }
  });

  test("an admin asking for the audit summary is 403 DATASET_FORBIDDEN", async () => {
    await expect(service.generateReport(ADMIN, body({ dataset: "audit_summary", purpose: "Quarterly review of activity" }), { now: NOW })).rejects.toMatchObject({ status: 403, code: "DATASET_FORBIDDEN" });
  });
});

describe("validation", () => {
  test("unknown dataset, column, grouping and format are refused", async () => {
    await expect(service.generateReport(ADMIN, body({ dataset: "users" }), { now: NOW })).rejects.toMatchObject({ code: "INVALID_FILTER" });
    await expect(service.generateReport(ADMIN, body({ columns: ["title", "email"] }), { now: NOW })).rejects.toMatchObject({ status: 400, code: "COLUMN_NOT_ALLOWED" });
    await expect(service.generateReport(ADMIN, body({ grouping: "ageBracket" }), { now: NOW })).rejects.toMatchObject({ code: "INVALID_FILTER" });
    await expect(service.generateReport(ADMIN, body({ format: "docx" }), { now: NOW })).rejects.toMatchObject({ code: "INVALID_FILTER" });
    expect(AuditLog.create).not.toHaveBeenCalled();
  });

  test("a purpose of 10 to 200 characters is required where the dataset needs one", async () => {
    answer(JobApplication, { count: 0, rows: [] });
    const hires = (purpose) => body({ dataset: "hires", purpose });
    await expect(service.generateReport(ADMIN, hires(undefined), { now: NOW })).rejects.toMatchObject({ code: "PURPOSE_REQUIRED" });
    await expect(service.generateReport(ADMIN, hires("too short"), { now: NOW })).rejects.toMatchObject({ code: "PURPOSE_REQUIRED" });
    await expect(service.generateReport(ADMIN, hires("x".repeat(201)), { now: NOW })).rejects.toMatchObject({ code: "PURPOSE_REQUIRED" });
    await expect(service.generateReport(ADMIN, hires("Quarterly placement report"), { now: NOW })).resolves.toBeDefined();
  });

  test("a period or filter outside the whitelist is refused", async () => {
    await expect(service.generateReport(ADMIN, body({ params: { period: "decade" } }), { now: NOW })).rejects.toMatchObject({ code: "INVALID_PERIOD" });
    await expect(service.generateReport(ADMIN, body({ params: { period: "year", year: "2026", industry: "Made up" } }), { now: NOW })).rejects.toMatchObject({ code: "INVALID_FILTER" });
  });

  test("the purpose has control characters removed", () => {
    expect(service.cleanPurpose("  Line one\nline\ttwo\u0000  ")).toBe("Line one line two");
  });
});

describe("prepared by, report ID and CSV", () => {
  test("name, role and office come from the database, never from the request or token", async () => {
    User.findById.mockReturnValue({ select: () => ({ lean: async () => preparer({ staffNote: "Maria Santos, PESO Manager" }) }) });
    const result = await service.generateReport(ADMIN, body({ preparedBy: "Evil", reportId: "RPT-FAKE", generatedAt: "1999-01-01" }), { now: NOW });
    const csv = text(result);
    expect(csv).toContain('"Prepared by","Maria Santos"');
    expect(csv).toContain('"Role","admin"');
    expect(csv).toContain('"Office or position","Maria Santos, PESO Manager"');
    expect(csv).not.toContain("Evil");
    expect(csv).not.toContain("Token Name");
    expect(result.reportId).toMatch(/^RPT-20261120-[A-Z2-7]{8}$/);
    expect(csv).toContain(`"Report ID","${result.reportId}"`);
    expect(csv).not.toContain("RPT-FAKE");
  });

  test("the office line is left out, never guessed, when none is recorded", async () => {
    const csv = text(await service.generateReport(ADMIN, body(), { now: NOW }));
    expect(csv).not.toContain("Office or position");
  });

  test("the timestamp is Manila time", async () => {
    const csv = text(await service.generateReport(ADMIN, body(), { now: NOW }));
    expect(csv).toContain('"Generated at","2026-11-20 14:05 (Asia/Manila)"');
  });

  test("BOM, metadata rows, blank row, header, then data; the record count equals the rows", async () => {
    answer(JobVacancy, { count: 2, rows: [job(), job({ title: "Baker" })] });
    const result = await service.generateReport(ADMIN, body(), { now: NOW });
    const csv = text(result);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n");
    const blank = lines.indexOf("");
    expect(blank).toBeGreaterThan(3);
    expect(lines[blank + 1]).toBe('"Title","Employer","Municipality","Industry","Job type","Work nature","Slots","Status","Posted date"');
    const dataRows = lines.slice(blank + 2).filter(Boolean);
    expect(dataRows).toHaveLength(2);
    expect(result.recordCount).toBe(2);
    expect(csv).toContain('"Record count","2"');
    expect(dataRows[0]).toContain('"Retail; Food"');
    expect(dataRows[0]).toContain('"2026-10-05"');
  });

  test("a cell starting with = + - @ is neutralized", async () => {
    answer(JobVacancy, { count: 1, rows: [job({ title: "=HYPERLINK(\"http://x\")" })] });
    expect(text(await service.generateReport(ADMIN, body(), { now: NOW }))).toContain(`"'=HYPERLINK(""http://x"")"`);
  });

  test("the filters and the period are printed", async () => {
    const csv = text(await service.generateReport(ADMIN, body({ params: { period: "quarter", year: "2026", quarter: "4", municipality: "Gasan" } }), { now: NOW }));
    expect(csv).toContain('"Period","2026 Q4 (Oct to Dec)"');
    expect(csv).toContain('"Municipality","Gasan"');
    expect(csv).toContain("Period in progress");
  });
});

describe("audit first, history and hash", () => {
  test("the audit entry is written before the history row, and the hash matches the bytes", async () => {
    const result = await service.generateReport(ADMIN, body(), { now: NOW });
    expect(AuditLog.create).toHaveBeenCalledTimes(1);
    expect(AuditLog.create.mock.invocationCallOrder[0]).toBeLessThan(ReportExport.create.mock.invocationCallOrder[0]);
    const audit = AuditLog.create.mock.calls[0][0];
    expect(audit).toMatchObject({ action: "report.generated", targetId: result.reportId, severity: "info", actorRole: "admin" });
    const history = ReportExport.create.mock.calls[0][0];
    expect(history).toMatchObject({ reportId: result.reportId, dataset: "jobs", format: "csv", recordCount: 1, grouping: "none", schemaVersion: 1 });
    expect(history.contentSha256).toBe(crypto.createHash("sha256").update(result.bytes).digest("hex"));
    expect(history.preparedBy).toMatchObject({ name: "Maria Santos", role: "admin" });
    expect(history.params.period).toEqual({ type: "quarter", year: 2026, quarter: 4 });
  });

  test("if the audit write fails nothing is returned and no history is written", async () => {
    AuditLog.create.mockRejectedValue(new Error("db down"));
    await expect(service.generateReport(ADMIN, body(), { now: NOW })).rejects.toThrow("db down");
    expect(ReportExport.create).not.toHaveBeenCalled();
    expect(service._inFlight.size).toBe(0);
  });

  test("an identity-adjacent dataset is audited as a warning and carries the purpose", async () => {
    answer(JobApplication, { count: 0, rows: [] });
    await service.generateReport(ADMIN, body({ dataset: "hires", purpose: "Quarterly placement report" }), { now: NOW });
    expect(AuditLog.create.mock.calls[0][0]).toMatchObject({ severity: "warning" });
    expect(AuditLog.create.mock.calls[0][0].metadata.purpose).toBe("Quarterly placement report");
  });
});

describe("not enough data", () => {
  const { scopeCounts } = require("../services/analytics/overviewStats");

  test("a scope with fewer than 1 vacancy or 3 applications is refused before anything is logged or exported", async () => {
    scopeCounts.mockResolvedValueOnce({ vacancies: 0, applications: 9, enough: false });
    await expect(service.generateReport(ADMIN, body(), { now: NOW })).rejects.toMatchObject({ status: 422, code: "NOT_ENOUGH_DATA" });
    expect(AuditLog.create).not.toHaveBeenCalled();
    expect(ReportExport.create).not.toHaveBeenCalled();
    expect(service._inFlight.size).toBe(0);
  });

  test("the preview says so instead of failing", async () => {
    scopeCounts.mockResolvedValueOnce({ vacancies: 3, applications: 2, enough: false });
    expect(await service.previewReport(ADMIN, body(), NOW)).toMatchObject({ notEnoughData: true, recordCount: null, wouldExceedLimit: false });
  });

  test("the check uses the period and the municipality of the filter bar", async () => {
    await service.generateReport(ADMIN, body({ params: { period: "30d", municipality: "Gasan" } }), { now: NOW });
    const [period, municipality] = scopeCounts.mock.calls.at(-1);
    expect(municipality).toBe("Gasan");
    expect(period.label).toBe("Last 30 days");
  });

  test("a dataset that does not read the municipality never prints one", async () => {
    const catalog = catalogForRole("admin").datasets;
    expect(catalog.find((d) => d.id === "jobs").municipality).toBe(true);
    expect(catalog.find((d) => d.id === "spes").municipality).toBe(false);
    expect(catalog.find((d) => d.id === "employer_ranking").municipality).toBe(false);
  });
});

describe("xlsx through the service", () => {
  test("is sent as a workbook named by the report ID, with the same record count and a matching hash", async () => {
    answer(JobVacancy, { count: 2, rows: [job(), job({ title: "Baker" })] });
    const result = await service.generateReport(ADMIN, body({ format: "xlsx" }), { now: NOW });
    expect(result.contentType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(result.filename).toBe(`${result.reportId}.xlsx`);
    expect(result.bytes.slice(0, 2).toString()).toBe("PK");
    expect(result.recordCount).toBe(2);
    const history = ReportExport.create.mock.calls[0][0];
    expect(history.format).toBe("xlsx");
    expect(history.contentSha256).toBe(crypto.createHash("sha256").update(result.bytes).digest("hex"));
  });

  test("the xlsx row cap is the same 50,000 and over it is refused", async () => {
    answer(JobVacancy, { count: 50001, rows: [] });
    await expect(service.generateReport(ADMIN, body({ format: "xlsx" }), { now: NOW })).rejects.toMatchObject({ status: 422, code: "EXPORT_TOO_LARGE" });
  });
});

describe("limits", () => {
  test("above the row cap the request is refused, not truncated", async () => {
    answer(JobVacancy, { count: 50001, rows: [] });
    await expect(service.generateReport(ADMIN, body(), { now: NOW })).rejects.toMatchObject({ status: 422, code: "EXPORT_TOO_LARGE" });
    expect(AuditLog.create).not.toHaveBeenCalled();
  });

  test("the preview says so instead of failing", async () => {
    answer(JobVacancy, { count: 50001, rows: [] });
    expect(await service.previewReport(ADMIN, body(), NOW)).toMatchObject({ wouldExceedLimit: true, recordCount: null });
  });

  test("the preview returns the count, 20 rows at most, the chosen columns and the prepared-by block", async () => {
    answer(JobVacancy, { count: 40, rows: Array.from({ length: 40 }, () => job()) });
    const preview = await service.previewReport(ADMIN, body({ columns: ["title", "status"] }), NOW);
    expect(preview.recordCount).toBe(40);
    expect(preview.sample).toHaveLength(20);
    expect(Object.keys(preview.sample[0])).toEqual(["title", "status"]);
    expect(preview.preparedBy).toEqual({ name: "Maria Santos", role: "admin" });
    expect(AuditLog.create).not.toHaveBeenCalled();
  });

  test("a second generation for the same account at the same time is 429 REPORT_IN_PROGRESS", async () => {
    let release;
    JobVacancy.aggregate.mockImplementation((pipeline) => ({
      option: () => new Promise((resolve) => { release = () => resolve(pipeline[pipeline.length - 1].$count ? [{ n: 1 }] : [job()]); }),
    }));
    const first = service.generateReport(ADMIN, body(), { now: NOW });
    await new Promise((resolve) => setImmediate(resolve));
    await expect(service.generateReport(ADMIN, body(), { now: NOW })).rejects.toMatchObject({ status: 429, code: "REPORT_IN_PROGRESS" });
    // another account is not blocked
    answer(JobVacancy, { count: 1, rows: [job()] });
    await expect(service.generateReport(OTHER_ADMIN, body(), { now: NOW })).resolves.toBeDefined();
    JobVacancy.aggregate.mockImplementation((pipeline) => ({ option: () => Promise.resolve(pipeline[pipeline.length - 1].$count ? [{ n: 1 }] : [job()]) }));
    release();
    await first.catch(() => {});
    expect(service._inFlight.size).toBe(0);
  });
});

describe("privacy", () => {
  const hire = (bracket) => ({ hireDate: new Date("2026-10-10T00:00:00Z"), jobTitle: "Cashier", employerId: "e1", municipalityBucket: "Gasan", ageBracket: bracket });
  const withEmployers = () => User.find.mockReturnValue({ select: () => ({ lean: async () => [{ _id: "e1", companyName: "Acme Corp", name: "Owner" }] }) });

  test("a hire row never shows a minor's bracket and carries no applicant fields", async () => {
    withEmployers();
    answer(JobApplication, { count: 2, rows: [hire("15-17"), hire("25-30")] });
    const preview = await service.previewReport(ADMIN, body({ dataset: "hires", purpose: "Quarterly placement report" }), NOW);
    expect(preview.sample.map((row) => row.ageBracket)).toEqual(["withheld (under 18)", "25-30"]);
    for (const row of preview.sample) expect(Object.keys(row).sort()).toEqual(["ageBracket", "employer", "hiredAt", "jobTitle", "municipality"]);
    expect(JSON.stringify(preview)).not.toMatch(/applicant|email|phone|dateOfBirth|_bracket|15-17/);
  });

  test("hires grouped by age bracket hide counts under 5", async () => {
    withEmployers();
    const rows = [...Array.from({ length: 3 }, () => hire("15-17")), ...Array.from({ length: 12 }, () => hire("18-24")), ...Array.from({ length: 9 }, () => hire("25-30"))];
    answer(JobApplication, { count: rows.length, rows });
    const result = await service.generateReport(ADMIN, body({ dataset: "hires", grouping: "ageBracket", purpose: "Quarterly placement report" }), { now: NOW });
    const csv = text(result);
    expect(csv).toContain('"15-17","under 5"');
    expect(csv).toContain('"18-24","12"');
    expect(csv).toContain("under 5");
    expect(csv).not.toContain('"15-17","3"');
  });

  test("an application row carries a short reference, never the applicant", async () => {
    withEmployers();
    answer(JobApplication, { count: 1, rows: [{ _id: "64b7f0f0f0f0f0f0f0abcdef", createdAt: new Date("2026-10-02T00:00:00Z"), statusUpdatedAt: new Date("2026-10-03T00:00:00Z"), status: "accepted", jobTitle: "Cashier", employerId: "e1", municipalityBucket: "Gasan", applicant: "SECRET-USER" }] });
    const result = await service.generateReport(ADMIN, body({ dataset: "applications", purpose: "Quarterly application review" }), { now: NOW });
    const csv = text(result);
    expect(csv).toContain('"F0ABCDEF"');
    expect(csv).toContain('"Source","regular"');
    expect(csv).toContain('"hired"');
    expect(csv).not.toContain("SECRET-USER");
  });

  test("a deleted employer is never named", async () => {
    answer(JobVacancy, { count: 1, rows: [job({ emp: { companyName: "Gone Inc", name: "Gone", deletedAt: new Date() } })] });
    const csv = text(await service.generateReport(ADMIN, body(), { now: NOW }));
    expect(csv).toContain("Former employer");
    expect(csv).not.toContain("Gone Inc");
  });
});

describe("history and regeneration", () => {
  const stored = (userId = ADMIN._id) => ({
    reportId: "RPT-20261001-AAAAAAAA",
    preparedBy: { userId, name: "Maria Santos", role: "admin" },
    dataset: "jobs",
    format: "csv",
    params: { section: "jobs", scope: "all", dataset: "regular", period: { type: "quarter", year: 2026, quarter: 3 }, municipality: "Gasan" },
    columns: ["title", "status"],
    grouping: "none",
    purpose: "",
    recordCount: 4,
    contentSha256: "abc",
    createdAt: new Date("2026-10-01T00:00:00Z"),
  });

  test("regenerating makes a NEW report from the stored parameters and says where it came from", async () => {
    ReportExport.findOne.mockReturnValue({ lean: async () => stored() });
    const result = await service.regenerateReport(ADMIN, "RPT-20261001-AAAAAAAA", { now: NOW });
    expect(result.reportId).not.toBe("RPT-20261001-AAAAAAAA");
    const csv = text(result);
    expect(csv).toContain("Regenerated from RPT-20261001-AAAAAAAA");
    expect(csv).toContain('"Period","2026 Q3 (Jul to Sep)"');
    expect(csv).toContain('"Municipality","Gasan"');
    expect(ReportExport.create.mock.calls[0][0]).toMatchObject({ regeneratedFrom: "RPT-20261001-AAAAAAAA", columns: ["title", "status"] });
  });

  test("another admin's report is not found; a superadmin can see and regenerate any", async () => {
    ReportExport.findOne.mockReturnValue({ lean: async () => stored(OTHER_ADMIN._id) });
    await expect(service.regenerateReport(ADMIN, "RPT-20261001-AAAAAAAA", { now: NOW })).rejects.toMatchObject({ status: 404, code: "REPORT_NOT_FOUND" });
    await expect(service.getReport(ADMIN, "RPT-20261001-AAAAAAAA")).rejects.toMatchObject({ status: 404 });
    expect((await service.getReport(SUPER, "RPT-20261001-AAAAAAAA")).reportId).toBe("RPT-20261001-AAAAAAAA");
    User.findById.mockReturnValue({ select: () => ({ lean: async () => ({ _id: SUPER._id, name: "Super", role: "superadmin" }) }) });
    await expect(service.regenerateReport(SUPER, "RPT-20261001-AAAAAAAA", { now: NOW })).resolves.toBeDefined();
  });

  test("an unknown report ID is 404", async () => {
    ReportExport.findOne.mockReturnValue({ lean: async () => null });
    await expect(service.getReport(ADMIN, "RPT-NOPE")).rejects.toMatchObject({ status: 404 });
  });

  test("an admin lists only their own history; a superadmin lists all; the list is capped at 50", async () => {
    const chain = { sort: () => chain, skip: () => chain, limit: jest.fn(() => chain), lean: async () => [stored()] };
    ReportExport.find.mockReturnValue(chain);
    ReportExport.countDocuments.mockResolvedValue(1);
    const mine = await service.listReports(ADMIN, { limit: "500" });
    expect(ReportExport.find.mock.calls[0][0]["preparedBy.userId"]).toBe(ADMIN._id);
    expect(chain.limit).toHaveBeenCalledWith(50);
    expect(mine.items[0]).not.toHaveProperty("preparedBy.userId");
    await service.listReports(SUPER, {});
    expect(ReportExport.find.mock.calls[1][0]["preparedBy.userId"]).toBeUndefined();
  });
});

describe("controller", () => {
  const res = () => {
    const out = { statusCode: 200, headers: {} };
    out.status = (code) => ((out.statusCode = code), out);
    out.json = (value) => ((out.body = value), out);
    out.set = (key, value) => (typeof key === "object" ? Object.assign(out.headers, key) : (out.headers[key] = value), out);
    out.send = (value) => ((out.sent = value), out);
    return out;
  };

  test("a file is sent with the report ID, no-store and an attachment name", async () => {
    const out = res();
    await controller.generateReport({ user: ADMIN, body: body(), headers: {}, ip: "1.2.3.4" }, out);
    expect(out.headers["Content-Disposition"]).toMatch(/^attachment; filename="RPT-\d{8}-[A-Z2-7]{8}\.csv"$/);
    expect(out.headers["X-Report-Id"]).toMatch(/^RPT-/);
    expect(out.headers["Cache-Control"]).toBe("no-store");
    expect(Buffer.isBuffer(out.sent)).toBe(true);
  });

  test("errors keep their status and code, and nothing is sent when the audit write fails", async () => {
    const out = res();
    await controller.generateReport({ user: ADMIN, body: body({ columns: ["email"] }), headers: {} }, out);
    expect(out.statusCode).toBe(400);
    expect(out.body.code).toBe("COLUMN_NOT_ALLOWED");
    const failed = res();
    AuditLog.create.mockRejectedValue(new Error("db down"));
    await controller.generateReport({ user: ADMIN, body: body(), headers: {} }, failed);
    expect(failed.statusCode).toBe(500);
    expect(failed.sent).toBeUndefined();
  });

  test("the catalog is role-specific", () => {
    const out = res();
    controller.getCatalog({ user: ADMIN }, out);
    expect(out.body.datasets.map((d) => d.id)).not.toContain("audit_summary");
  });
});
