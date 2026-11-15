// News list: page size, category and date-range filters.
// Models are mocked; nothing touches a database.

jest.mock("../models/User", () => ({ find: jest.fn() }));
jest.mock("../models/NewsLike", () => ({ aggregate: jest.fn().mockResolvedValue([]), find: jest.fn() }));
jest.mock("../models/Announcement", () => ({ countDocuments: jest.fn(), find: jest.fn() }));
jest.mock("../services/notificationService", () => ({ notifyManyUsers: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn() }));
jest.mock("../services/storageService", () => ({ remove: jest.fn() }));
jest.mock("../utils/sanitize", () => ({ sanitizeText: (v) => v, escapeRegex: (v) => v }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const express = require("express");
const request = require("supertest");
const Announcement = require("../models/Announcement");
const { listNews } = require("../controllers/newsController");

const app = express();
app.get("/news", listNews);

const chain = (docs) => {
  const q = { populate: jest.fn(() => q), sort: jest.fn(() => q), skip: jest.fn(() => q), limit: jest.fn(() => Promise.resolve(docs)) };
  q.__calls = q;
  return q;
};

let findQuery;
beforeEach(() => {
  jest.clearAllMocks();
  findQuery = chain([]);
  Announcement.find.mockReturnValue(findQuery);
  Announcement.countDocuments.mockResolvedValue(14);
});

test("limit 6 gives 3 pages for 14 items and skips correctly on page 2", async () => {
  const res = await request(app).get("/news?page=2&limit=6");
  expect(res.status).toBe(200);
  expect(res.body.totalPages).toBe(3);
  expect(res.body.currentPage).toBe(2);
  expect(findQuery.skip).toHaveBeenCalledWith(6);
  expect(findQuery.limit).toHaveBeenCalledWith(6);
});

test("offset overrides the page-based skip (featured story + grid pages)", async () => {
  await request(app).get("/news?limit=6&offset=7");
  expect(findQuery.skip).toHaveBeenCalledWith(7);
  expect(findQuery.limit).toHaveBeenCalledWith(6);

  findQuery.skip.mockClear();
  await request(app).get("/news?limit=7&offset=0");
  expect(findQuery.skip).toHaveBeenCalledWith(0);
  expect(findQuery.limit).toHaveBeenCalledWith(7);

  findQuery.skip.mockClear();
  await request(app).get("/news?page=3&limit=6&offset=-4");
  expect(findQuery.skip).toHaveBeenCalledWith(12);
});

test("from and to become a publishedAt range", async () => {
  const from = "2026-11-01T00:00:00.000Z";
  const to = "2026-11-13T23:59:59.999Z";
  await request(app).get(`/news?from=${from}&to=${to}`);
  const filter = Announcement.find.mock.calls[0][0];
  expect(filter.publishedAt.$gte).toEqual(new Date(from));
  expect(filter.publishedAt.$lte).toEqual(new Date(to));
  expect(filter.isActive).toBe(true);
});

test("only one bound still filters; garbage dates are ignored", async () => {
  await request(app).get("/news?from=2026-11-01T00:00:00.000Z");
  expect(Announcement.find.mock.calls[0][0].publishedAt).toEqual({ $gte: new Date("2026-11-01T00:00:00.000Z") });

  Announcement.find.mockClear();
  await request(app).get("/news?from=not-a-date&to=");
  expect(Announcement.find.mock.calls[0][0].publishedAt).toBeUndefined();
});

test("category and date range combine", async () => {
  await request(app).get("/news?category=hiring&from=2026-11-01T00:00:00.000Z");
  const filter = Announcement.find.mock.calls[0][0];
  expect(filter.category).toBe("hiring");
  expect(filter.publishedAt.$gte).toBeInstanceOf(Date);
});
