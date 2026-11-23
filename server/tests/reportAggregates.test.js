// Aggregate report datasets: audit summary (counts only, superadmin) and verification activity.

jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../models/User", () => ({ findById: jest.fn(), find: jest.fn(), aggregate: jest.fn() }));
jest.mock("../models/JobVacancy", () => ({ aggregate: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ aggregate: jest.fn() }));
jest.mock("../models/SpesPosting", () => ({ aggregate: jest.fn() }));
jest.mock("../models/SpesApplication", () => ({ aggregate: jest.fn() }));
jest.mock("../models/AuditLog", () => ({ create: jest.fn(), aggregate: jest.fn() }));
jest.mock("../models/ReportExport", () => ({ create: jest.fn() }));
jest.mock("../models/SystemOption", () => ({ find: jest.fn(() => ({ sort: () => ({ select: () => ({ lean: async () => [] }) }) })) }));
jest.mock("../utils/jobVisibility", () => ({
  withListedEmployers: jest.fn(async (filter) => filter),
  getUnlistedEmployerIds: jest.fn(async () => []),
  UNLISTED_ACCOUNT_STATUSES: ["suspended", "banned", "deactivated"],
}));

const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const ReportExport = require("../models/ReportExport");
const service = require("../services/reports/reportService");

const NOW = new Date("2026-11-20T06:05:00Z");
const SUPER = { _id: "64b7f0f0f0f0f0f0f0f0f003", role: "superadmin" };
const ADMIN = { _id: "64b7f0f0f0f0f0f0f0f0f001", role: "admin" };
const params = { period: "year", year: "2026" };
const text = (result) => result.bytes.toString("utf8");

beforeEach(() => {
  jest.clearAllMocks();
  service._inFlight.clear();
  User.findById.mockReturnValue({ select: () => ({ lean: async () => ({ _id: SUPER._id, name: "Super Admin", role: "superadmin" }) }) });
  AuditLog.create.mockResolvedValue({});
  ReportExport.create.mockResolvedValue({});
});

describe("audit summary", () => {
  test("counts by month, category and severity; no actor, address or message is asked for", async () => {
    AuditLog.aggregate.mockImplementation(() => ({
      option: () => Promise.resolve([
        { _id: { month: "2026-10", category: "auth", severity: "info" }, count: 120 },
        { _id: { month: "2026-10", category: "report", severity: "warning" }, count: 4 },
      ]),
    }));
    const result = await service.generateReport(SUPER, { dataset: "audit_summary", params, purpose: "Annual oversight review" }, { now: NOW });
    const csv = text(result);
    expect(csv).toContain('"Month","Category","Severity","Count"');
    expect(csv).toContain('"2026-10","auth","info","120"');
    const pipeline = JSON.stringify(AuditLog.aggregate.mock.calls[0][0]);
    expect(pipeline).not.toMatch(/actorId|ipAddress|userAgent|metadata/);
    expect(result.recordCount).toBe(2);
  });

  test("an admin cannot generate it", async () => {
    await expect(service.generateReport(ADMIN, { dataset: "audit_summary", params, purpose: "Annual oversight review" }, { now: NOW })).rejects.toMatchObject({ status: 403 });
  });
});

describe("verification activity", () => {
  test("merges submitted and reviewed counts by month with the average turnaround in days", async () => {
    User.aggregate
      .mockImplementationOnce(() => ({ option: () => Promise.resolve([{ _id: "2026-09", submitted: 5 }, { _id: "2026-10", submitted: 7 }]) }))
      .mockImplementationOnce(() => ({ option: () => Promise.resolve([{ _id: "2026-10", reviewed: 6, verified: 4, rejected: 2, turnaroundMs: 3 * 86400000 }]) }));
    const result = await service.generateReport(SUPER, { dataset: "verification_activity", params }, { now: NOW });
    const csv = text(result);
    expect(csv).toContain('"2026-09","5","0","0","0",""');
    expect(csv).toContain('"2026-10","7","6","4","2","3"');
    expect(JSON.stringify(User.aggregate.mock.calls)).not.toMatch(/businessPermitUrl|registrationDocUrl|verificationNote/);
  });
});
