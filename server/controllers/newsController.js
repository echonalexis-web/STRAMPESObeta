const Announcement = require("../models/Announcement");
const NewsLike = require("../models/NewsLike");
const User = require("../models/User");
const { logAuditEvent } = require("../services/auditService");
const { runPostCommit } = require("../utils/postCommit");
const { notifyManyUsers } = require("../services/notificationService");
const { JOBSEEKER_ONLY_CATEGORIES, emitNewsPublished } = require("../services/newsRealtimeService");
const storageService = require("../services/storageService");
const { escapeRegex } = require("../utils/sanitize");
const { sendError } = require("../utils/sendError");
const logger = require("../utils/logger");

const NEWS_CATEGORIES = ["general", "hiring", "training", "event", "advisory", "spes"];

const notifyNewsPublished = async ({ announcement, authorId, io }) => {
  const roleFilter = JOBSEEKER_ONLY_CATEGORIES.includes(announcement.category)
    ? { role: "jobseeker" }
    : { role: { $in: ["jobseeker", "employer"] } };

  const recipients = await User.find({ ...roleFilter, _id: { $ne: authorId } }).select("_id");
  if (recipients.length === 0) return;

  await notifyManyUsers({
    recipientIds: recipients.map((user) => user._id),
    actorId: authorId,
    type: "news",
    title: "New announcement",
    message: announcement.title,
    relatedEntityType: "system",
    relatedEntityId: announcement._id,
    actionUrl: `/news/${announcement._id}`,
    metadata: { category: announcement.category },
    io,
  });
};

// Value stored for an uploaded announcement image (public URL from the storage backend)
const newsImageValue = (file) => (file && file.storedValue ? file.storedValue : "");

// Multipart submissions send booleans as the strings "true"/"false"
const toBoolean = (value, fallback) => {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
};

// Best-effort removal of a previously uploaded announcement image
const removeNewsImage = (imageUrl) => {
  if (!imageUrl) return;
  Promise.resolve(storageService.remove(imageUrl)).catch((err) =>
    logger.error("Failed to remove replaced news image from storage", { imageUrl, error: err.message })
  );
};

// Attach `likeCount` and `likedByMe` to a list of announcement documents.
const decorateWithLikes = async (docs, userId) => {
  const ids = docs.map((doc) => doc._id);
  if (ids.length === 0) return [];

  const [counts, myLikes] = await Promise.all([
    NewsLike.aggregate([
      { $match: { newsId: { $in: ids } } },
      { $group: { _id: "$newsId", count: { $sum: 1 } } },
    ]),
    userId
      ? NewsLike.find({ userId, newsId: { $in: ids } }).select("newsId")
      : Promise.resolve([]),
  ]);

  const countMap = new Map(counts.map((entry) => [String(entry._id), entry.count]));
  const likedSet = new Set(myLikes.map((like) => String(like.newsId)));

  return docs.map((doc) => {
    const plain = typeof doc.toObject === "function" ? doc.toObject() : doc;
    return {
      ...plain,
      likeCount: countMap.get(String(doc._id)) || 0,
      likedByMe: likedSet.has(String(doc._id)),
    };
  });
};

const parsePagination = (query = {}) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 50);
  return { page, limit };
};

exports.listNews = async (req, res) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const category = String(req.query.category || "").trim();
    const search = String(req.query.search || "").trim();
    const includeInactive = String(req.query.includeInactive || "false") === "true";
    const isAdmin = req.user?.role === "admin";

    const filter = {};
    if (!(includeInactive && isAdmin)) {
      filter.isActive = true;
    }
    if (NEWS_CATEGORIES.includes(category)) {
      filter.category = category;
    }

    if (search) {
      const searchRegex = escapeRegex(search);
      filter.$or = [
        { title: { $regex: searchRegex, $options: "i" } },
        { content: { $regex: searchRegex, $options: "i" } },
      ];
    }

    const [total, items] = await Promise.all([
      Announcement.countDocuments(filter),
      Announcement.find(filter)
        .populate("author", "name email")
        .sort({ publishedAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

    const decorated = await decorateWithLikes(items, req.user?.id);

    return res.json({
      items: decorated,
      total,
      currentPage: page,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (error) {
    return sendError(res, error, "Failed to load news");
  }
};

exports.getNewsById = async (req, res) => {
  try {
    const item = await Announcement.findOne({ _id: req.params.id, isActive: true }).populate("author", "name email");
    if (!item) {
      return res.status(404).json({ message: "News post not found" });
    }
    const [decorated] = await decorateWithLikes([item], req.user?.id);
    return res.json(decorated);
  } catch (error) {
    return sendError(res, error, "Failed to load news post");
  }
};

exports.createNews = async (req, res) => {
  try {
    const { title, content, category, imageUrl, publishedAt, isActive } = req.body;
    const resolvedImageUrl = req.file ? newsImageValue(req.file) : (imageUrl || "");
    const doc = {
      title,
      content,
      category,
      imageUrl: resolvedImageUrl,
      publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
      isActive: toBoolean(isActive, true),
      author: req.user.id,
    };
    // The "SPES Program" category is a plain announcement: no SPES settings are kept
    // on it. Real SPES postings are created under SPES Postings.
    if (category === "spes") doc.spesNotice = true;
    const created = await Announcement.create(doc);
    // The announcement references the uploaded image; a later failure must
    // not let the upload cleanup delete it.
    req.uploadsCommitted = true;

    // Saved; the populate, audit and fan-out notification are best-effort.
    const postCommitCtx = { req, resourceType: "news", resourceId: created._id };
    // Realtime "new announcement" toast: published items only (not drafts),
    // best-effort, and independent of the bell notifications below.
    if (created.isActive) {
      await runPostCommit("news_create.emit_published", postCommitCtx, () =>
        emitNewsPublished({ io: req.app.get("io"), announcement: created, authorId: req.user.id })
      );
    }
    let populated = created;
    await runPostCommit("news_create.populate", postCommitCtx, async () => {
      populated = await Announcement.findById(created._id).populate("author", "name email");
    });
    await runPostCommit("news_create.audit", postCommitCtx, () => logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "admin",
      action: "admin.news.created",
      targetType: "news",
      targetId: String(created._id),
      severity: "info",
      metadata: { category: created.category },
    }));

    if (created.isActive) {
      await runPostCommit("news_create.notify_users", postCommitCtx, () =>
        notifyNewsPublished({ announcement: created, authorId: req.user.id, io: req.app.get("io") })
      );
    }

    return res.status(201).json({ message: "News post created", item: populated });
  } catch (error) {
    return sendError(res, error, "Failed to create news post");
  }
};

exports.updateNews = async (req, res) => {
  try {
    const existing = await Announcement.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: "News post not found" });
    }

    const payload = {
      title: req.body.title,
      content: req.body.content,
      category: req.body.category,
      imageUrl: req.body.imageUrl,
      isActive: toBoolean(req.body.isActive, undefined),
      commentsEnabled: toBoolean(req.body.commentsEnabled, undefined),
    };

    if (req.file) {
      payload.imageUrl = newsImageValue(req.file);
    }

    if (req.body.publishedAt) {
      payload.publishedAt = new Date(req.body.publishedAt);
    }

    // Moving an announcement into the "SPES Program" category makes it a plain SPES
    // notice; an announcement that already held SPES settings keeps them untouched.
    if (req.body.category === "spes" && existing.category !== "spes") payload.spesNotice = true;

    const cleaned = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));

    // Drop a replaced upload so it doesn't linger on disk
    if (cleaned.imageUrl !== undefined && cleaned.imageUrl !== existing.imageUrl) {
      removeNewsImage(existing.imageUrl);
    }

    const updated = await Announcement.findByIdAndUpdate(req.params.id, cleaned, { new: true, runValidators: true }).populate("author", "name email");

    if (!updated) {
      return res.status(404).json({ message: "News post not found" });
    }

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "admin",
      action: "admin.news.updated",
      targetType: "news",
      targetId: String(updated._id),
      severity: "warning",
      metadata: { category: updated.category, isActive: updated.isActive },
    });

    if (!existing.isActive && updated.isActive) {
      // Draft just went live: same realtime prompt as a fresh publish.
      // Best-effort; a socket problem must not fail the update.
      await runPostCommit("news_update.emit_published", { req, resourceType: "news", resourceId: updated._id }, () =>
        emitNewsPublished({ io: req.app.get("io"), announcement: updated, authorId: req.user.id })
      );
      await notifyNewsPublished({ announcement: updated, authorId: req.user.id, io: req.app.get("io") });
    }

    return res.json({ message: "News post updated", item: updated });
  } catch (error) {
    return sendError(res, error, "Failed to update news post");
  }
};

exports.deleteNews = async (req, res) => {
  try {
    const removed = await Announcement.findByIdAndDelete(req.params.id);
    if (!removed) {
      return res.status(404).json({ message: "News post not found" });
    }
    removeNewsImage(removed.imageUrl);
    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "admin",
      action: "admin.news.deleted",
      targetType: "news",
      targetId: String(removed._id),
      severity: "critical",
      metadata: { category: removed.category },
    });
    return res.json({ message: "News post deleted" });
  } catch (error) {
    return sendError(res, error, "Failed to delete news post");
  }
};
