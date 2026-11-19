// White-box branch coverage for newsLikeController.js and newsCommentController.js.
// Tests tagged KNOWN-ISSUE pin CURRENT behaviour that looks like a defect (see
// docs/WHITE_BOX_TEST_REPORT.md).

jest.mock("../models/NewsLike", () => ({ findOne: jest.fn(), create: jest.fn(), countDocuments: jest.fn(), findOneAndDelete: jest.fn(), find: jest.fn() }));
jest.mock("../models/NewsComment", () => ({ find: jest.fn(), findOne: jest.fn(), findById: jest.fn(), create: jest.fn(), findByIdAndDelete: jest.fn() }));
jest.mock("../models/Announcement", () => ({ findOne: jest.fn(), findById: jest.fn() }));
jest.mock("../models/User", () => ({ findById: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn() }));
jest.mock("../services/notificationService", () => ({ createNotificationForUser: jest.fn(), notifyLike: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const NewsLike = require("../models/NewsLike");
const NewsComment = require("../models/NewsComment");
const Announcement = require("../models/Announcement");
const User = require("../models/User");
const { logAuditEvent } = require("../services/auditService");
const { createNotificationForUser, notifyLike } = require("../services/notificationService");
const likes = require("../controllers/newsLikeController");
const comments = require("../controllers/newsCommentController");
const { makeReq, query, failingQuery, call } = require("../testUtils/httpMocks");

const u = (o = {}) => ({ id: "u1", _id: "u1", role: "jobseeker", ...o });
const ureq = (o = {}) => makeReq({ user: u(), params: { newsId: "n1" }, ...o });
const dbError = () => new Error("secret db internals");

let errSpy;
beforeEach(() => {
  jest.resetAllMocks();
  createNotificationForUser.mockResolvedValue();
  notifyLike.mockResolvedValue();
  logAuditEvent.mockResolvedValue();
  errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errSpy.mockRestore());

// ---------------------------------------------------------------------------
describe("newsLikeController", () => {
  describe("likeNews", () => {
    test("WB-NEWS-01 only active announcements can be liked (404 otherwise)", async () => {
      Announcement.findOne.mockResolvedValue(null);
      const r = await call(likes.likeNews, ureq());
      expect(r.status).toBe(404);
      expect(Announcement.findOne).toHaveBeenCalledWith({ _id: "n1", isActive: true });
    });

    test("WB-NEWS-02 liking twice is idempotent: 200 'already liked', no second row, no second notification", async () => {
      Announcement.findOne.mockResolvedValue({ author: "a", title: "T" });
      NewsLike.findOne.mockResolvedValue({ _id: "l1" });
      NewsLike.countDocuments.mockResolvedValue(5);
      const r = await call(likes.likeNews, ureq());
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ success: true, message: "Announcement already liked", data: { newsId: "n1", likeCount: 5, isLiked: true } });
      expect(NewsLike.create).not.toHaveBeenCalled();
      expect(notifyLike).not.toHaveBeenCalled();
    });

    test("WB-NEWS-03 first like: 201, row created, author notified with the liker's name (or 'Someone')", async () => {
      Announcement.findOne.mockResolvedValue({ author: "a", title: "T" });
      NewsLike.findOne.mockResolvedValue(null);
      NewsLike.create.mockResolvedValue({});
      NewsLike.countDocuments.mockResolvedValue(1);
      User.findById.mockReturnValue(query({ name: "Ann" }));
      const r = await call(likes.likeNews, ureq());
      expect(r.status).toBe(201);
      expect(NewsLike.create).toHaveBeenCalledWith({ userId: "u1", newsId: "n1" });
      expect(notifyLike).toHaveBeenCalledWith(expect.objectContaining({ recipientId: "a", actorName: "Ann", itemLabel: 'your announcement "T"', actionUrl: "/news/n1" }));
      User.findById.mockReturnValue(query(null));
      await call(likes.likeNews, ureq());
      expect(notifyLike.mock.calls[1][0].actorName).toBe("Someone");
    });

    test("WB-NEWS-04 a failure (including a duplicate-key race from the unique index) is a generic 500 with an `error` key", async () => {
      Announcement.findOne.mockResolvedValue({ author: "a", title: "T" });
      NewsLike.findOne.mockResolvedValue(null);
      NewsLike.create.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
      const r = await call(likes.likeNews, ureq());
      expect(r.status).toBe(500);
      expect(r.body).toEqual({ error: "Failed to like announcement" });
    });
  });

  test("WB-NEWS-05 unlikeNews: removes the caller's like (even if none), returns the new count; failure is a generic 500", async () => {
    NewsLike.findOneAndDelete.mockResolvedValue(null);
    NewsLike.countDocuments.mockResolvedValue(2);
    const r = await call(likes.unlikeNews, ureq());
    expect(NewsLike.findOneAndDelete).toHaveBeenCalledWith({ userId: "u1", newsId: "n1" });
    expect(r.body).toEqual({ success: true, message: "Announcement unliked successfully", data: { newsId: "n1", likeCount: 2, isLiked: false } });
    NewsLike.countDocuments.mockRejectedValue(dbError());
    expect((await call(likes.unlikeNews, ureq())).body).toEqual({ error: "Failed to unlike announcement" });
  });

  describe("getLikedNews", () => {
    const like = (newsId, createdAt = "c") => ({ newsId, createdAt });
    const news = (isActive, id = "n") => ({ isActive, toObject: () => ({ _id: id }) });
    const wire = (rows, total = rows.length) => {
      NewsLike.countDocuments.mockResolvedValue(total);
      const q = query(rows);
      NewsLike.find.mockReturnValue(q);
      return q;
    };

    test("WB-NEWS-06 drops likes whose announcement was deleted or unpublished and adds likedAt", async () => {
      wire([like(news(true, "a"), "t1"), like(null), like(news(false, "b")), like(news(true, "c"), "t3")]);
      const { body } = await call(likes.getLikedNews, ureq({ query: {} }));
      expect(body.data).toEqual([{ _id: "a", likedAt: "t1" }, { _id: "c", likedAt: "t3" }]);
    });

    test("WB-NEWS-07 pagination: defaults 1/20, limit clamped to 1..60, page >= 1; pages from total", async () => {
      let q = wire([], 45);
      let r = await call(likes.getLikedNews, ureq({ query: {} }));
      expect(q.skip).toHaveBeenCalledWith(0);
      expect(q.limit).toHaveBeenCalledWith(20);
      expect(r.body.pagination).toEqual({ total: 45, page: 1, limit: 20, pages: 3 });
      q = wire([], 0);
      r = await call(likes.getLikedNews, ureq({ query: { page: "3", limit: "999" } }));
      expect(q.skip).toHaveBeenCalledWith(120);
      expect(r.body.pagination).toMatchObject({ limit: 60, pages: 1, page: 3 });
      q = wire([]);
      await call(likes.getLikedNews, ureq({ query: { page: "-1", limit: "0" } }));
      expect(q.skip).toHaveBeenCalledWith(0);
      expect(q.limit).toHaveBeenCalledWith(20);
      q = wire([]);
      await call(likes.getLikedNews, ureq({ query: { limit: "-5" } }));
      expect(q.limit).toHaveBeenCalledWith(1);
    });

    test("WB-NEWS-08 KNOWN-ISSUE: total counts likes whose announcement was filtered out, so a page can be short while `total`/`pages` still include them", async () => {
      wire([like(null), like(news(false))], 2);
      const { body } = await call(likes.getLikedNews, ureq({ query: {} }));
      expect(body.data).toEqual([]);
      expect(body.pagination.total).toBe(2);
    });

    test("WB-NEWS-09 failure is a generic 500", async () => {
      NewsLike.countDocuments.mockRejectedValue(dbError());
      expect((await call(likes.getLikedNews, ureq({ query: {} }))).body).toEqual({ error: "Failed to fetch liked announcements" });
    });
  });

  test("WB-NEWS-10 getNewsLikeStatus: liked / not liked with count; failure is a generic 500", async () => {
    NewsLike.findOne.mockResolvedValue({ _id: "l" });
    NewsLike.countDocuments.mockResolvedValue(4);
    expect((await call(likes.getNewsLikeStatus, ureq())).body).toEqual({ success: true, data: { isLiked: true, likeCount: 4 } });
    NewsLike.findOne.mockResolvedValue(null);
    expect((await call(likes.getNewsLikeStatus, ureq())).body.data.isLiked).toBe(false);
    NewsLike.findOne.mockRejectedValue(dbError());
    expect((await call(likes.getNewsLikeStatus, ureq())).body).toEqual({ error: "Failed to fetch like status" });
  });
});

// ---------------------------------------------------------------------------
describe("newsCommentController", () => {
  describe("listComments", () => {
    test("WB-NEWS-11 returns only non-hidden comments whose author still exists and is not suspended", async () => {
      const q = query([
        { _id: 1, author: { isActive: true } }, { _id: 2, author: null }, { _id: 3, author: { isActive: false } }, { _id: 4, author: { isActive: undefined } },
      ]);
      NewsComment.find.mockReturnValue(q);
      const { body } = await call(comments.listComments, ureq());
      expect(NewsComment.find).toHaveBeenCalledWith({ newsId: "n1", isHidden: false });
      expect(body.items.map((c) => c._id)).toEqual([1, 4]);
    });

    test("WB-NEWS-12 failure is a generic 500", async () => {
      NewsComment.find.mockReturnValue(failingQuery(dbError()));
      const r = await call(comments.listComments, ureq());
      expect(r.body).toEqual({ message: "Failed to load comments" });
    });
  });

  describe("createComment", () => {
    const run = (content, over = {}) => call(comments.createComment, ureq({ body: { content }, ...over }));
    const ann = (o = {}) => ({ _id: "n1", author: "author", title: "T", commentsEnabled: true, ...o });

    test.each([[undefined], [""], ["   "], ["x".repeat(1001)]])("WB-NEWS-13 content %p is rejected before any lookup", async (c) => {
      const r = await run(c);
      expect(r.status).toBe(400);
      expect(Announcement.findOne).not.toHaveBeenCalled();
    });

    test("WB-NEWS-14 boundary: 1 and 1000 characters accepted (after trim)", async () => {
      Announcement.findOne.mockResolvedValue(ann());
      NewsComment.create.mockResolvedValue({ _id: "c1" });
      NewsComment.findById.mockReturnValue(query({ author: { name: "Ann" } }));
      expect((await run("x")).status).toBe(201);
      expect((await run(`  ${"x".repeat(1000)}  `)).status).toBe(201);
      expect(NewsComment.create.mock.calls[1][0].content).toHaveLength(1000);
    });

    test("WB-NEWS-15 unknown/inactive announcement 404; comments disabled 403", async () => {
      Announcement.findOne.mockResolvedValue(null);
      expect((await run("hi")).status).toBe(404);
      Announcement.findOne.mockResolvedValue(ann({ commentsEnabled: false }));
      expect((await run("hi")).status).toBe(403);
      expect(NewsComment.create).not.toHaveBeenCalled();
    });

    test("WB-NEWS-16 success notifies the announcement author with the commenter's name (or 'Someone')", async () => {
      Announcement.findOne.mockResolvedValue(ann());
      NewsComment.create.mockResolvedValue({ _id: "c1" });
      NewsComment.findById.mockReturnValue(query({ author: { name: "Ann" } }));
      const r = await run("hi");
      expect(NewsComment.create).toHaveBeenCalledWith({ newsId: "n1", author: "u1", content: "hi" });
      expect(createNotificationForUser).toHaveBeenCalledWith(expect.objectContaining({ recipientId: "author", message: 'Ann commented on "T".', actionUrl: "/news/n1" }));
      expect(r.body.message).toBe("Comment posted");
      NewsComment.findById.mockReturnValue(query({ author: null }));
      await run("hi");
      expect(createNotificationForUser.mock.calls[1][0].message).toBe('Someone commented on "T".');
    });

    test("WB-NEWS-17 commenting on your OWN announcement sends no notification", async () => {
      Announcement.findOne.mockResolvedValue(ann({ author: "u1" }));
      NewsComment.create.mockResolvedValue({ _id: "c1" });
      NewsComment.findById.mockReturnValue(query({ author: { name: "Ann" } }));
      await run("hi");
      expect(createNotificationForUser).not.toHaveBeenCalled();
    });

    test("WB-NEWS-18 KNOWN-ISSUE: the comment is already saved when the author notification fails, yet the request returns 500 (a retry would post a duplicate)", async () => {
      Announcement.findOne.mockResolvedValue(ann());
      NewsComment.create.mockResolvedValue({ _id: "c1" });
      NewsComment.findById.mockReturnValue(query({ author: { name: "Ann" } }));
      createNotificationForUser.mockRejectedValue(new Error("smtp"));
      const r = await run("hi");
      expect(NewsComment.create).toHaveBeenCalled();
      expect(r.status).toBe(500);
    });

    test("WB-NEWS-19 DB failure is a generic 500", async () => {
      Announcement.findOne.mockRejectedValue(dbError());
      expect((await run("hi")).body).toEqual({ message: "Failed to post comment" });
    });
  });

  describe("deleteComment", () => {
    const run = (user, over = {}) => call(comments.deleteComment, makeReq({ user, params: { newsId: "n1", commentId: "c1" }, ...over }));
    const comment = (author = "someone") => ({ _id: "c1", author });

    test("WB-NEWS-20 unknown comment (or wrong announcement) is 404", async () => {
      NewsComment.findOne.mockResolvedValue(null);
      expect((await run(u())).status).toBe(404);
      expect(NewsComment.findOne).toHaveBeenCalledWith({ _id: "c1", newsId: "n1" });
    });

    test("WB-NEWS-21 neither author nor admin is 403 and nothing is deleted", async () => {
      NewsComment.findOne.mockResolvedValue(comment());
      expect((await run(u())).status).toBe(403);
      expect(NewsComment.findByIdAndDelete).not.toHaveBeenCalled();
    });

    test("WB-NEWS-22 KNOWN-ISSUE: a superadmin is neither author nor `admin`, so cannot moderate (delete) another user's comment", async () => {
      NewsComment.findOne.mockResolvedValue(comment());
      expect((await run(u({ role: "superadmin" }))).status).toBe(403);
    });

    test("WB-NEWS-23 the author can delete their own comment without any audit/notification", async () => {
      NewsComment.findOne.mockResolvedValue(comment("u1"));
      NewsComment.findByIdAndDelete.mockResolvedValue();
      const r = await run(u());
      expect(r.body).toEqual({ message: "Comment deleted" });
      expect(logAuditEvent).not.toHaveBeenCalled();
      expect(createNotificationForUser).not.toHaveBeenCalled();
    });

    test("WB-NEWS-24 an admin removing someone else's comment is audited and the author is told (title or fallback)", async () => {
      NewsComment.findOne.mockResolvedValue(comment("other"));
      NewsComment.findByIdAndDelete.mockResolvedValue();
      Announcement.findById.mockReturnValue(query({ title: "Big News" }));
      await run(u({ role: "admin" }));
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.news.comment_deleted", severity: "warning", metadata: { commentId: "c1" } }));
      expect(createNotificationForUser.mock.calls[0][0]).toMatchObject({ recipientId: "other", message: 'A moderator removed your comment on "Big News".' });
      Announcement.findById.mockReturnValue(query(null));
      await run(u({ role: "admin" }));
      expect(createNotificationForUser.mock.calls[1][0].message).toContain('"an announcement"');
    });

    test("WB-NEWS-25 an admin deleting their OWN comment is treated as the author (no moderation audit)", async () => {
      NewsComment.findOne.mockResolvedValue(comment("u1"));
      NewsComment.findByIdAndDelete.mockResolvedValue();
      await run(u({ role: "admin" }));
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    test("WB-NEWS-26 DB failure is a generic 500", async () => {
      NewsComment.findOne.mockRejectedValue(dbError());
      expect((await run(u())).body).toEqual({ message: "Failed to delete comment" });
    });
  });
});
