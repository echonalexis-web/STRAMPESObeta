const Announcement = require("../models/Announcement");
const NewsComment = require("../models/NewsComment");
const { logAuditEvent } = require("../services/auditService");
const { createNotificationForUser } = require("../services/notificationService");

exports.listComments = async (req, res) => {
  try {
    const { newsId } = req.params;
    const comments = await NewsComment.find({ newsId, isHidden: false })
      .populate("author", "name role isActive profileImage")
      .sort({ createdAt: -1 });

    // Drop comments whose author account was deleted or suspended.
    const visible = comments.filter(
      (comment) => comment.author && comment.author.isActive !== false
    );

    return res.json({ items: visible });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to load comments" });
  }
};

exports.createComment = async (req, res) => {
  try {
    const { newsId } = req.params;
    const content = String(req.body.content || "").trim();

    if (!content || content.length > 1000) {
      return res.status(400).json({ message: "Comment must be between 1 and 1000 characters" });
    }

    const announcement = await Announcement.findOne({ _id: newsId, isActive: true });
    if (!announcement) {
      return res.status(404).json({ message: "News post not found" });
    }
    if (!announcement.commentsEnabled) {
      return res.status(403).json({ message: "Comments are disabled for this announcement" });
    }

    const comment = await NewsComment.create({
      newsId,
      author: req.user.id,
      content,
    });

    const populated = await NewsComment.findById(comment._id).populate("author", "name role profileImage");

    if (String(announcement.author) !== String(req.user.id)) {
      await createNotificationForUser({
        recipientId: announcement.author,
        actorId: req.user.id,
        type: "news",
        title: "New comment on your announcement",
        message: `${populated.author?.name || "Someone"} commented on "${announcement.title}".`,
        relatedEntityType: "system",
        relatedEntityId: announcement._id,
        actionUrl: `/news/${announcement._id}`,
        io: req.app.get("io"),
      });
    }

    return res.status(201).json({ message: "Comment posted", item: populated });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to post comment" });
  }
};

exports.deleteComment = async (req, res) => {
  try {
    const { newsId, commentId } = req.params;
    const comment = await NewsComment.findOne({ _id: commentId, newsId });
    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

    const isOwner = String(comment.author) === String(req.user.id);
    const isAdmin = req.user.role === "admin";
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: "You can only delete your own comment" });
    }

    await NewsComment.findByIdAndDelete(commentId);

    if (isAdmin && !isOwner) {
      await logAuditEvent({
        req,
        actorId: req.user.id,
        actorRole: "admin",
        action: "admin.news.comment_deleted",
        targetType: "news",
        targetId: String(newsId),
        severity: "warning",
        metadata: { commentId: String(commentId) },
      });

      const announcement = await Announcement.findById(newsId).select("title");
      await createNotificationForUser({
        recipientId: comment.author,
        actorId: req.user.id,
        type: "admin_action",
        title: "Your comment was removed",
        message: `A moderator removed your comment on "${announcement?.title || "an announcement"}".`,
        relatedEntityType: "system",
        relatedEntityId: newsId,
        actionUrl: `/news/${newsId}`,
        io: req.app.get("io"),
      });
    }

    return res.json({ message: "Comment deleted" });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to delete comment" });
  }
};
