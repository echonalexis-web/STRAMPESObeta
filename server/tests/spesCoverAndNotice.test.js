// Posting cover image (type/size/content checks, replace, remove, news-card sync) and
// the rule that a SPES-category announcement is a plain announcement.

jest.mock("../models/SpesPosting", () => ({}));
jest.mock("../models/SpesApplication", () => ({}));
jest.mock("../models/Announcement", () => ({ updateOne: jest.fn().mockResolvedValue({}), create: jest.fn(), findById: jest.fn() }));
jest.mock("../models/User", () => ({ find: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue([]) }) }));
jest.mock("../services/storageService", () => ({ remove: jest.fn().mockResolvedValue(null) }));
jest.mock("../services/spesPostingService", () => ({
  resolvePosting: jest.fn(),
  applicationFilterFor: (p) => ({ posting: p._id }),
  listAllPostings: jest.fn(),
  announcePosting: jest.fn(),
}));
jest.mock("../services/notificationService", () => ({
  notifyManyUsers: jest.fn().mockResolvedValue(null),
  createNotificationForUser: jest.fn().mockResolvedValue(null),
}));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/newsRealtimeService", () => ({
  JOBSEEKER_ONLY_CATEGORIES: ["spes"],
  emitNewsPublished: jest.fn(),
}));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const express = require("express");
const request = require("supertest");

const Announcement = require("../models/Announcement");
const storageService = require("../services/storageService");
const { resolvePosting } = require("../services/spesPostingService");
const { logAuditEvent } = require("../services/auditService");
const postings = require("../controllers/spesPostingController");
const news = require("../controllers/newsController");
const { spesCoverUpload, validateSpesCover } = require("../middleware/spesUpload");

const PID = "cccccccccccccccccccccccc";
const ADMIN = { id: "aaaaaaaaaaaaaaaaaaaaaaaa", role: "admin" };

// A real PNG header so the magic-byte check passes.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

const posting = (extra = {}) => ({
  _id: PID,
  title: "SPES 2026",
  status: "published",
  coverImage: "",
  results: { status: "pending" },
  save: jest.fn().mockResolvedValue(undefined),
  ...extra,
});

beforeEach(() => jest.clearAllMocks());

describe("cover upload: type, size and content checks", () => {
  // The same chain the route uses, minus storage: it stores nothing but proves what gets through.
  const app = () => {
    const a = express();
    a.post("/cover", spesCoverUpload, validateSpesCover, (req, res) => res.json({ ok: true, name: req.file.originalname }));
    return a;
  };

  test("a PNG is accepted", async () => {
    const res = await request(app()).post("/cover").attach("cover", PNG, { filename: "cover.png", contentType: "image/png" });
    expect(res.status).toBe(200);
  });

  test("a JPG and a WEBP are accepted by type", async () => {
    expect((await request(app()).post("/cover").attach("cover", JPG, { filename: "c.jpg", contentType: "image/jpeg" })).status).toBe(200);
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]);
    expect((await request(app()).post("/cover").attach("cover", webp, { filename: "c.webp", contentType: "image/webp" })).status).toBe(200);
  });

  test.each([
    ["a PDF", Buffer.from("%PDF-1.4"), "doc.pdf", "application/pdf"],
    ["a GIF", Buffer.from("GIF89a"), "a.gif", "image/gif"],
    ["a script renamed to .png", Buffer.from("<script>alert(1)</script>"), "x.png", "image/png"],
  ])("%s is refused with SPES_COVER_TYPE", async (_l, buf, filename, contentType) => {
    const res = await request(app()).post("/cover").attach("cover", buf, { filename, contentType });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SPES_COVER_TYPE");
  });

  test("an image over 3 MB is refused with SPES_COVER_TOO_LARGE", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]);
    const res = await request(app()).post("/cover").attach("cover", big, { filename: "big.png", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SPES_COVER_TOO_LARGE");
  });

  test("no file -> SPES_COVER_MISSING", async () => {
    const res = await request(app()).post("/cover").field("x", "1");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SPES_COVER_MISSING");
  });
});

describe("cover upload and removal (controller)", () => {
  const run = (handler, { file, params = { postingId: PID } } = {}) => {
    const a = express();
    a.all("/t", (req, _res, next) => {
      req.user = ADMIN;
      req.params = params;
      req.file = file;
      req.app.set("io", null);
      next();
    }, handler);
    return request(a).post("/t");
  };

  test("saves the stored image, removes the previous one, syncs the news card and audits", async () => {
    const p = posting({ coverImage: "https://cdn/old.png", newsAnnouncementId: "card1" });
    resolvePosting.mockResolvedValue(p);
    const res = await run(postings.uploadCover, { file: { storedValue: "https://cdn/new.png", originalname: "n.png" } });
    expect(res.status).toBe(200);
    expect(p.coverImage).toBe("https://cdn/new.png");
    expect(res.body.posting.coverImage).toBe("https://cdn/new.png");
    expect(storageService.remove).toHaveBeenCalledWith("https://cdn/old.png");
    expect(Announcement.updateOne).toHaveBeenCalledWith({ _id: "card1" }, { $set: { imageUrl: "https://cdn/new.png" } });
    expect(logAuditEvent.mock.calls.map(([e]) => e.action)).toContain("spes.posting.cover_updated");
  });

  test("a posting without a news card does not touch announcements; the first cover removes nothing", async () => {
    resolvePosting.mockResolvedValue(posting());
    await run(postings.uploadCover, { file: { storedValue: "https://cdn/new.png", originalname: "n.png" } });
    expect(Announcement.updateOne).not.toHaveBeenCalled();
    expect(storageService.remove).not.toHaveBeenCalled();
  });

  test("a legacy posting refuses a cover (manage it as an announcement)", async () => {
    resolvePosting.mockResolvedValue(posting({ legacy: true }));
    const res = await run(postings.uploadCover, { file: { storedValue: "x", originalname: "n.png" } });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SPES_POSTING_LEGACY");
  });

  test("remove clears the cover, deletes the file and updates the card; removing none is a no-op", async () => {
    const p = posting({ coverImage: "https://cdn/old.png", newsAnnouncementId: "card1" });
    resolvePosting.mockResolvedValue(p);
    const res = await run(postings.removeCover);
    expect(res.status).toBe(200);
    expect(p.coverImage).toBe("");
    expect(storageService.remove).toHaveBeenCalledWith("https://cdn/old.png");
    expect(Announcement.updateOne).toHaveBeenCalledWith({ _id: "card1" }, { $set: { imageUrl: "" } });

    jest.clearAllMocks();
    resolvePosting.mockResolvedValue(posting());
    expect((await run(postings.removeCover)).status).toBe(200);
    expect(storageService.remove).not.toHaveBeenCalled();
  });
});

describe("a SPES-category announcement is a plain announcement", () => {
  const post = (body) => {
    const a = express();
    a.use(express.json());
    a.post("/news", (req, _res, next) => {
      req.user = ADMIN;
      req.app.set("io", null);
      next();
    }, news.createNews);
    return request(a).post("/news").send(body);
  };

  test("creating one stores no SPES settings and marks it as a notice (never a legacy posting)", async () => {
    Announcement.create.mockResolvedValue({ _id: "n1", category: "spes", isActive: false });
    Announcement.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue({ _id: "n1" }) });
    const res = await post({
      title: "SPES briefing",
      content: "Come to the briefing",
      category: "spes",
      spesConfig: JSON.stringify({ applicationDeadline: "2026-12-01", slots: 10 }), // ignored
      isActive: false,
    });
    expect(res.status).toBe(201);
    const doc = Announcement.create.mock.calls[0][0];
    expect(doc.spesNotice).toBe(true);
    expect(doc).not.toHaveProperty("spes");
  });

  test("other categories are untouched", async () => {
    Announcement.create.mockResolvedValue({ _id: "n2", category: "general", isActive: false });
    Announcement.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue({ _id: "n2" }) });
    await post({ title: "Hello", content: "World", category: "general", isActive: false });
    expect(Announcement.create.mock.calls[0][0]).not.toHaveProperty("spesNotice");
  });
});
