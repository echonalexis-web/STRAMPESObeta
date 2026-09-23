const Announcement = require("../models/Announcement");
const NewsLike = require("../models/NewsLike");
const User = require("../models/User");
const { logAuditEvent } = require("../services/auditService");
const { notifyManyUsers } = require("../services/notificationService");
const storageService = require("../services/storageService");
const { escapeRegex } = require("../utils/sanitize");

// Categories that only matter to jobseekers get scoped to that role; general
// updates and events go out to everyone so the audience matches the content.
const JOBSEEKER_ONLY_CATEGORIES = ["hiring", "training", "advisory", "spes"];

const NEWS_CATEGORIES = ["general", "hiring", "training", "event", "advisory", "spes"];

const parseJSONSafe = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

// Normalise the SPES config coming from the create/edit form (sent as a JSON
// string field `spesConfig` so it survives multipart submissions).
const normalizeSpesConfig = (raw) => {
  const cfg = parseJSONSafe(raw, {}) || {};
  return {
    applicationDeadline: cfg.applicationDeadline ? new Date(cfg.applicationDeadline) : null,
    slots: cfg.slots !== undefined && cfg.slots !== null && cfg.slots !== "" ? Number(cfg.slots) : null,
    requirements: Array.isArray(cfg.requirements)
      ? cfg.requirements.map((r) => String(r).trim()).filter(Boolean).slice(0, 30)
      : [],
    resultsUrl: typeof cfg.resultsUrl === "string" ? cfg.resultsUrl.trim().slice(0, 500) : "",
    resultsSummary: typeof cfg.resultsSummary === "string" ? cfg.resultsSummary.trim().slice(0, 4000) : "",
    publishAcceptedList: Boolean(cfg.publishAcceptedList),
    exposeScores: Boolean(cfg.exposeScores),
  };
};

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
  Promise.resolve(storageService.remove(imageUrl)).catch(() => {});
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
    return res.status(500).json({ message: error.message || "Failed to load news" });
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
    return res.status(500).json({ message: error.message || "Failed to load news post" });
  }
};

exports.createNews = async (req, res) => {
  try {
    const { title, content, category, imageUrl, publishedAt, isActive, spesConfig } = req.body;
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
    if (category === "spes") {
      doc.spes = normalizeSpesConfig(spesConfig);
    }
    const created = await Announcement.create(doc);

    const populated = await Announcement.findById(created._id).populate("author", "name email");
    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "admin",
      action: "admin.news.created",
      targetType: "news",
      targetId: String(created._id),
      severity: "info",
      metadata: { category: created.category },
    });

    if (created.isActive) {
      await notifyNewsPublished({ announcement: created, authorId: req.user.id, io: req.app.get("io") });
    }

    return res.status(201).json({ message: "News post created", item: populated });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to create news post" });
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

    // SPES config: update the editable fields only, never the results-release
    // state (resultsStatus / resultsPublishedAt / resultsAnnouncementId).
    if (req.body.spesConfig !== undefined) {
      const cfg = normalizeSpesConfig(req.body.spesConfig);
      payload["spes.applicationDeadline"] = cfg.applicationDeadline;
      payload["spes.slots"] = cfg.slots;
      payload["spes.requirements"] = cfg.requirements;
      payload["spes.resultsUrl"] = cfg.resultsUrl;
      payload["spes.resultsSummary"] = cfg.resultsSummary;
      payload["spes.publishAcceptedList"] = cfg.publishAcceptedList;
      payload["spes.exposeScores"] = cfg.exposeScores;
    }

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
      await notifyNewsPublished({ announcement: updated, authorId: req.user.id, io: req.app.get("io") });
    }

    return res.json({ message: "News post updated", item: updated });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to update news post" });
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
    return res.status(500).json({ message: error.message || "Failed to delete news post" });
  }
};
