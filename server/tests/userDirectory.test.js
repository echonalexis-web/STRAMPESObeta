// Directory filters / sort (shared builder) and the CSV export.

process.env.DISABLE_RATE_LIMITS = "true";

jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../models/User", () => ({ find: jest.fn(), countDocuments: jest.fn(), findById: jest.fn() }));
jest.mock("../models/SystemSettings", () => ({ getSingleton: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ aggregate: jest.fn() }));
jest.mock("../models/JobVacancy", () => ({ aggregate: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue() }));

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const JobApplication = require("../models/JobApplication");
const JobVacancy = require("../models/JobVacancy");
const { logAuditEvent } = require("../services/auditService");
const { buildDirectoryQuery } = require("../utils/userDirectoryQuery");
const { toCsv, csvCell } = require("../utils/csv");
const { query } = require("../testUtils/httpMocks");

const NOW = new Date("2026-06-01T00:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;
const build = (q, opts = {}) => buildDirectoryQuery(q, { isSuperadmin: true, now: NOW, ...opts });

describe("buildDirectoryQuery", () => {
  test("default: staff-hidden, deleted hidden, newest first", () => {
    const { filter, sort } = build({});
    expect(filter).toEqual({ role: { $ne: "superadmin" }, deletedAt: null });
    expect(sort).toEqual({ createdAt: -1, _id: -1 });
  });

  test("status filters: active, suspended, banned, deactivated each exclude deleted accounts", () => {
    const status = (s) => build({ status: s }).filter;
    expect(status("active").$and[0]).toEqual({ isActive: { $ne: false }, deletedAt: null });
    expect(status("suspended").$and[0]).toEqual({ isActive: false, deletedAt: null, accountStatus: { $nin: ["banned", "deactivated", "pending_activation"] } });
    expect(status("banned").$and[0]).toMatchObject({ isActive: false, accountStatus: "banned", deletedAt: null });
    expect(status("deactivated").$and[0]).toMatchObject({ isActive: false, accountStatus: "deactivated", deletedAt: null });
    expect(status("active")).not.toHaveProperty("deletedAt");
  });

  test("deleted accounts show only for a superadmin asking for them", () => {
    expect(build({ status: "deleted" }).filter.$and[0]).toEqual({ deletedAt: { $ne: null } });
    expect(build({ deleted: "only" }).filter.deletedAt).toEqual({ $ne: null });
    expect(build({ deleted: "include" }).filter).not.toHaveProperty("deletedAt");
    // an admin gets the default whatever they ask for
    for (const q of [{ status: "deleted" }, { deleted: "only" }, { deleted: "include" }]) {
      expect(build(q, { isSuperadmin: false }).filter.deletedAt).toBeNull();
    }
  });

  test("verification accepts every real status, and ignores unknown ones", () => {
    for (const s of ["unverified", "pending", "under_review", "verified", "resubmission_required", "rejected"]) {
      expect(build({ verificationStatus: s }).filter.verificationStatus).toBe(s);
    }
    expect(build({ verificationStatus: "bogus" }).filter).not.toHaveProperty("verificationStatus");
  });

  test("no email, idle 90+ and locked now", () => {
    const { filter } = build({ noEmail: "true", idle90: "true", lockedNow: "true" });
    expect(filter["loginLock.lockedUntil"]).toEqual({ $gt: new Date(NOW) });
    expect(filter.$and).toContainEqual({ $or: [{ email: { $exists: false } }, { email: null }, { email: "" }] });
    const cutoff = new Date(NOW - 90 * DAY);
    expect(filter.$and).toContainEqual({ $or: [{ lastActiveAt: null }, { lastActiveAt: { $lt: cutoff } }] });
    expect(filter.$and).toContainEqual({ $or: [{ lastLoginAt: null }, { lastLoginAt: { $lt: cutoff } }] });
    expect(filter.$and).toContainEqual({ createdAt: { $lt: cutoff } });
    expect(build({ noEmail: "false" }).filter).not.toHaveProperty("$and");
  });

  test("search covers name, email and username, escaped, and combines with other filters", () => {
    const { filter } = build({ search: "a.b(c)", noEmail: "true" });
    const searchClause = filter.$and.find((c) => c.$or && c.$or[0].name);
    expect(searchClause.$or).toHaveLength(3);
    expect(searchClause.$or[0].name.$regex).toBe("a\\.b\\(c\\)");
    expect(filter.$and).toHaveLength(2);
  });

  test("an operator object in a query value is never passed through", () => {
    const { filter } = build({ search: { $ne: "x" }, status: { $ne: "x" }, role: { $ne: "x" } });
    expect(JSON.stringify(filter)).not.toContain("$ne\":\"x");
  });

  test("sort: joined, last active, name; order asc or desc; name uses a case-insensitive collation", () => {
    expect(build({ sort: "lastActive" }).sort).toEqual({ lastActiveAt: -1, _id: -1 });
    expect(build({ sort: "lastActive", order: "asc" }).sort).toEqual({ lastActiveAt: 1, _id: 1 });
    const byName = build({ sort: "name" });
    expect(byName.sort).toEqual({ name: 1, _id: 1 });
    expect(byName.caseInsensitiveSort).toBe(true);
    expect(build({ sort: "name", order: "desc" }).sort.name).toBe(-1);
    expect(build({ sort: "password" }).sort).toEqual({ createdAt: -1, _id: -1 });
  });
});

describe("csv", () => {
  test("quotes, doubles quotes, and neutralizes formula injection", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    for (const evil of ["=HYPERLINK(1)", "+1", "-1", "@SUM(A1)", "\tx"]) {
      expect(csvCell(evil)).toBe(`"'${evil}"`);
    }
    expect(csvCell(null)).toBe('""');
    expect(csvCell(new Date("2026-01-02T10:00:00Z"))).toBe('"2026-01-02"');
  });

  test("writes a header, a BOM and CRLF rows", () => {
    const out = toCsv([{ label: "Name", key: "name" }, { label: "N", value: (r) => r.n }], [{ name: "Ana", n: 2 }]);
    expect(out).toBe('﻿"Name","N"\r\n"Ana","2"\r\n');
  });
});

describe("GET users-export and the list route", () => {
  const ACTOR = "111111111111111111111111";
  const app = express();
  app.use(express.json());
  const router = require("../routes/adminRoutes");
  app.use("/api/admin", router);
  app.use("/api/v1/admin", router);

  const as = (role) => {
    User.findById.mockImplementationOnce(() => ({ select: jest.fn().mockResolvedValue({ role, isActive: true, tokenVersion: 0 }) }));
    return "Bearer " + jwt.sign({ id: ACTOR }, process.env.JWT_SECRET || (process.env.JWT_SECRET = "local-test-secret"));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    JobApplication.aggregate.mockResolvedValue([{ _id: "u1", count: 4 }]);
    JobVacancy.aggregate.mockResolvedValue([{ _id: "u2", count: 7 }]);
    User.find.mockImplementation(() => query([
      { _id: "u1", name: "=cmd Juan", role: "jobseeker", createdAt: new Date("2026-01-02"), lastActiveAt: null, isActive: false, accountStatus: "suspended", email: "secret@x.com", phone: "0917", dateOfBirth: new Date("2012-01-01"), username: "juan" },
      { _id: "u2", name: "Acme", role: "employer", createdAt: new Date("2026-02-03"), lastActiveAt: new Date("2026-05-01"), isActive: true, verificationStatus: "verified", email: "e@x.com" },
    ]));
  });

  test.each(["/api/admin", "/api/v1/admin"])("%s export is superadmin only", async (prefix) => {
    for (const role of ["admin", "employer", "jobseeker"]) {
      const res = await request(app).get(`${prefix}/users-export`).set("Authorization", as(role));
      expect(res.status).toBe(403);
    }
    expect(User.find).not.toHaveBeenCalled();
    expect((await request(app).get(`${prefix}/users-export`)).status).toBeGreaterThanOrEqual(401);
  });

  test("a superadmin gets a CSV with only the non-sensitive columns and counts, and it is audited", async () => {
    const res = await request(app).get("/api/admin/users-export?role=jobseeker&status=suspended").set("Authorization", as("superadmin"));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="users-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = res.text.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe('"Name","Role","Status","Joined","Last active","Verification","Applications","Postings"');
    expect(lines[1]).toBe(`"'=cmd Juan","jobseeker","suspended","2026-01-02","","","4",""`);
    expect(lines[2]).toBe('"Acme","employer","active","2026-02-03","2026-05-01","verified","","7"');
    for (const secret of ["secret@x.com", "e@x.com", "0917", "2012", "juan\"", "dateOfBirth", "phone", "email"]) {
      expect(res.text).not.toContain(secret);
    }
    const audit = logAuditEvent.mock.calls.find(([e]) => e.action === "admin.user.exported")[0];
    expect(audit.metadata).toMatchObject({ rows: 2, filters: { role: "jobseeker", status: "suspended" } });
    // two grouped queries for the counts, not one per user
    expect(JobApplication.aggregate).toHaveBeenCalledTimes(1);
    expect(JobVacancy.aggregate).toHaveBeenCalledTimes(1);
  });

  test("an export larger than the limit is refused with 422 instead of being cut short", async () => {
    User.find.mockImplementation(() => query(Array.from({ length: 10001 }, (_, i) => ({ _id: `u${i}`, name: "x", role: "jobseeker", createdAt: new Date() }))));
    const res = await request(app).get("/api/admin/users-export").set("Authorization", as("superadmin"));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("EXPORT_TOO_LARGE");
    expect(res.text).not.toContain("jobseeker\",");
  });

  test("the export never selects contact fields from the database", async () => {
    await request(app).get("/api/admin/users-export").set("Authorization", as("superadmin"));
    const selected = User.find.mock.results[0].value.select.mock.calls[0][0];
    expect(selected).not.toMatch(/email|phone|username|dateOfBirth|address/);
  });

  test("the list applies the same filter and sort; a superadmin can see deleted accounts, an admin cannot", async () => {
    User.countDocuments.mockResolvedValue(2);
    const sa = await request(app).get("/api/admin/users?role=employer&status=deleted&sort=name").set("Authorization", as("superadmin"));
    expect(sa.status).toBe(200);
    const saFilter = User.find.mock.calls[0][0];
    expect(saFilter.$and[0]).toEqual({ deletedAt: { $ne: null } });
    const q = User.find.mock.results[0].value;
    expect(q.sort).toHaveBeenCalledWith({ name: 1, _id: 1 });
    expect(q.collation).toHaveBeenCalledWith({ locale: "en", strength: 2 });

    User.find.mockClear();
    await request(app).get("/api/admin/users?role=employer&status=deleted").set("Authorization", as("admin"));
    expect(User.find.mock.calls[0][0].deletedAt).toBeNull();
  });
});
