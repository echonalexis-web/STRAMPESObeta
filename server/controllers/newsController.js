const fs = require("fs");
const path = require("path");
const Announcement = require("../models/Announcement");
const NewsLike = require("../models/NewsLike");
const { logAuditEvent } = require("../services/auditService");

// Public URL path for an uploaded announcement image
const newsImageUrl = (file) => (file ? `/uploads/news/${file.filename}` : "");

// Best-effort removal of a previously uploaded announcement image
const removeNewsImageFile = (imageUrl) => {
  if (!imageUrl || !imageUrl.startsWith("/uploads/news/")) return;
  const safeName = path.basename(imageUrl);
  const fullPath = path.join(__dirname, "..", "uploads", "news", safeName);
  fs.promises.unlink(fullPath).catch(() => {});
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
    if (["general", "hiring", "training", "event", "advisory"].includes(category)) {
      filter.category = category;
    }

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { content: { $regex: search, $options: "i" } },
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
    const { title, content, category, imageUrl, publishedAt, isActive } = req.body;
    const resolvedImageUrl = req.file ? newsImageUrl(req.file) : (imageUrl || "");
    const created = await Announcement.create({
      title,
      content,
      category,
      imageUrl: resolvedImageUrl,
      publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
      isActive: typeof isActive === "boolean" ? isActive : true,
      author: req.user.id,
    });

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
      isActive: req.body.isActive,
    };

    if (req.file) {
      payload.imageUrl = newsImageUrl(req.file);
    }

    if (req.body.publishedAt) {
      payload.publishedAt = new Date(req.body.publishedAt);
    }

    const cleaned = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));

    // Drop a replaced upload so it doesn't linger on disk
    if (cleaned.imageUrl !== undefined && cleaned.imageUrl !== existing.imageUrl) {
      removeNewsImageFile(existing.imageUrl);
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
    removeNewsImageFile(removed.imageUrl);
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
