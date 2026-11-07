// Realtime "new announcement" push (news:published).
//   - published items emit to the allowed roles only
//   - drafts and plain edits emit nothing
//   - the payload is minimal
//   - an emit failure never fails the publish request
// Models and io are mocked; nothing touches a database or a real socket.

jest.mock("../models/User", () => ({ find: jest.fn() }));
jest.mock("../models/Announcement", () => ({ create: jest.fn(), findById: jest.fn(), findByIdAndUpdate: jest.fn(), findOne: jest.fn() }));
jest.mock("../models/NewsLike", () => ({}));
jest.mock("../services/notificationService", () => ({ notifyManyUsers: jest.fn().mockResolvedValue(null) }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/storageService", () => ({ remove: jest.fn().mockResolvedValue(null) }));
jest.mock("../utils/sanitize", () => ({ sanitizeText: (v) => v, escapeRegex: (v) => v }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const express = require("express");
const request = require("supertest");

const User = require("../models/User");
const Announcement = require("../models/Announcement");
const logger = require("../utils/logger");
const { emitNewsPublished, buildNewsPublishedPayload, audienceRolesFor, NEWS_PUBLISHED_EVENT } = require("../services/newsRealtimeService");
const { createNews, updateNews } = require("../controllers/newsController");

const AUTHOR = "aaaaaaaaaaaaaaaaaaaaaaa1";
const ids = { seeker: "bbbbbbbbbbbbbbbbbbbbbbb1", legacy: "bbbbbbbbbbbbbbbbbbbbbbb2", employer: "ccccccccccccccccccccccc1", admin: "ddddddddddddddddddddddd1", superadmin: "ddddddddddddddddddddddd2", suspended: "eeeeeeeeeeeeeeeeeeeeeee1", offline: "fffffffffffffffffffffff1" };

// A tiny in-memory "users" table; User.find applies the same filters the
// service sends (_id $in, role $in, isActive $ne false).
const USERS = [
  { _id: ids.seeker, role: "jobseeker", isActive: true },
  { _id: ids.legacy, role: "resident", isActive: true },
  { _id: ids.employer, role: "employer", isActive: true },
  { _id: ids.admin, role: "admin", isActive: true },
  { _id: ids.superadmin, role: "superadmin", isActive: true },
  { _id: ids.suspended, role: "jobseeker", isActive: false },
  { _id: AUTHOR, role: "admin", isActive: true },
];
const mockUserFind = () =>
  User.find.mockImplementation((query) => ({
    select: async () =>
      USERS.filter(
        (u) =>
          query._id.$in.includes(String(u._id)) &&
          query.role.$in.includes(u.role) &&
          !(query.isActive && query.isActive.$ne === false && u.isActive === false)
      ).map((u) => ({ _id: u._id })),
  }));

// A fake io: connected sockets (some users have two tabs) + a recorder.
const buildIo = (connected) => {
  const emitted = [];
  return {
    emitted,
    fetchSockets: jest.fn().mockResolvedValue(connected.map((userId) => ({ userId }))),
    to: jest.fn((room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) })),
  };
};

const announcement = (extra = {}) => ({
  _id: "999999999999999999999999",
  title: "Job fair next week",
  content: "SECRET BODY TEXT that must never be pushed",
  category: "general",
  publishedAt: new Date("2026-11-07T08:00:00.000Z"),
  author: { name: "PESO Admin", email: "admin@example.com" },
  isActive: true,
  ...extra,
});

const everyone = Object.values(ids);

beforeEach(() => {
  jest.clearAllMocks();
  mockUserFind();
});

describe("emitNewsPublished: who receives it", () => {
  test("general: jobseekers (incl. legacy roles) and employers, only; not staff, not suspended, not the author", async () => {
    const io = buildIo([...everyone, ids.seeker, AUTHOR]); // seeker has two tabs

    const count = await emitNewsPublished({ io, announcement: announcement(), authorId: AUTHOR });

    const rooms = io.emitted.map((e) => e.room).sort();
    expect(rooms).toEqual([`user:${ids.seeker}`, `user:${ids.legacy}`, `user:${ids.employer}`].sort());
    expect(count).toBe(3);
    expect(rooms).not.toContain(`user:${ids.admin}`);
    expect(rooms).not.toContain(`user:${ids.superadmin}`);
    expect(rooms).not.toContain(`user:${ids.suspended}`);
    expect(rooms).not.toContain(`user:${AUTHOR}`);
    expect(io.emitted.every((e) => e.event === NEWS_PUBLISHED_EVENT)).toBe(true);
  });

  test.each(["hiring", "training", "advisory", "spes"])("%s is jobseeker-only: employers do not get it", async (category) => {
    const io = buildIo(everyone);

    await emitNewsPublished({ io, announcement: announcement({ category }), authorId: AUTHOR });

    const rooms = io.emitted.map((e) => e.room);
    expect(rooms).toContain(`user:${ids.seeker}`);
    expect(rooms).toContain(`user:${ids.legacy}`);
    expect(rooms).not.toContain(`user:${ids.employer}`);
  });

  test("the event is sent once per user even with several open tabs", async () => {
    const io = buildIo([ids.seeker, ids.seeker, ids.seeker]);

    await emitNewsPublished({ io, announcement: announcement(), authorId: AUTHOR });

    expect(io.emitted).toHaveLength(1);
  });

  test("role and activity come from the database, not the socket: a stale socket claim does not matter", async () => {
    // The socket object carries no role at all; the DB decides.
    const io = buildIo([ids.admin]);

    const count = await emitNewsPublished({ io, announcement: announcement(), authorId: AUTHOR });

    expect(count).toBe(0);
    expect(io.emitted).toHaveLength(0);
  });

  test("nobody connected (or only the author) means no database lookup and no emit", async () => {
    const io = buildIo([AUTHOR]);

    expect(await emitNewsPublished({ io, announcement: announcement(), authorId: AUTHOR })).toBe(0);
    expect(User.find).not.toHaveBeenCalled();
  });

  test("no io (sockets unavailable) is a quiet no-op", async () => {
    expect(await emitNewsPublished({ io: null, announcement: announcement(), authorId: AUTHOR })).toBe(0);
    expect(await emitNewsPublished({ io: {}, announcement: announcement(), authorId: AUTHOR })).toBe(0);
  });

  test("audienceRolesFor mirrors the notification rule", () => {
    expect(audienceRolesFor("general")).toEqual(expect.arrayContaining(["jobseeker", "employer"]));
    expect(audienceRolesFor("hiring")).not.toContain("employer");
    expect(audienceRolesFor("hiring")).not.toContain("admin");
  });
});

describe("payload is minimal", () => {
  test("only id, title, category and publishedAt", async () => {
    const io = buildIo([ids.seeker]);

    await emitNewsPublished({ io, announcement: announcement(), authorId: AUTHOR });

    const { payload } = io.emitted[0];
    expect(Object.keys(payload).sort()).toEqual(["category", "id", "publishedAt", "title"]);
    expect(payload).toEqual({
      id: "999999999999999999999999",
      title: "Job fair next week",
      category: "general",
      publishedAt: "2026-11-07T08:00:00.000Z",
    });
    expect(JSON.stringify(io.emitted)).not.toMatch(/SECRET BODY|PESO Admin|admin@example\.com/);
  });

  test("a missing publishedAt falls back to createdAt, then now", () => {
    expect(buildNewsPublishedPayload(announcement({ publishedAt: undefined, createdAt: new Date("2026-01-02T00:00:00.000Z") })).publishedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(new Date(buildNewsPublishedPayload(announcement({ publishedAt: undefined })).publishedAt).getTime()).not.toBeNaN();
  });
});

describe("publish paths", () => {
  const buildApp = (handler, io) => {
    const app = express();
    app.use(express.json());
    app.set("io", io);
    app.all("/news/:id?", (req, _res, next) => {
      req.user = { id: AUTHOR, role: "admin" };
      next();
    }, handler);
    return app;
  };
  const created = (extra = {}) => ({ _id: "999999999999999999999999", title: "T", category: "general", isActive: true, publishedAt: new Date(), ...extra });

  beforeEach(() => {
    Announcement.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue({ _id: "999999999999999999999999", title: "T" }) });
    User.find.mockImplementation((query) => ({
      select: async () =>
        // The bell fan-out (notifyNewsPublished) also calls User.find, with
        // { role, _id: { $ne } }; only the realtime lookup has _id.$in.
        query._id && query._id.$in && query.role
          ? USERS.filter((u) => query._id.$in.includes(String(u._id)) && query.role.$in.includes(u.role) && u.isActive !== false).map((u) => ({ _id: u._id }))
          : [{ _id: ids.seeker }],
    }));
  });

  test("creating a published item emits once to allowed users and returns 201", async () => {
    Announcement.create.mockResolvedValue(created());
    const io = buildIo([ids.seeker, ids.employer, ids.admin]);

    const res = await request(buildApp(createNews, io)).post("/news").send({ title: "T", content: "C", category: "general" });

    expect(res.status).toBe(201);
    expect(io.emitted.map((e) => e.room).sort()).toEqual([`user:${ids.seeker}`, `user:${ids.employer}`].sort());
  });

  test("creating a DRAFT (isActive false) emits nothing", async () => {
    Announcement.create.mockResolvedValue(created({ isActive: false }));
    const io = buildIo([ids.seeker]);

    const res = await request(buildApp(createNews, io)).post("/news").send({ title: "T", content: "C", category: "general", isActive: "false" });

    expect(res.status).toBe(201);
    expect(io.fetchSockets).not.toHaveBeenCalled();
    expect(io.emitted).toHaveLength(0);
  });

  test("editing an already-published item emits nothing", async () => {
    Announcement.findById.mockResolvedValue({ _id: "1", isActive: true, imageUrl: "" });
    Announcement.findByIdAndUpdate.mockReturnValue({ populate: jest.fn().mockResolvedValue(created()) });
    const io = buildIo([ids.seeker]);

    const res = await request(buildApp(updateNews, io)).put("/news/1").send({ title: "Edited" });

    expect(res.status).toBe(200);
    expect(io.fetchSockets).not.toHaveBeenCalled();
    expect(io.emitted).toHaveLength(0);
  });

  test("editing a draft and leaving it a draft emits nothing", async () => {
    Announcement.findById.mockResolvedValue({ _id: "1", isActive: false, imageUrl: "" });
    Announcement.findByIdAndUpdate.mockReturnValue({ populate: jest.fn().mockResolvedValue(created({ isActive: false })) });
    const io = buildIo([ids.seeker]);

    const res = await request(buildApp(updateNews, io)).put("/news/1").send({ title: "Edited draft" });

    expect(res.status).toBe(200);
    expect(io.emitted).toHaveLength(0);
  });

  test("publishing a draft through an edit (inactive -> active) emits", async () => {
    Announcement.findById.mockResolvedValue({ _id: "1", isActive: false, imageUrl: "" });
    Announcement.findByIdAndUpdate.mockReturnValue({ populate: jest.fn().mockResolvedValue(created()) });
    const io = buildIo([ids.seeker]);

    const res = await request(buildApp(updateNews, io)).put("/news/1").send({ isActive: "true" });

    expect(res.status).toBe(200);
    expect(io.emitted.map((e) => e.room)).toEqual([`user:${ids.seeker}`]);
  });

  test("an emit failure is logged with the item id and operation, and the publish still returns 201", async () => {
    Announcement.create.mockResolvedValue(created());
    const io = buildIo([ids.seeker]);
    io.fetchSockets.mockRejectedValue(new Error("adapter exploded"));

    const res = await request(buildApp(createNews, io)).post("/news").send({ title: "T", content: "C", category: "general" });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe("News post created");
    const failure = logger.error.mock.calls.find(([m, e]) => m === "Post-commit step failed" && e.step === "news_create.emit_published");
    expect(failure).toBeDefined();
    expect(failure[1]).toMatchObject({ resourceType: "news", resourceId: "999999999999999999999999", userId: AUTHOR });
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/token/i);
  });

  test("an emit failure on the draft-to-published edit path also keeps the update at 200", async () => {
    Announcement.findById.mockResolvedValue({ _id: "1", isActive: false, imageUrl: "" });
    Announcement.findByIdAndUpdate.mockReturnValue({ populate: jest.fn().mockResolvedValue(created()) });
    const io = buildIo([ids.seeker]);
    io.fetchSockets.mockRejectedValue(new Error("adapter exploded"));

    const res = await request(buildApp(updateNews, io)).put("/news/1").send({ isActive: "true" });

    expect(res.status).toBe(200);
    expect(logger.error.mock.calls.some(([m, e]) => m === "Post-commit step failed" && e.step === "news_update.emit_published")).toBe(true);
  });

  test("with no io configured the publish still succeeds", async () => {
    Announcement.create.mockResolvedValue(created());

    const res = await request(buildApp(createNews, undefined)).post("/news").send({ title: "T", content: "C", category: "general" });

    expect(res.status).toBe(201);
  });
});
